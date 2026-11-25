'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { businessDate } from '@/shared/business-date';
import { formatRwf } from '@/shared/finance/currency';
import type { HistoryPage, HistoryRow } from '@/shared/types/history';
import type { HistoryQuery } from '@/shared/validation/history-input';

export const historyLabels = {
  products: 'Products', stock: 'Stock movements', purchases: 'Purchases', shipments: 'Shipments',
  receipts: 'Receiving events', sales: 'Sales', contacts: 'Customers and suppliers', orders: 'Online orders',
  finance: 'Financial transactions', audit: 'Audit history',
} as const;
const field = 'block w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800';

export function BusinessHistory({ resource, action, refresh = 0, accounts = [] }: {
  resource: HistoryQuery['resource']; action?: (row: HistoryRow) => ReactNode; refresh?: number;
  accounts?: { id: string; name: string }[];
}) {
  const [q, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [account, setAccount] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [sort, setSort] = useState('latest');
  const [size, setSize] = useState(20);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; value?: HistoryPage; error?: string }>();
  const params = new URLSearchParams({ resource, q, status, account, start, end, sort, size: String(size), page: String(page) });
  const key = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/history?${key}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load records.');
        if (!controller.signal.aborted) setResult({ key, value: data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : 'Unable to load records.' });
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [key, refresh, retry]);
  const current = result?.key === key ? result : undefined;
  const value = current?.value;
  const monetary = ['purchases', 'sales', 'finance'].includes(resource);
  function preset(value: 'today' | 'week' | 'month' | 'all') {
    const today = businessDate(new Date());
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    setStart(value === 'all' ? '' : value === 'today' ? today : value === 'month' ? today.slice(0, 7) + '-01' : monday.toISOString().slice(0, 10));
    setEnd(value === 'all' ? '' : today);
    setPage(1);
  }
  return <section className="min-w-0 space-y-4 rounded-lg bg-white p-4 shadow dark:bg-gray-800 sm:p-5">
    <h2 className="text-lg font-semibold">{historyLabels[resource]}</h2>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <label>Search records<input type="search" maxLength={150} className={field} value={q} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <label>{resource === 'products' ? 'Category' : resource === 'contacts' ? 'Contact type' : 'Status or type'}
        <input maxLength={100} className={field} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} />
      </label>
      <label>Sort<select className={field} value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
        <option value="latest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option>
        <option value="amount">Amount or quantity</option>
      </select></label>
      {resource !== 'contacts' && <>
        <label>Start date (Kigali)<input type="date" className={field} value={start} onChange={event => { setStart(event.target.value); setPage(1); }} /></label>
        <label>End date (Kigali)<input type="date" className={field} value={end} onChange={event => { setEnd(event.target.value); setPage(1); }} /></label>
      </>}
      {accounts.length > 0 && <label>Account<select className={field} value={account} onChange={event => { setAccount(event.target.value); setPage(1); }}>
        <option value="">All accounts</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>}
      <label>Page size<select className={field} value={size} onChange={event => { setSize(Number(event.target.value)); setPage(1); }}>
        {[10, 20, 50, 100].map(size => <option key={size}>{size}</option>)}
      </select></label>
    </div>
    {resource !== 'contacts' && <div className="flex flex-wrap gap-2" aria-label="Date shortcuts">
      {([['today','Today'],['week','This week'],['month','This month'],['all','All dates']] as const).map(([value,label]) =>
        <button key={value} type="button" className="rounded border px-3 py-1 text-sm" onClick={() => preset(value)}>{label}</button>)}
    </div>}
    {!current && <p role="status">Loading records…</p>}
    {current?.error && <p role="alert">{current.error} <button type="button" className="underline" onClick={() => setRetry(retry + 1)}>Retry</button></p>}
    {value && <>
      <p className="text-sm">{value.total} matching records</p>
      {!value.rows.length ? <p>No matching records.</p> : <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr>{['Date', 'Name', 'Reference', 'Type', 'Detail', monetary ? 'Amount (RWF)' : 'Quantity', ...(action ? ['Action'] : [])]
            .map(title => <th key={title} scope="col" className="px-2 py-2">{title}</th>)}</tr></thead>
          <tbody>{value.rows.map(row => <tr key={row.id} className="border-t">
            <td className="whitespace-nowrap p-2">{row.recorded_at ? businessDate(row.recorded_at) : ''}</td><td className="p-2">{row.name}</td>
            <td className="break-all p-2">{row.reference}</td><td className="p-2">{row.status.replaceAll('_', ' ')}</td>
            <td className="p-2">{row.detail}</td><td className="whitespace-nowrap p-2">{row.amount === null ? '' : monetary ? formatRwf(row.amount) : row.amount}</td>
            {action && <td className="p-2">{action(row)}</td>}
          </tr>)}</tbody>
        </table>
      </div>}
      {value.pages > 1 && <nav aria-label="History pages" className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={value.page === 1} className="rounded border px-3 py-1 disabled:opacity-40" onClick={() => setPage(value.page - 1)}>Previous</button>
        <span>Page {value.page} of {value.pages}</span>
        <button type="button" disabled={value.page === value.pages} className="rounded border px-3 py-1 disabled:opacity-40" onClick={() => setPage(value.page + 1)}>Next</button>
      </nav>}
    </>}
  </section>;
}
