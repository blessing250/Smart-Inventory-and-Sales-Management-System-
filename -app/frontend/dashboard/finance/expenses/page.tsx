'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { businessDate } from '@/shared/business-date';
import { formatRwf } from '@/shared/finance/currency';
import { fixedInput, formatNative } from '@/shared/finance/native-display';
import { useAccounts } from '@/frontend/lib/use-accounts';
import { usePreferences } from '@/frontend/lib/use-preferences';
import type { DataStore } from '@/backend/database/data-store';
import { receiptAccept } from '@/shared/validation/expense-receipt';

type Expenses = ReturnType<DataStore['getExpenses']>;
const field = 'block w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800';
const card = 'space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800';

export default function ExpensesPage() {
  const { accounts, error: accountError } = useAccounts();
  const preferences = usePreferences();
  const [saved, setSaved] = useState('');
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<{ query: string; data?: Expenses; error?: string }>();
  const [filters, setFilters] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<{ body: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const query = new URLSearchParams(filters);
  query.set('page', String(page));
  const key = query.toString();
  const options = accounts.filter(account => account.active);
  const selected = options.find(account => account.id === (accountId || saved));
  const currency = selected?.currency ?? 'RWF';
  const data = result?.query === key ? result.data : undefined;
  const loadError = result?.query === key ? result.error : undefined;
  const categories = [...new Set([...(data?.recentCategories ?? []), ...(preferences?.expense_categories ?? [])])];
  let debit: number | undefined;
  try { debit = fixedInput(amount,currency === 'RWF' ? 0 : 2); } catch { debit = undefined; }

  useEffect(() => {
    const timer = setTimeout(() => {
      try { setSaved(localStorage.getItem('bizflow.expense.account') ?? ''); } catch { /* Browser storage is optional. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/finance/expenses?${key}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load expenses.');
      if (!controller.signal.aborted) setResult({ query: key, data: body });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ query: key, error: error.message });
    });
    return () => controller.abort();
  }, [key, refresh]);

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const attachment = values.get('attachment');
      values.delete('attachment');
      const payload = { ...Object.fromEntries(values), account: selected.id,
        amount: fixedInput(values.get('amount'), currency === 'RWF' ? 0 : 2),
        rate: currency === 'RWF' ? undefined : fixedInput(values.get('rate'), 6) };
      const body = JSON.stringify(payload);
      if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
      const expense = JSON.stringify({ ...payload, request_key: pending.current.key });
      const upload = new FormData();
      if (attachment instanceof File && attachment.name) {
        upload.set('expense', expense);
        upload.set('attachment', attachment);
      }
      const response = await fetch('/api/finance/expenses', upload.has('attachment')
        ? { method: 'POST', body: upload }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: expense });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to record the expense.');
      pending.current = null;
      try { localStorage.setItem('bizflow.expense.account', selected.id); } catch { /* Browser storage is optional. */ }
      form.reset();
      setAmount('');
      setNotice(`Expense recorded from ${selected.name}.`);
      setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to record the expense.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function attach(event: FormEvent<HTMLFormElement>, expense: string) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const upload = new FormData(form);
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/finance/expenses/${encodeURIComponent(expense)}/receipts`, { method: 'POST', body: upload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to attach this receipt.');
      form.reset();
      setNotice('Receipt attached.');
      setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to attach this receipt.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function reverse(id: string) {
    const reason = window.prompt('Why are you reversing this expense?')?.trim();
    if (!reason || !window.confirm('Reverse this posting and restore its amount to the original account?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/finance', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reason }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to reverse expense.');
      setNotice('Expense reversal recorded.');
      setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to reverse expense.'); }
    finally { setBusy(false); }
  }

  const download = `report=expenses&range=all&${filters}`;
  return <main className="space-y-5 p-4 sm:p-6">
    <h1 className="text-3xl font-bold">Expenses / Money Out</h1>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <Link href="/dashboard/finance" className="underline">Supplier and shipment payments, transfers and exchanges</Link>
      <Link href="/dashboard/sales/returns" className="underline">Customer refunds</Link>
    </div>
    {(error || accountError) && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error || accountError}</p>}
    {notice && <p role="status" className="rounded bg-green-50 p-3 text-green-800">{notice}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <p className={card}>Today’s operating expenses <strong className="block">{data ? formatRwf(data.today) : '…'}</strong></p>
      <p className={card}>This month’s operating expenses <strong className="block">{data ? formatRwf(data.month) : '…'}</strong></p>
    </div>
    <form className={card} onSubmit={post}>
      <h2 className="font-semibold">Record expense</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Amount ({currency})<input name="amount" inputMode="decimal" required value={amount}
          onChange={event => setAmount(event.target.value)} className={field} /></label>
        <label>Expense category<input name="category" list="expense-categories" required maxLength={100}
          value={category} onChange={event => setCategory(event.target.value)} className={field} /></label>
        <datalist id="expense-categories">{categories.map(name => <option key={name} value={name} />)}</datalist>
        <label>Paid from account<select required value={selected?.id ?? ''} onChange={event => {
          setAccountId(event.target.value); if (!event.target.value) setSaved('');
        }} className={field}>
          <option value="">Choose an active account</option>
          {options.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
        </select></label>
        <label>Date (Kigali)<input name="settled_on" type="date" required max={businessDate(new Date())}
          defaultValue={businessDate(new Date())} className={field} /></label>
        {currency !== 'RWF' && <label>Actual exchange rate (RWF per {currency})<input name="rate" inputMode="decimal" required className={field} /></label>}
      </div>
      {selected && <p className="text-sm">{selected.name} balance {data?.balances.some(account => account.id === selected.id)
        ? formatNative(data.balances.find(account => account.id === selected.id)!.balance,currency) : '…'}</p>}
      {selected && !!debit && <p className="text-sm font-medium">Posting will debit {formatNative(debit,currency)} from {selected.name}.</p>}
      <details>
        <summary className="cursor-pointer py-2">More details</summary>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Description<textarea name="description" maxLength={1000} className={field} /></label>
          <label>Supplier or payee<input name="payee" maxLength={200} className={field} /></label>
          <label>Receipt or invoice reference<input name="receipt" maxLength={150} className={field} /></label>
          <label>Related business reference<input name="related" maxLength={200} className={field} /></label>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer py-2">Attach receipt (optional)</summary>
        <label className="block">Receipt file <span className="text-sm">(PDF, JPEG, PNG or WebP, up to 2 MiB)</span>
          <input name="attachment" type="file" accept={receiptAccept} className="block w-full" />
        </label>
      </details>
      <button disabled={busy || !selected} className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Post expense'}</button>
    </form>
    {!!data?.balances.length && <details className={card}>
      <summary className="cursor-pointer font-semibold">Available account balances</summary>
      <ul className="grid gap-2 sm:grid-cols-2">{data.balances.filter(account => account.active).map(account =>
        <li key={account.id} className="flex justify-between gap-2"><span>{account.name}</span><strong>{formatNative(account.balance,account.currency)}</strong></li>)}</ul>
    </details>}
    <section className={card}>
      <h2 className="font-semibold">Expense history</h2>
      <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" onSubmit={event => {
        event.preventDefault();
        const next = new URLSearchParams();
        for (const [name,value] of new FormData(event.currentTarget)) if (value) next.set(name,String(value));
        setFilters(next.toString()); setPage(1);
      }}>
        <label>From<input name="start" type="date" className={field} /></label>
        <label>To<input name="end" type="date" className={field} /></label>
        <label>Category<select name="category" className={field}><option value="">All categories</option>
          {[...new Set([...(preferences?.expense_categories ?? []), ...(data?.categories ?? [])])].map(name => <option key={name}>{name}</option>)}
        </select></label>
        <label>Account<select name="account" className={field}><option value="">All accounts</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Search<input name="q" type="search" maxLength={150} className={field} /></label>
        <label>Sort<select name="sort" className={field}><option value="latest">Newest</option><option value="oldest">Oldest</option><option value="amount">Largest amount</option></select></label>
        <button className="justify-self-start rounded border px-4 py-2">Apply filters</button>
      </form>
      {!data && !loadError && <p role="status">Loading expense history…</p>}
      {loadError && <p role="alert">{loadError} <button className="underline" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
      {data && <>
        <p className="font-medium">{data.totals.count} matching records · Net expenses {formatRwf(data.totals.amount)}</p>
        <div className="flex gap-4"><a className="underline" href={`/api/reports/export?format=pdf&${download}`}>PDF (all matching)</a>
          <a className="underline" href={`/api/reports/export?format=excel&${download}`}>Excel (all matching)</a></div>
        {data.groups.length > 0 && <details><summary className="cursor-pointer">Totals by category</summary>
          <ul>{data.groups.map(group => <li key={group.category}>{group.category} · {formatRwf(group.amount)}</li>)}</ul></details>}
        {!data.rows.length ? <p>No expenses match these filters.</p> : <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{['Date','Category','Account','Amount','Status','Details'].map(title => <th scope="col" key={title} className="p-2">{title}</th>)}</tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.id} className="border-t">
              <td className="whitespace-nowrap p-2">{businessDate(row.effective_at)}</td><td className="p-2">{row.category}</td>
              <td className="p-2">{row.account}</td><td className="whitespace-nowrap p-2">{formatNative(row.native_amount,row.currency)}</td>
              <td className="p-2">{row.status}</td><td className="p-2"><details>
                <summary className="cursor-pointer underline">View details</summary>
                <p>{row.reference} · {row.actor}</p>
                <p>{[row.details?.description,row.details?.payee,row.details?.receipt,row.details?.related,row.reversal_reason].filter(Boolean).join(' · ')}</p>
                {row.attachments.length > 0 && <ul>
                  {row.attachments.map(file => <li key={file.id}>
                    <a className="underline" href={`/api/finance/expenses/${encodeURIComponent(row.id)}/receipts?receipt=${encodeURIComponent(file.id)}`}>
                      Download {file.filename}
                    </a>
                  </li>)}
                </ul>}
                {row.source_kind === 'expense' && row.status !== 'Reversal' && <details className="my-2">
                  <summary className="cursor-pointer underline">Attach receipt (optional)</summary>
                  <form onSubmit={event => void attach(event, row.id)} className="space-y-2">
                    <label className="block">Receipt file <span className="text-xs">(up to 2 MiB)</span>
                      <input name="attachment" type="file" required accept={receiptAccept} className="block w-full" />
                    </label>
                    <button disabled={busy} className="rounded border px-2 py-1 disabled:opacity-50">Save receipt</button>
                  </form>
                </details>}
                {row.status === 'Posted' && (row.source_kind === 'expense'
                  ? <button disabled={busy} className="underline" onClick={() => void reverse(row.id)}>Reverse posting</button>
                  : <Link href="/dashboard/finance" className="underline">Review linked exchange in Finance</Link>)}
              </details></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {data.pages > 1 && <nav aria-label="Expense pages" className="flex items-center gap-3">
          <button disabled={data.page === 1} className="rounded border px-3 py-1 disabled:opacity-50" onClick={() => setPage(data.page-1)}>Previous</button>
          <span>{data.page} / {data.pages}</span>
          <button disabled={data.page === data.pages} className="rounded border px-3 py-1 disabled:opacity-50" onClick={() => setPage(data.page+1)}>Next</button>
        </nav>}
      </>}
    </section>
  </main>;
}
