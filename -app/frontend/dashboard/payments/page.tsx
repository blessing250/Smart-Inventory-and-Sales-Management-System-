'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CreditCard } from 'lucide-react';
import { formatRwf } from '@/shared/finance/currency';
import type { Payment, Sale } from '@/shared/types/inventory';
import { postBusiness, readBusiness } from '@/frontend/lib/business-client';
import { usePreferences } from '@/frontend/lib/use-preferences';
import { useAccounts } from '@/frontend/lib/use-accounts';

export default function PaymentsPage() {
  const preferences = usePreferences();
  const { accounts, error: accountError } = useAccounts();
  const [method, setMethod] = useState('Cash');
  const [account, setAccount] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  const [sales, setSales] = useState<(Sale & { balance: number })[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadPayments = async () => {
      const response = await fetch('/api/payments');
      if (!response.ok) {
        setError('Unable to load payments.');
        return;
      }
      setPayments(await response.json());
      setSales(await readBusiness<(Sale & { balance: number })[]>('/api/sales'));
      setError('');
    };

    void loadPayments().catch(() => setError('Unable to load sales and payments.'));
  }, []);

  const openSales = sales.filter(sale => sale.balance > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setError('');
    try {
      await postBusiness('/api/payments', { ...Object.fromEntries(values), account: account || undefined, amount: Number(values.get('amount')) });
      form.reset();
      setPayments(await readBusiness<Payment[]>('/api/payments'));
      setSales(await readBusiness<(Sale & { balance: number })[]>('/api/sales'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to record payment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Payment Tracking</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Track cash, mobile money, bank transfer, and credit payment status.
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        {['Cash', 'Mobile Money', 'Bank Transfer'].map((method) => (
          <div key={method} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <CreditCard className="mb-4 h-6 w-6 text-blue-600" />
            <p className="text-sm text-gray-600 dark:text-gray-400">{method}</p>
            <p className="mt-2 text-2xl font-bold">
              {formatRwf(payments.filter(payment => payment.method === method && !payment.reversed && payment.status === 'Paid').reduce((sum, payment) => sum + payment.amount, 0))}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="mb-6 grid gap-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800 sm:grid-cols-2">
        <label>Outstanding sale<select name="sale_id" required className="block w-full rounded border p-2">
          <option value="">Choose a sale</option>
          {openSales.map(sale => <option key={sale.id} value={sale.id}>{sale.customer_name} · {formatRwf(sale.balance)} · {sale.id.slice(0, 8)}</option>)}
        </select></label>
        <label>Method<select name="method" value={method} onChange={event => { setMethod(event.target.value); setAccount(''); }} className="block w-full rounded border p-2">
          {(['Cash', 'Mobile Money', 'Bank Transfer'] as const).map(method =>
            <option key={method} value={method}>{preferences?.payment_labels[method] ?? method}</option>)}
        </select></label>
        <label>Receiving account<select value={account} onChange={event => setAccount(event.target.value)} className="block w-full rounded border p-2">
          <option value="">Default account for this method</option>
          {accounts.filter(row => row.active && row.currency === 'RWF' && row.kind === method).map(row =>
            <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>{accountError && <span role="alert">{accountError}</span>}</label>
        <label>Amount (RWF)<input required name="amount" type="number" min={1} className="block w-full rounded border p-2" /></label>
        <label>Unique reference<input required name="reference_number" className="block w-full rounded border p-2" /></label>
        <button disabled={saving || !openSales.length} className="rounded bg-blue-700 p-2 text-white disabled:opacity-50">Record customer payment</button>
      </form>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              {['Reference', 'Sale ID', 'Date', 'Method', 'Amount', 'Status'].map((heading) => (
                <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-6 py-4 font-medium">{payment.reference_number}</td>
                <td className="px-6 py-4">{payment.sale_id}</td>
                <td className="px-6 py-4">{new Date(payment.payment_date).toLocaleDateString()}</td>
                <td className="px-6 py-4">{payment.method}</td>
                <td className="px-6 py-4 font-semibold">{formatRwf(payment.amount)}</td>
                <td className="px-6 py-4">
                  <span className={`rounded-full px-3 py-1 text-sm ${payment.status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {payment.reversed ? 'Reversed' : payment.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
