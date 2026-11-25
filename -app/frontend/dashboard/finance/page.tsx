'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { postBusiness, readBusiness } from '@/frontend/lib/business-client';
import { formatRwf } from '@/shared/finance/currency';
import type { Purchase } from '@/shared/types/inventory';
import type { Currency } from '@/shared/finance/settlement-money';
import { fixedInput, formatNative } from '@/shared/finance/native-display';
import { BusinessHistory } from '@/frontend/components/business-history';
import Link from 'next/link';

type Finance = {
  accounts: { id: string; name: string; balance: number; currency: Currency; active: number }[];
};
type Shipment = { id: string; reference: string; expenses: number; paid: number };
const options = { opening: 'Record opening funds', transfer: 'Transfer between accounts',
  exchange: 'Exchange currencies', supplier_payment: 'Pay a supplier', shipment_payment: 'Pay shipment charges' };
const input = 'w-full rounded border p-2 dark:bg-gray-800';

export default function FinancePage() {
  const [finance, setFinance] = useState<Finance>();
  const [orders, setOrders] = useState<(Purchase & { balance: number })[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [kind, setKind] = useState<keyof typeof options>('supplier_payment');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [purchaseId, setPurchaseId] = useState('');
  const source = finance?.accounts.find(row => row.id === accountId);
  const destination = finance?.accounts.find(row => row.id === destinationId);
  const purchase = orders.find(row => row.id === purchaseId);
  const currency = source?.currency ?? 'RWF';
  const differentPayable = kind === 'supplier_payment' && purchase?.currency && purchase.currency !== 'RWF' && purchase.currency !== currency;
  useEffect(() => {
    Promise.all([readBusiness<Finance>('/api/finance?view=balances'), readBusiness<(Purchase & { balance: number })[]>('/api/purchases'), readBusiness<Shipment[]>('/api/shipments')])
      .then(([finance, orders, shipments]) => { setFinance(finance); setOrders(orders); setShipments(shipments); })
      .catch(error => setMessage(error.message));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setMessage('');
    try {
      const places = currency === 'RWF' ? 0 : 2;
      const payload = { ...Object.fromEntries(values), kind, amount: fixedInput(values.get('amount'), places),
        rate: fixedInput(values.get('rate'), 6), received: fixedInput(values.get('received'), destination?.currency === 'RWF' ? 0 : 2),
        fee: fixedInput(values.get('fee'), places), payable_minor: fixedInput(values.get('payable_minor'), 2),
        settled_on: values.get('settled_on') || undefined };
      if (!window.confirm(kind === 'exchange' ? 'Post the actual amounts exchanged to both native-currency accounts?' : 'Post this financial transaction?')) return;
      await postBusiness('/api/finance', payload);
      form.reset();
      setFinance(await readBusiness<Finance>('/api/finance?view=balances'));
      setHistoryVersion(version => version + 1);
      if (kind === 'shipment_payment') setShipments(await readBusiness<Shipment[]>('/api/shipments'));
      if (kind === 'supplier_payment') setOrders(await readBusiness<(Purchase & { balance: number })[]>('/api/purchases'));
      setMessage('Transaction recorded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record transaction.');
    } finally {
      setSaving(false);
    }
  }

  const active = finance?.accounts.filter(account => account.active) ?? [];
  const optionsFor = (accounts: typeof active) => accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>);
  async function setActive(account: Finance['accounts'][number]) {
    if (!window.confirm(account.active ? 'Disable new postings to this account?' : 'Enable new postings to this account?')) return;
    setSaving(true);
    try {
      await postBusiness('/api/finance', { kind: 'account_status', account: account.id, active: !account.active });
      setFinance(await readBusiness<Finance>('/api/finance?view=balances'));
      if (account.id === accountId) setAccountId('');
      if (account.id === destinationId) setDestinationId('');
      setMessage('Account status updated.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update the account.'); }
    finally { setSaving(false); }
  }
  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    try {
      await postBusiness('/api/finance', { ...Object.fromEntries(new FormData(form)), kind: 'account' });
      setFinance(await readBusiness<Finance>('/api/finance?view=balances'));
      form.reset();
      setMessage('Account added.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add account.');
    } finally { setSaving(false); }
  }
  async function reverse(id: string) {
    const reason = window.prompt('Enter the reason for reversing this transaction.');
    if (!reason?.trim() || !window.confirm('Record the reversal? The original transaction will remain visible.')) return;
    setSaving(true);
    try {
      const response = await fetch('/api/finance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, reason }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to reverse transaction.');
      const [finance, shipments, orders] = await Promise.all([readBusiness<Finance>('/api/finance?view=balances'),
        readBusiness<Shipment[]>('/api/shipments'), readBusiness<(Purchase & { balance: number })[]>('/api/purchases')]);
      setFinance(finance);
      setShipments(shipments);
      setOrders(orders);
      setHistoryVersion(version => version + 1);
      setMessage('Reversal recorded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reverse transaction.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="space-y-5 p-6">
      <h1 className="text-3xl font-bold">Finance</h1>
      <Link href="/dashboard/finance/expenses" className="inline-block text-blue-700 underline dark:text-blue-300">Expenses / Money Out</Link>
      {message && <p role="status">{message}</p>}
      {!finance && !message && <p>Loading accounts…</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {finance?.accounts.map(account => <div key={account.id} className="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
          {account.name}<p className="font-bold">{formatNative(account.balance, account.currency)}</p>
          <button type="button" disabled={saving} className="mt-2 text-sm underline" onClick={() => void setActive(account)}>
            {account.active ? 'Disable account' : 'Re-enable account'}
          </button>
        </div>)}
      </div>
      <details className="space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
        <summary className="cursor-pointer font-semibold">Add an account</summary>
        <form onSubmit={addAccount} className="grid items-end gap-3 sm:grid-cols-3">
          <label>Account name<input name="name" required maxLength={100} className={input} /></label>
          <label>Type<select name="type" className={input}><option>Cash</option><option value="Bank Transfer">Bank</option><option>Mobile Money</option></select></label>
          <label>Currency<select name="currency" className={input}><option>RWF</option><option>USD</option><option>CNY</option></select></label>
          <button disabled={saving || !finance} className="rounded bg-blue-700 p-2 text-white">Create account</button>
        </form>
      </details>
      <form onSubmit={submit} className="grid gap-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800 sm:grid-cols-2">
        <label>Transaction<select className={input} value={kind} onChange={event => {
          setKind(event.target.value as keyof typeof options); setDestinationId(''); setPurchaseId('');
        }}>
          {Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Account<select name="account" className={input} required value={accountId} onChange={event => {
          setAccountId(event.target.value); setDestinationId('');
        }}><option value="">Choose account</option>{optionsFor(active)}</select></label>
        {(kind === 'transfer' || kind === 'exchange') && <label>Destination<select name="destination" className={input} required value={destinationId}
          onChange={event => setDestinationId(event.target.value)}><option value="">Choose account</option>
          {optionsFor(active.filter(row => row.id !== accountId && (kind === 'transfer' ? row.currency === currency : row.currency !== currency)))}
        </select></label>}
        {kind === 'supplier_payment' && <label>Purchase<select name="purchase" className={input} required value={purchaseId} onChange={event => setPurchaseId(event.target.value)}>
          <option value="">Choose a purchase</option>
          {orders.filter(order => order.balance > 0 || order.id === purchaseId).map(order => <option key={order.id} value={order.id}>{order.supplier_name} · {formatRwf(order.balance)} outstanding · {order.currency ?? 'RWF'} · {order.id.slice(0, 8)}</option>)}
        </select></label>}
        {kind === 'shipment_payment' && <label>Shipment<select name="shipment" className={input} required>
          <option value="">Choose a shipment</option>
          {shipments.filter(row => row.expenses > row.paid).map(row => <option key={row.id} value={row.id}>{row.reference} · {formatRwf(row.expenses - row.paid)} outstanding</option>)}
        </select></label>}
        <label>Amount ({currency})<input name="amount" inputMode="decimal" className={input} required /></label>
        {currency !== 'RWF' && <label>Actual rate (RWF per {currency})<input required name="rate" inputMode="decimal" className={input} /></label>}
        {kind === 'exchange' && <>
          <label>Amount received ({destination?.currency ?? 'destination currency'})<input required name="received" inputMode="decimal" className={input} /></label>
          <label>Fee ({currency}, optional)<input name="fee" inputMode="decimal" className={input} /></label>
        </>}
        {differentPayable && <label>Purchase amount discharged ({purchase.currency})<input required name="payable_minor" inputMode="decimal" className={input} /></label>}
        <label>Unique reference<input name="reference" className={input} required /></label>
        <label>Settlement date (Kigali, defaults to today)<input name="settled_on" type="date" className={input} /></label>
        <button disabled={saving || !finance} className="rounded bg-blue-700 p-2 text-white disabled:opacity-50">Record transaction</button>
      </form>
      <BusinessHistory resource="finance" accounts={finance?.accounts} refresh={historyVersion} action={row =>
        ['opening','expense','transfer','exchange','supplier_payment','shipment_payment','customer_payment'].includes(row.status)
          ? <button disabled={saving} className="underline" onClick={() => void reverse(row.id)}>Reverse</button> : null} />
    </main>
  );
}
