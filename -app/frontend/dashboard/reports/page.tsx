'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { formatRwf } from '@/shared/finance/currency';
import { OperationalReports } from '@/frontend/components/operational-reports';

type ReportsResponse = {
  weekly: { start: string; revenue: number; profit: number };
  daily: {
    products_sold: number;
    revenue: number;
    expenses: number;
    profit: number;
  };
  monthly: {
    best_selling_products: Array<{ product: string; units: number; revenue: number }>;
    revenue: number;
    purchases: number;
    expenses: number;
    channels: { channel: string; revenue: number }[];
    profit: number;
    remaining_stock: number;
  };
};

const emptyReports: ReportsResponse = {
  weekly: { start: '', revenue: 0, profit: 0 },
  daily: {
    products_sold: 0,
    revenue: 0,
    expenses: 0,
    profit: 0,
  },
  monthly: {
    best_selling_products: [],
    revenue: 0,
    purchases: 0,
    expenses: 0,
    channels: [],
    profit: 0,
    remaining_stock: 0,
  },
};

export default function ReportsPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  const [reports, setReports] = useState<ReportsResponse>(emptyReports);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('');

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const key of ['start', 'end']) {
      const value = form.get(key);
      if (value) query.set(key, String(value));
    }
    setPeriod(query.toString());
  }

  useEffect(() => {
    const loadReports = async () => {
      const response = await fetch(`/api/reports?${period}`);
      if (!response.ok) {
        setError((await response.json()).error || 'Unable to load reports.');
        return;
      }
      setReports(await response.json());
      setError('');
    };

    if (isAdmin) void loadReports().catch(() => setError('Unable to load reports.'));
  }, [isAdmin, period]);

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          Financial reports are available to admin users only.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Reports</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Daily and monthly reporting for sales, purchases, stock, and profit.
          </p>
        </div>
        <div className="flex gap-3">
          <a href={`/api/reports/export?format=pdf&${period}`} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
            <FileText size={18} /> PDF
          </a>
          <a href={`/api/reports/export?format=excel&${period}`} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
            <FileSpreadsheet size={18} /> Excel
          </a>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <form onSubmit={filter} className="mb-5 flex flex-wrap items-end gap-3">
        <label>Start date<input name="start" type="date" className="block rounded border p-2" /></label>
        <label>End date<input name="end" type="date" className="block rounded border p-2" /></label>
        <button className="rounded bg-blue-700 px-4 py-2 text-white">Apply dates</button>
        <button type="reset" className="rounded border px-4 py-2" onClick={() => setPeriod('')}>Current month</button>
      </form>

      {reports.weekly.start && <p className="mb-4">This week since {reports.weekly.start} · Sales {formatRwf(reports.weekly.revenue)} · Gross profit {formatRwf(reports.weekly.profit)}</p>}
      <div className="grid md:grid-cols-4 gap-6 mb-8">
        {[
          ['Revenue', formatRwf(reports.monthly.revenue)],
          ['Operating expenses', formatRwf(reports.monthly.expenses)],
          ['Gross profit', formatRwf(reports.monthly.profit)],
          ['Remaining Stock', reports.monthly.remaining_stock.toString()],
        ].map(([label, value]) => (
          <div key={label} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold">Daily Report</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  {['Metric', 'Value'].map((heading) => (
                    <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Products Sold', `${reports.daily.products_sold} units`],
                  ['Revenue', formatRwf(reports.daily.revenue)],
                  ['Expenses', formatRwf(reports.daily.expenses)],
                  ['Gross Profit', formatRwf(reports.daily.profit)],
                ].map(([metric, value]) => (
                  <tr key={metric} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="px-6 py-4 font-medium">{metric}</td>
                    <td className="px-6 py-4">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{period ? 'Selected period' : 'Current month'}</h2>
            <Download className="h-5 w-5 text-blue-600" />
          </div>
          <div className="p-6 space-y-5">
            {reports.monthly.channels.length > 0 && <div>
              <h3 className="font-medium">Sales by channel</h3>
              <ul>{reports.monthly.channels.map(row => <li key={row.channel}>{row.channel} · {formatRwf(row.revenue)}</li>)}</ul>
            </div>}
            <div>
              <p className="mb-3 font-medium">Best Selling Products</p>
              <div className="space-y-3">
                {reports.monthly.best_selling_products.length === 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">No sales recorded yet.</p>
                ) : reports.monthly.best_selling_products.map((item) => (
                  <div key={item.product} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-700 px-4 py-3">
                    <span>{item.product}</span>
                    <span className="font-semibold">{item.units} units | {formatRwf(item.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">Revenue</p>
                <p className="font-semibold">{formatRwf(reports.monthly.revenue)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">Purchases</p>
                <p className="font-semibold">{formatRwf(reports.monthly.purchases)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">Stock</p>
                <p className="font-semibold">{reports.monthly.remaining_stock} units</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <OperationalReports key={period} period={period} />
    </div>
  );
}
