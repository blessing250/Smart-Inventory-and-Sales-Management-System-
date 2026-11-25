'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { readBusiness, postBusiness } from '@/frontend/lib/business-client';
import { formatRwf } from '@/shared/finance/currency';
import type { Sale, Purchase } from '@/shared/types/inventory';
import { ContactSelect } from '@/frontend/components/contact-select';

type Contact = {
  id: string; name: string; kind: string; phone: string; email: string; location: string; balance: number;
  sales: Sale[]; purchases: Purchase[]; orders: { id: string; status: string; source: string }[];
};
const field = 'block w-full rounded border p-2 dark:bg-gray-800';
type Unlinked = { id: string; kind: 'sale' | 'purchase' | 'order'; name: string; recorded_at: string };

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>();
  const [selection, setSelection] = useState<Contact>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlinked, setUnlinked] = useState<Unlinked[]>([]);
  const [transaction, setTransaction] = useState('');
  const [contact, setContact] = useState('');
  useEffect(() => { readBusiness<Contact[]>('/api/contacts').then(setContacts).catch(error => setMessage(error.message)); }, []);
  useEffect(() => {
    readBusiness<Unlinked[]>('/api/contacts?view=unlinked').then(setUnlinked).catch(error => setMessage(error.message));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      await postBusiness('/api/contacts', { ...Object.fromEntries(new FormData(form)), id: selection?.id, create: !selection });
      setContacts(await readBusiness<Contact[]>('/api/contacts'));
      form.reset();
      setSelection(undefined);
      setMessage('Contact saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save contact.');
    } finally {
      setBusy(false);
    }
  }

  const selectedTransaction = unlinked.find(row => row.id === transaction);
  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTransaction || !contact || !window.confirm('Link this historical transaction to the selected contact?')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/contacts', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedTransaction.id, kind: selectedTransaction.kind, contact }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to link transaction.');
      const [directory, pending] = await Promise.all([
        readBusiness<Contact[]>('/api/contacts'), readBusiness<Unlinked[]>('/api/contacts?view=unlinked'),
      ]);
      setContacts(directory);
      setUnlinked(pending);
      setTransaction('');
      setContact('');
      setMessage('Transaction linked.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to link transaction.');
    } finally { setBusy(false); }
  }

  return (
    <main className="space-y-5 p-6">
      <h1 className="text-3xl font-bold">Contacts</h1>
      {message && <p role="status">{message}</p>}
      {!contacts && !message && <p>Loading contacts…</p>}
      <form key={selection?.id || 'new'} onSubmit={save} className="grid gap-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800 sm:grid-cols-2">
        <label>Type{selection ? <input readOnly name="kind" value={selection.kind} className={field} /> :
          <select name="kind" className={field}><option>Customer</option><option>Supplier</option><option>Agent</option></select>}</label>
        <label>Name<input name="name" required defaultValue={selection?.name} className={field} /></label>
        <label>Phone<input name="phone" type="tel" defaultValue={selection?.phone} className={field} /></label>
        <label>Email<input name="email" type="email" defaultValue={selection?.email} className={field} /></label>
        <label>Country or address<input name="location" defaultValue={selection?.location} className={field} /></label>
        <div className="flex items-end gap-2"><button disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white">Save contact</button>
          {selection && <button type="button" className="rounded border px-4 py-2" onClick={() => setSelection(undefined)}>New contact</button>}</div>
      </form>
      {!!unlinked.length && <form onSubmit={link} className="space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
        <h2 className="font-semibold">Review unlinked transactions</h2>
        <label>Transaction<select value={transaction} className={field} required onChange={event => {
          setTransaction(event.target.value);
          setContact('');
        }}><option value="">Choose a transaction</option>
          {unlinked.map(row => <option key={row.id} value={row.id}>{row.kind} · {row.name} · {row.recorded_at.slice(0, 10)} · {row.id.slice(0, 8)}</option>)}
        </select></label>
        {selectedTransaction && <ContactSelect key={selectedTransaction.id} kind={selectedTransaction.kind === 'purchase' ? 'Supplier' : 'Customer'}
          value={contact} onChange={setContact} required />}
        <button disabled={busy || !contact} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">Link transaction</button>
      </form>}
      {contacts?.length === 0 && <p>No contacts registered.</p>}
      {contacts?.map(contact => (
        <details key={contact.id} className="rounded-lg bg-white p-5 shadow dark:bg-gray-800">
          <summary className="cursor-pointer font-semibold">{contact.name} · {contact.kind} {contact.kind !== 'Agent' && <>· Outstanding {formatRwf(contact.balance)}</>}</summary>
          <p className="py-2">{[contact.phone, contact.email, contact.location].filter(Boolean).join(' · ')}</p>
          <button className="underline" onClick={() => setSelection(contact)}>Edit contact details</button>
          {contact.sales.length > 0 && <><h2 className="mt-3 font-medium">Sales</h2><ul>{contact.sales.map(row => <li key={row.id}>{new Date(row.sale_date).toLocaleDateString()} · {formatRwf(row.total_amount)}</li>)}</ul></>}
          {contact.purchases.length > 0 && <><h2 className="mt-3 font-medium">Purchases</h2><ul>{contact.purchases.map(row => <li key={row.id}>{new Date(row.purchase_date).toLocaleDateString()} · {formatRwf(row.total_amount)}</li>)}</ul></>}
          {contact.orders.length > 0 && <><h2 className="mt-3 font-medium">Online orders</h2><ul>{contact.orders.map(row => <li key={row.id}>{row.source} · {row.status}</li>)}</ul></>}
        </details>
      ))}
    </main>
  );
}
