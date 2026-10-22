'use client';

import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { formatRwf } from '@/app/lib/inventory-demo-data';
import type { Payment } from '@/app/types/inventory';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadPayments = async () => {
      const response = await fetch('/api/payments');
      if (!response.ok) {
        setError('Unable to load payments.');
        return;
      }
      setPayments(await response.json());
      setError('');
    };

    void loadPayments();
  }, []);

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Payment Tracking</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Track cash, mobile money, bank transfer, and credit payment status.
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid md:grid-cols-4 gap-6 mb-8">
        {['Cash', 'Mobile Money', 'Bank Transfer', 'Credit'].map((method) => (
          <div key={method} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <CreditCard className="mb-4 h-6 w-6 text-blue-600" />
            <p className="text-sm text-gray-600 dark:text-gray-400">{method}</p>
            <p className="mt-2 text-2xl font-bold">
              {formatRwf(payments.filter((payment) => payment.method === method).reduce((sum, payment) => sum + payment.amount, 0))}
            </p>
          </div>
        ))}
      </div>

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
                    {payment.status}
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
