'use client';

import { useEffect, useState } from 'react';
import { readBusiness } from '@/frontend/lib/business-client';

type Contact = { id: string; kind: string; name: string; phone: string; email: string; location: string };
type ContactKind = 'Customer' | 'Supplier';
export type ContactDirectory = {
  list: (kind: ContactKind) => Promise<Contact[]>;
  create: (kind: ContactKind, name: string, phone: string) => Promise<{ id: string }>;
};

export function ContactSelect({ kind, value, onChange, required = false, directory }: {
  kind: ContactKind; value: string; onChange: (value: string) => void; required?: boolean; directory?: ContactDirectory;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    (directory ? directory.list(kind) : readBusiness<Contact[]>('/api/contacts?view=directory'))
      .then(result => { if (live) setContacts(result); })
      .catch(() => { if (live) setError('Saved contacts could not be loaded.'); });
    return () => { live = false; };
  }, [directory, kind]);
  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      let result: { id: string };
      if (directory) {
        result = await directory.create(kind, name, phone);
      } else {
        const response = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, name, phone, email: '', location: '', create: true }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to save contact.');
        result = body;
      }
      setContacts(current => [...current, { id: result.id, kind, name: name.trim(), phone, email: '', location: '' }]);
      onChange(result.id);
      setName('');
      setPhone('');
      setQuery('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save contact.'); }
    finally { setSaving(false); }
  }
  const matches = contacts.filter(contact => contact.kind === kind && (contact.id === value ||
    `${contact.name} ${contact.phone} ${contact.email} ${contact.location}`.toLowerCase().includes(query.trim().toLowerCase())));
  return <div className="space-y-2 text-sm">
    <label className="block">Search saved {kind.toLowerCase()}s
      <input type="search" value={query} onChange={event => {
        const next = event.target.value;
        setQuery(next);
        const candidates = contacts.filter(contact => contact.kind === kind &&
          contact.name.toLowerCase() === next.trim().toLowerCase());
        if (candidates.length === 1) onChange(candidates[0].id);
      }} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
      className="mt-1 block w-full rounded border px-3 py-2 dark:bg-gray-800" />
    </label>
    <label className="block font-medium">Saved {kind.toLowerCase()}
    <select required={required} value={value} onChange={event => onChange(event.target.value)}
      className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800">
      <option value="">{required ? 'Choose a contact' : 'Enter a name manually'}</option>
      {matches.map(contact => <option key={contact.id} value={contact.id}>
        {contact.name} · {contact.phone || contact.email || contact.location || 'Contact'} · {contact.id.slice(0, 8)}
      </option>)}
    </select>
    </label>
    {query && !matches.length && <p>No saved contacts match this search.</p>}
    <details>
      <summary className="cursor-pointer underline">Add {kind.toLowerCase()}</summary>
      <label className="mt-2 block">Name<input value={name} maxLength={200} onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
        className="block w-full rounded border px-3 py-2 dark:bg-gray-800" /></label>
      <label className="mt-2 block">Phone (optional)<input type="tel" value={phone} maxLength={100} onChange={event => setPhone(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
        className="block w-full rounded border px-3 py-2 dark:bg-gray-800" /></label>
      <button type="button" disabled={!name.trim() || saving} onClick={() => void create()}
        className="mt-2 rounded border px-3 py-2 disabled:opacity-50">{saving ? 'Saving…' : 'Save and select contact'}</button>
    </details>
    {error && <span role="status">{error}</span>}
  </div>;
}
