'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { readBusiness, postBusiness } from '@/frontend/lib/business-client';
import { formatRwf } from '@/shared/finance/currency';
import type { Sale, SaleItem } from '@/shared/types/inventory';

type Order = Sale & { balance: number; items: (SaleItem & { name: string; returned: number })[] };
type Return = { id: string; name: string; quantity: number; refund: number; reason: string };
type Accounts = { id: string; name: string; currency: string; active: number }[];
const field = 'block w-full rounded border p-2 dark:bg-gray-800';

async function load() {
  const [sales, returns, accounts] = await Promise.all([
    readBusiness<Order[]>('/api/sales'), readBusiness<Return[]>('/api/sales/returns'), readBusiness<Accounts>('/api/finance?view=accounts'),
  ]);
  return { sales, returns, accounts };
}

export default function ReturnsPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof load>>>();
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    load().then(result => {
      setData(result);
      setSelected(window.location.hash.slice(1));
    }).catch(error => setNotice(error.message));
  }, []);

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm('Record this return and issue any refund due from the selected account?')) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setNotice('');
    try {
      await postBusiness('/api/sales/returns', { ...Object.fromEntries(values), quantity: Number(values.get('quantity')), restock: values.get('restock') === 'on' });
      form.reset();
      setData(await load());
      setNotice('Return recorded.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to record return.');
    } finally {
      setBusy(false);
    }
  }

  const sale = data?.sales.find(row => row.id === selected);
  const items = sale?.items.filter(item => item.returned < item.quantity) ?? [];
  return (
    <main className="space-y-5 p-6">
      <h1 className="text-3xl font-bold">Sales returns</h1>
      {notice && <p role="status">{notice}</p>}
      {!data && !notice && <p>Loading sales…</p>}
      <section className="space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
        <label>Sale<select className={field} value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose a sale</option>
          {data?.sales.map(row => <option key={row.id} value={row.id}>{row.customer_name || 'Walk-in'} · {row.id.slice(0, 8)} · {formatRwf(row.total_amount)}</option>)}
        </select></label>
        {sale && <p>Current outstanding balance {formatRwf(sale.balance)}</p>}
        {sale && !items.length && <p>All items in this sale have been returned.</p>}
        {items.length > 0 && <form key={selected} onSubmit={record} className="grid gap-3 sm:grid-cols-2">
          <label>Product<select required name="item" className={field}>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity - item.returned} returnable</option>)}</select></label>
          <label>Quantity<input name="quantity" required type="number" min={1} className={field} /></label>
          <label>Reason<input name="reason" required className={field} /></label>
          <label>Return reference<input name="reference" required className={field} /></label>
          <label>Refund account, if a refund is due<select name="account" className={field}><option value="">Use original account when unambiguous</option>
            {data?.accounts.filter(account => account.active && account.currency === 'RWF').map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="self-end p-2"><input type="checkbox" name="restock" /> Return usable units to stock</label>
          <button disabled={busy} className="rounded bg-blue-700 p-2 text-white">Record return</button>
        </form>}
      </section>
      <section className="rounded-lg bg-white p-5 shadow dark:bg-gray-800">
        <h2 className="font-semibold">Return history</h2>
        {data?.returns.length === 0 && <p>No returns recorded.</p>}
        <ul>{data?.returns.map(row => <li className="border-b p-2" key={row.id}>{row.quantity} × {row.name} · {row.reason} · Refund {formatRwf(row.refund)}</li>)}</ul>
      </section>
    </main>
  );
}
