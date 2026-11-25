'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { readBusiness, postBusiness } from '@/frontend/lib/business-client';
import { formatRwf } from '@/shared/finance/currency';
import { fixedInput } from '@/shared/finance/native-display';

type Case = {
  event: string; item: string; kind: 'damage' | 'shortage'; shipment_reference: string; receipt: string;
  product_name: string; supplier: string; purchase: string; currency: string; explanation: string;
  ordered: number; expected: number; usable: number; damaged: number; missing: number; exposure: number; remaining: number; held: number;
  remainingWithClosure: number | null;
  claim?: { id: string; reference: string; claimant: string; claimed_rwf: number; accepted_rwf: number | null };
  events: { id: string; action: string; reference: string; amount: number; quantity: number; active: number; notes: string }[];
};
type Account = { id: string; name: string; currency: string; active: number };
const field = 'block w-full rounded border border-gray-300 p-2 dark:bg-gray-800';
const actions = {
  claim: 'Submit claim', decide: 'Accept or reject claim', credit: 'Apply accepted supplier credit',
  cash: 'Record verified compensation', recover: 'Restore usable damaged goods', return: 'Return damaged goods',
  loss: 'Approve remaining loss', reverse: 'Reverse a financial resolution',
};

function CaseForm({ row, accounts, busy, submit }: { row: Case; accounts: Account[]; busy: boolean; submit: (value: object) => Promise<boolean> }) {
  const closed = row.events.some(event => event.active && event.action === 'loss');
  const settled = row.events.some(event => event.active && ['credit', 'cash'].includes(event.action));
  const available = (Object.keys(actions) as (keyof typeof actions)[]).filter(action => {
    if (action === 'reverse') return row.events.some(event => event.active && ['credit', 'cash', 'loss'].includes(event.action));
    if (closed) return false;
    if (action === 'claim') return !row.claim;
    if (action === 'decide') return row.claim?.accepted_rwf === null;
    if (action === 'credit' || action === 'cash') return !!row.claim?.accepted_rwf && !settled;
    if (action === 'recover' || action === 'return') return row.held > 0;
    return !row.claim || row.claim.accepted_rwf === 0 || settled;
  });
  const [selected, setSelected] = useState<keyof typeof actions>();
  const [currency, setCurrency] = useState('RWF');
  const [closure, setClosure] = useState(false);
  const action = selected && available.includes(selected) ? selected : available[0];
  const [formError, setFormError] = useState('');
  const consequence = action === 'credit' ? row.currency === 'RWF' ? `Reduce the purchase payable by ${formatRwf(row.claim?.accepted_rwf ?? 0)}.`
    : 'Apply the agreed native credit against the historical value of the purchase payable.'
    : action === 'cash' ? `Post ${formatRwf(row.claim?.accepted_rwf ?? 0)} received into the selected RWF account.`
    : action === 'loss' ? `Recognize ${formatRwf(closure ? row.remainingWithClosure ?? row.remaining : row.remaining)} separately from gross profit. ${closure ? 'Stop awaiting these missing units. ' : ''}The payable changes only through payment or credit.`
    : action === 'recover' ? 'Restore the selected units to available stock at their remaining attributable cost.'
    : action === 'return' ? 'Remove these units from damaged holdings. Any payable change requires a separate credit.'
    : action === 'reverse' ? 'Offset the selected financial event and preserve its original record.'
    : '';
  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setFormError('');
    try {
      const payload = { ...Object.fromEntries(values), action, event: row.event, item: row.item, kind: row.kind,
        claim: row.claim?.id, currency, rate: currency === 'RWF' ? 1000000 : fixedInput(values.get('rate'), 6),
        amount: fixedInput(values.get('amount'), currency === 'RWF' ? 0 : 2), accepted: fixedInput(values.get('accepted'), 0),
        quantity: fixedInput(values.get('quantity'), 0), payable_minor: fixedInput(values.get('payable_minor'), 2),
        close_missing: action === 'loss' && closure };
      if (consequence && !window.confirm(consequence)) return;
      if (await submit(payload)) form.reset();
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Check the amounts.'); }
  }
  return <section className="space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
    <h2 className="font-semibold">{row.product_name} · {row.kind === 'damage' ? 'Damage' : 'Shortage'}</h2>
    <p>{row.shipment_reference} · Receipt {row.receipt} · {row.supplier} · Purchase {row.purchase.slice(0, 8)} ({row.currency})</p>
    <p className="text-sm">Ordered {row.ordered} · Manifest expected {row.expected} · Usable {row.usable} · Damaged {row.damaged} · Missing {row.missing} · Held {row.held}</p>
    <p>{row.explanation}</p>
    <p>Recorded exposure {formatRwf(row.exposure)} · Unresolved {formatRwf(row.remaining)}</p>
    {row.claim && <p>Claim {row.claim.reference} · {row.claim.claimant} · {row.claim.accepted_rwf === null ? 'Under review'
      : row.claim.accepted_rwf === 0 ? 'Rejected' : `Accepted ${formatRwf(row.claim.accepted_rwf)}`} · Requested {formatRwf(row.claim.claimed_rwf)}</p>}
    {row.events.length > 0 && <ul className="text-sm">{row.events.map(entry => <li key={entry.id}>
      {entry.reference} · {entry.action} · {formatRwf(entry.amount)}{entry.quantity > 0 ? ` · ${entry.quantity} units` : ''}{!entry.active && entry.action !== 'reverse' ? ' · Reversed' : ''}
      {' · '}{entry.notes}
    </li>)}</ul>}
    {action && <form onSubmit={post} className="grid gap-3 sm:grid-cols-2">
      <label>Action<select value={action} className={field} onChange={event => setSelected(event.target.value as keyof typeof actions)}>
        {available.map(value => <option key={value} value={value}>{actions[value]}</option>)}
      </select></label>
      {action !== 'decide' && <label>Unique reference<input required name="reference" maxLength={100} className={field} /></label>}
      {action === 'claim' && <>
        <label>Supplier or agent<input required name="claimant" defaultValue={row.supplier} className={field} /></label>
        <label>Claim currency<select value={currency} onChange={event => setCurrency(event.target.value)} className={field}><option>RWF</option><option>USD</option><option>CNY</option></select></label>
        <label>Claimed amount ({currency})<input required inputMode="decimal" name="amount" className={field} /></label>
        {currency !== 'RWF' && <label>RWF per {currency}<input required inputMode="decimal" name="rate" className={field} /></label>}
      </>}
      {action === 'decide' && <label>Accepted amount (RWF, enter 0 to reject)<input required name="accepted" type="number" min={0} max={row.claim?.claimed_rwf} className={field} /></label>}
      {action === 'credit' && row.currency !== 'RWF' && <label>Agreed payable credit ({row.currency})<input required inputMode="decimal" name="payable_minor" className={field} /></label>}
      {action === 'loss' && row.kind === 'shortage' && row.remainingWithClosure !== null && <label className="sm:col-span-2">
        <input type="checkbox" checked={closure} onChange={event => setClosure(event.target.checked)} /> Stop awaiting the missing units and include their historical purchase cost in the loss
      </label>}
      {action === 'cash' && <label>Receiving account<select required name="account" className={field}><option value="">Choose account</option>
        {accounts.filter(account => account.active && account.currency === 'RWF').map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select></label>}
      {(action === 'recover' || action === 'return') && <label>Quantity<input required name="quantity" type="number" min={1} max={row.held} className={field} /></label>}
      {action === 'reverse' && <label>Event<select required name="resolution" className={field}><option value="">Choose event</option>
        {row.events.filter(entry => entry.active && ['credit', 'cash', 'loss'].includes(entry.action)).map(entry => <option key={entry.id} value={entry.id}>{entry.reference} · {entry.action}</option>)}
      </select></label>}
      <label className="sm:col-span-2">Supporting notes<textarea required name="notes" maxLength={1000} className={field} /></label>
      {consequence && <p className="text-sm sm:col-span-2">{consequence}</p>}
      {formError && <p role="alert">{formError}</p>}
      <button disabled={busy} className="justify-self-start rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{actions[action]}</button>
    </form>}
  </section>;
}

export default function ReconciliationPage() {
  const [rows, setRows] = useState<Case[]>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const path = '/api/shipments/reconciliation';
  useEffect(() => {
    Promise.all([readBusiness<Case[]>(path), readBusiness<Account[]>('/api/finance?view=accounts')])
      .then(([cases, options]) => { setRows(cases); setAccounts(options); }).catch(error => setMessage(error.message));
  }, []);
  async function submit(value: object) {
    setBusy(true);
    setMessage('');
    try {
      await postBusiness(path, value);
      setRows(await readBusiness<Case[]>(path));
      setMessage('Resolution updated.');
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save resolution.');
      return false;
    } finally { setBusy(false); }
  }
  return <main className="space-y-5 p-6">
    <h1 className="text-3xl font-bold">Shipment financial reconciliation</h1>
    {message && <p role="status">{message}</p>}
    {!rows && !message && <p>Loading discrepancies…</p>}
    {rows?.length === 0 && <p>No shipment discrepancies have been recorded.</p>}
    {rows?.map(row => <CaseForm key={row.event + row.item + row.kind} row={row} accounts={accounts} busy={busy} submit={submit} />)}
  </main>;
}
