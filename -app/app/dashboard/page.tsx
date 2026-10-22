'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  DollarSign,
  Package,
  ReceiptText,
  ShoppingBasket,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { formatRwf } from '@/app/lib/inventory-demo-data';
import type { DashboardStats, Product, Sale } from '@/app/types/inventory';

const emptyStats: DashboardStats = {
  total_products: 0,
  total_stock: 0,
  total_sales_today: 0,
  total_revenue: 0,
  total_expenses: 0,
  total_profit: 0,
  low_stock_items: [],
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const [statsData, setStatsData] = useState<DashboardStats>(emptyStats);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadDashboard = async () => {
      const response = await fetch('/api/dashboard');
      if (!response.ok) {
        setError('Unable to load dashboard data.');
        return;
      }
      const data: { stats: DashboardStats; products: Product[]; sales: Sale[] } = await response.json();
      setStatsData(data.stats);
      setProducts(data.products);
      setSales(data.sales);
      setError('');
    };

    void loadDashboard();
  }, []);

  const stats = [
    {
      label: 'Total Products',
      value: statsData.total_products.toString(),
      icon: Package,
      change: 'Active catalog items',
    },
    {
      label: 'Total Stock Quantity',
      value: statsData.total_stock.toString(),
      icon: Boxes,
      change: 'Units available now',
    },
    {
      label: 'Total Sales Today',
      value: statsData.total_sales_today.toString(),
      icon: ReceiptText,
      change: 'Recorded on May 26, 2026',
    },
    {
      label: 'Total Revenue',
      value: formatRwf(statsData.total_revenue),
      icon: DollarSign,
      change: 'Today from paid sales',
    },
    {
      label: 'Total Expenses',
      value: formatRwf(statsData.total_expenses),
      icon: TrendingDown,
      change: 'Purchase costs tracked',
    },
    {
      label: 'Total Profit',
      value: formatRwf(statsData.total_profit),
      icon: TrendingUp,
      change: 'Revenue minus expenses',
    },
    {
      label: 'Low Stock Items',
      value: statsData.low_stock_items.length.toString(),
      icon: AlertTriangle,
      change: 'Need restocking attention',
    },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Welcome back, {session?.user?.name}!
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Monitor products, sales, purchases, payments, and profit in one place.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white dark:bg-gray-800 rounded-lg shadow p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  {stat.label}
                </h3>
                <Icon className="w-5 h-5 text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {stat.value}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {stat.change}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Quick Actions
          </h2>
          <div className="grid md:grid-cols-3 gap-3">
            <Link
              href="/dashboard/products"
              className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition"
            >
              <Package className="w-6 h-6 text-blue-600" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  Add Product
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Manage prices, quantity, category, and supplier.
                </p>
              </div>
            </Link>
            <Link
              href="/dashboard/sales"
              className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition"
            >
              <ShoppingBasket className="w-6 h-6 text-emerald-600" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Record Sale</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Sell items and reduce stock automatically.
                </p>
              </div>
            </Link>
            <Link
              href="/dashboard/purchases"
              className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition"
            >
              <ReceiptText className="w-6 h-6 text-amber-600" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Add Purchase</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Track supplier costs and stock in.
                </p>
              </div>
            </Link>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Low Stock Alerts
          </h2>
          <div className="space-y-3 text-sm">
            {statsData.low_stock_items.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">No low stock alerts.</p>
            ) : statsData.low_stock_items.map((product) => (
              <div key={product.id} className="pb-3 border-b border-gray-200 dark:border-gray-700 last:border-0">
                <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                <p className="text-red-600 dark:text-red-400">
                  Remaining {product.quantity}; minimum quantity is {product.minimum_quantity}.
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Products Snapshot</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Product</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Stock</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Selling Price</th>
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 4).map((product) => (
                  <tr key={product.id} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="px-6 py-4 text-sm font-medium">{product.name}</td>
                    <td className="px-6 py-4 text-sm">{product.quantity}</td>
                    <td className="px-6 py-4 text-sm">{formatRwf(product.selling_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Sales</h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {sales.map((sale) => (
              <div key={sale.id} className="p-6 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{sale.id}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {sale.customer_name || 'Walk-in'} via {sale.payment_method}
                  </p>
                </div>
                <p className="font-semibold text-gray-900 dark:text-white">{formatRwf(sale.total_amount)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
