'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { postBusiness, readBusiness } from '@/frontend/lib/business-client';
import { formatRwf } from '@/shared/finance/currency';
import type { Purchase, PurchaseItem, Product } from '@/shared/types/inventory';

type Reconciliation = { item_id: string; usable: number; damaged: number; missing: number; explanation: string;
  supplier_cost: number; damaged_supplier_cost: number; allocated_expense: number; capitalized_expense: number };
type Shipment = {
  id: string; reference: string; agent: string; status: string; expenses: number; landed_cost: number;
  charges: { kind: string; amount: number }[];
  manifest?: { origin: string; destination: string; expected_date: string; notes: string; expected_expenses: number; allocation: string | null };
  lines: { purchase_item_id: string; product_name: string; supplier_name: string; expected: number;
    usable: number; damaged: number; missing: number; outstanding: number }[];
  events: { id: string; reference: string; actor_name: string; recorded_at: string; lines: Reconciliation[] }[];
};
type Order = Purchase & { items: (PurchaseItem & { received_quantity: number; damaged_quantity: number; reserved_quantity: number; closed_quantity: number })[] };
const input = 'w-full rounded border p-2 dark:bg-gray-800';
const card = 'space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800';
const button = 'rounded bg-blue-700 p-2 text-white disabled:opacity-50';
const expenses = ['shipping', 'customs', 'clearing', 'other'] as const;
const outcomes = ['usable', 'damaged', 'missing'] as const;

function Charges() {
  return <fieldset className="space-y-3">
    <legend className="font-medium">Actual shipment charges</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {expenses.map(kind => <label className="capitalize" key={kind}>{kind} (RWF)<input name={kind} type="number" min={0} className={input} /></label>)}
    </div>
    <label className="block">Allocate charges by<select name="allocation" className={input}>
      <option value="quantity">Quantity</option><option value="value">Supplier value</option>
    </select></label>
  </fieldset>;
}

async function load() {
  const [shipments, orders, products] = await Promise.all([
    readBusiness<Shipment[]>('/api/shipments'),
    readBusiness<Order[]>('/api/purchases'),
    readBusiness<Product[]>('/api/products'),
  ]);
  return { shipments, orders, products };
}

export default function ShipmentsPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof load>>>();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const receiptKeys = useRef(new Map<string, { payload: string; reference: string }>());
  useEffect(() => { load().then(setData).catch(error => setMessage(error.message)); }, []);

  async function save(command: { action: string; id?: string; [key: string]: unknown }, form?: HTMLFormElement) {
    setWorking(true);
    setMessage('');
    try {
      await postBusiness('/api/shipments', command);
      if (command.action === 'record' && command.id) receiptKeys.current.delete(command.id);
      form?.reset();
      setData(await load());
      setMessage('Shipment saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save.');
    } finally {
      setWorking(false);
    }
  }

  const lines = data?.orders.flatMap(order => order.items
    .map(item => ({ ...item, supplier: order.supplier_name,
      available: item.quantity - item.received_quantity - item.damaged_quantity - item.reserved_quantity - item.closed_quantity }))
    .filter(item => item.available > 0)) ?? [];

  function receive(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (!window.confirm('Confirm the quantities received and close this shipment?')) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    void save({
      action: 'receive', id, allocation: values.get('allocation'),
      lines: lines.map(item => ({ item_id: item.id, quantity: Number(values.get(item.id)) })).filter(item => item.quantity > 0),
      expenses: Object.fromEntries(expenses.map(kind => [kind, Number(values.get(kind))])),
    }, form);
  }

  function record(event: FormEvent<HTMLFormElement>, row: Shipment) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const charges = row.manifest?.allocation ? undefined : {
      allocation: values.get('allocation'),
      expenses: Object.fromEntries(expenses.map(kind => [kind, Number(values.get(kind))])),
    };
    const result = row.lines.map(line => {
      const key = line.purchase_item_id;
      return {
        item_id: key, usable: Number(values.get(key + '-usable')), damaged: Number(values.get(key + '-damaged')),
        missing: Number(values.get(key + '-missing')), explanation: String(values.get(key + '-explanation') ?? ''),
      };
    }).filter(line => line.usable + line.damaged + line.missing > 0);
    if (!result.length) { setMessage('Enter a quantity for at least one purchase line.'); return; }
    if ((charges || result.some(line => line.missing || line.damaged)) &&
        !window.confirm(charges ? 'Record this receipt and lock the actual charges for this shipment?' : 'Confirm the damaged or missing quantities?')) return;
    const payload = JSON.stringify({ charges, lines: result });
    const manual = String(values.get('receipt') ?? '').trim();
    const previous = receiptKeys.current.get(row.id);
    const reference = manual || (previous?.payload === payload ? previous.reference : crypto.randomUUID());
    receiptKeys.current.set(row.id, { payload, reference });
    void save({ action: 'record', id: row.id, reference, charges, lines: result }, form);
  }

  return (
    <main className="space-y-5 p-6">
      <h1 className="text-3xl font-bold">Shipments</h1>
      <Link href="/dashboard/shipments/reconciliation" className="inline-block text-blue-700 underline dark:text-blue-300">Review damage, shortages and claims</Link>
      {message && <p role="status">{message}</p>}
      {!data && !message && <p>Loading shipments…</p>}
      <form className={card} onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const planned = lines.map(item => ({ item_id: item.id, quantity: Number(values.get(item.id)) })).filter(item => item.quantity > 0);
        if (!planned.length) { setMessage('Enter an expected quantity for at least one purchase line.'); return; }
        void save({ action: 'create', reference: values.get('reference'), agent: values.get('agent'), manifest: {
          origin: values.get('origin'), destination: values.get('destination'), expected_date: values.get('expected_date'),
          notes: values.get('notes'), expected_expenses: Number(values.get('expected_expenses')), lines: planned,
        } }, form);
      }}>
        <h2 className="font-semibold">New shipment</h2>
        <label className="block">Tracking or shipment reference<input required name="reference" className={input} /></label>
        <label className="block">Shipping agent<input required name="agent" className={input} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Origin<input name="origin" className={input} /></label>
          <label>Destination<input name="destination" className={input} defaultValue="Kigali" /></label>
          <label>Expected arrival<input name="expected_date" type="date" className={input} /></label>
          <label>Estimated charges (RWF)<input name="expected_expenses" type="number" min={0} className={input} /></label>
        </div>
        <label className="block">Notes<textarea name="notes" className={input} /></label>
        <fieldset className="space-y-2">
          <legend className="font-medium">Purchase quantities to reserve</legend>
          {lines.map(item => <label className="block" key={item.id}>
            {data?.products.find(product => product.id === item.product_id)?.name} · {item.supplier} · PO {item.purchase_id.slice(0, 8)} · {item.available} unreserved
            <input name={item.id} type="number" min={0} max={item.available} className={input} />
          </label>)}
          {!lines.length && <p>No unreserved purchase quantities. Add a purchase order to plan a shipment.</p>}
        </fieldset>
        <button disabled={working || !lines.length} className={button}>Create manifest</button>
      </form>
      {data?.shipments.length === 0 && <p>No shipments recorded.</p>}
      {data?.shipments.map(row => (
        <section key={row.id} className={card}>
          <h2 className="font-semibold">{row.reference} · {row.status}</h2>
          <p>{row.agent}</p>
          {row.manifest && <>
            <p>{[row.manifest.origin, row.manifest.destination].filter(Boolean).join(' → ')}
              {row.manifest.expected_date && <> · Expected {row.manifest.expected_date}</>}</p>
            <p>Estimated charges {formatRwf(row.manifest.expected_expenses)} · Actual charges {formatRwf(row.expenses)} · Capitalized landed cost {formatRwf(row.landed_cost)}</p>
            {row.manifest.allocation && <p className="text-sm capitalize">{row.charges.map(charge => `${charge.kind} ${formatRwf(charge.amount)}`).join(' · ')}</p>}
            {row.manifest.notes && <p>{row.manifest.notes}</p>}
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead><tr>{['Purchase line', 'Expected', 'Received', 'Usable', 'Damaged', 'Missing', 'Outstanding'].map(heading =>
                <th key={heading} scope="col" className="p-2">{heading}</th>)}</tr></thead>
              <tbody>{row.lines.map(line => <tr className="border-t" key={line.purchase_item_id}>
                <th scope="row" className="p-2">{line.product_name} · {line.supplier_name}</th>
                {[line.expected, line.usable + line.damaged, line.usable, line.damaged, line.missing, line.outstanding].map((value, index) =>
                  <td className="p-2 tabular-nums" key={index}>{value}</td>)}
              </tr>)}</tbody>
            </table></div>
            {!!row.events.length && <details>
              <summary className="cursor-pointer font-medium">Receipt history ({row.events.length})</summary>
              {row.events.map(entry => <div className="border-t py-2 text-sm" key={entry.id}>
                <p>{entry.reference} · {entry.actor_name} · {new Date(entry.recorded_at).toLocaleDateString('en-RW', { timeZone: 'Africa/Kigali' })}</p>
                {entry.lines.map(line => <p key={line.item_id}>
                  {row.lines.find(plan => plan.purchase_item_id === line.item_id)?.product_name} · {line.usable} usable · {line.damaged} damaged · {line.missing} missing
                  {' · '}Capitalized {formatRwf(line.supplier_cost + line.capitalized_expense)}
                  {' · '}Uncapitalized {formatRwf(line.damaged_supplier_cost + line.allocated_expense - line.capitalized_expense)}
                  {line.explanation && <> · {line.explanation}</>}
                </p>)}
              </div>)}
            </details>}
            {row.status !== 'Received' && <form key={row.events.length} className="space-y-3 border-t pt-3" onSubmit={event => record(event, row)}>
              <h3 className="font-medium">Record a receiving event</h3>
              {row.lines.filter(line => line.outstanding > 0).map(line => <fieldset className="grid gap-2 rounded border p-3 sm:grid-cols-3" key={line.purchase_item_id}>
                <legend>{line.product_name} · {line.outstanding} outstanding</legend>
                {outcomes.map(outcome => <label className="capitalize" key={outcome}>{outcome}
                  <input name={line.purchase_item_id + '-' + outcome} type="number" min={0} max={line.outstanding} className={input} />
                </label>)}
                <label className="sm:col-span-3">Explanation for damage or confirmed shortage<input name={line.purchase_item_id + '-explanation'} maxLength={500} className={input} /></label>
              </fieldset>)}
              {!row.manifest.allocation && <Charges />}
              <details><summary className="cursor-pointer">Receipt reference (optional)</summary>
                <label className="block">Your receipt reference<input maxLength={100} name="receipt" placeholder="Generated automatically if blank" className={input} /></label>
              </details>
              <button disabled={working} className={button}>Record receipt</button>
            </form>}
          </>}
          {row.status === 'Planned' && <button disabled={working} className={button} onClick={() => void save({ action: 'dispatch', id: row.id })}>Mark in transit</button>}
          {!row.manifest && (row.status === 'Received' ? <p>Import charges {formatRwf(row.expenses)} · Landed cost {formatRwf(row.landed_cost)}</p> : (
            <form onSubmit={event => receive(event, row.id)} className="space-y-3">
              <fieldset className="space-y-2">
                <legend className="font-medium">Confirmed quantities</legend>
                {lines.map(item => (
                  <label className="block" key={item.id}>
                    {data.products.find(product => product.id === item.product_id)?.name} · {item.supplier} · {item.available} unreserved
                    <input name={item.id} type="number" min={0} max={item.available} className={input} />
                  </label>
                ))}
                {!lines.length && <p>Create a purchase order before confirming quantities.</p>}
              </fieldset>
              <Charges />
              <button disabled={working || !lines.length} className={button}>Confirm receipt and close shipment</button>
            </form>
          ))}
        </section>
      ))}
    </main>
  );
}
