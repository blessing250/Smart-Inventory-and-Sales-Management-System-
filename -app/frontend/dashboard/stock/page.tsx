'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, AlertTriangle } from 'lucide-react';
import type { Product, StockMovement } from '@/shared/types/inventory';

type Count = { id: string; name: string; expected: number; counted: number; reason: string; recorded_at: string };
type Stock = { products: Product[]; movements: StockMovement[]; counts: Count[] };

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState<'Stock In' | 'Stock Out'>('Stock In');
  const [disposition, setDisposition] = useState('');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [counting, setCounting] = useState(false);
  const [savingCount, setSavingCount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStock = async () => {
    setLoading(true);
    const response = await fetch('/api/stock');
    if (!response.ok) {
      setError('Unable to load stock data.');
      setLoading(false);
      return;
    }
    const data: Stock = await response.json();
    setProducts(data.products);
    setMovements(data.movements);
    setCounts(data.counts);
    setProductId((current) => current || data.products[0]?.id || '');
    setError('');
    setLoading(false);
  };

  useEffect(() => {
    fetch('/api/stock')
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load stock data.');
        return response.json() as Promise<Stock>;
      })
      .then((data) => {
        setProducts(data.products);
        setMovements(data.movements);
        setCounts(data.counts);
        setProductId(data.products[0]?.id || '');
        setError('');
        setLoading(false);
      })
      .catch((caughtError: Error) => {
        setError(caughtError.message);
        setLoading(false);
      });
  }, []);

  const handleMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId, quantity, type, reason, disposition: type === 'Stock Out' ? disposition || undefined : undefined }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data.error || 'Unable to save stock movement.');
      return;
    }

    setQuantity(1);
    setReason('');
    await loadStock();
  };

  const selected = products.find(product => product.id === productId);

  async function count(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !window.confirm('Save this count and apply any stock difference?')) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setSavingCount(true);
    try {
      const response = await fetch('/api/stock', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: selected.id, expected: selected.quantity,
          counted: Number(values.get('counted')), reason: values.get('reason') }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to save count.');
      form.reset();
      await loadStock();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save count.');
    } finally {
      setSavingCount(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Stock Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Track stock in and stock out movements with automatic quantity updates.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <form onSubmit={handleMovement} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 lg:col-span-1">
          <h2 className="text-lg font-semibold mb-4">New Movement</h2>
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Product
              <select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Movement Type
              <select value={type} onChange={(event) => setType(event.target.value as 'Stock In' | 'Stock Out')} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                <option>Stock In</option>
                <option>Stock Out</option>
              </select>
            </label>
            {type === 'Stock Out' && <label className="block">Disposition<select value={disposition} onChange={event => setDisposition(event.target.value)} className="block w-full rounded border p-2">
              <option value="">Other adjustment</option><option>Damaged</option><option>Missing</option>
            </select></label>}
            <label className="block text-sm font-medium">
              Quantity
              <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Reason
              <input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2" />
            </label>
            <button className="w-full rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700">Save Movement</button>
          </div>
        </form>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto lg:col-span-2">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                {['Product', 'Current Stock', 'Minimum', 'Status'].map((heading) => (
                  <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-600 dark:text-gray-400">
                    Loading stock...
                  </td>
                </tr>
              ) : products.map((product) => (
                <tr key={product.id} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="px-6 py-4 font-medium">{product.name}</td>
                  <td className="px-6 py-4">{product.quantity}</td>
                  <td className="px-6 py-4">{product.minimum_quantity}</td>
                  <td className="px-6 py-4">
                    {product.quantity <= product.minimum_quantity ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-sm text-red-700">
                        <AlertTriangle size={16} /> Low Stock
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">Available</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="mb-6 space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
        <h2 className="font-semibold">Physical stock counts</h2>
        {selected && <button className="rounded border px-3 py-2" onClick={() => setCounting(!counting)}>
          {counting ? 'Close count form' : `Count ${selected.name}`}
        </button>}
        {counting && selected && <form onSubmit={count} className="flex flex-wrap items-end gap-3">
          <p>System quantity {selected.quantity}</p>
          <label>Physical quantity<input required name="counted" type="number" min={0} className="block rounded border p-2" /></label>
          <label>Reason<input required name="reason" maxLength={500} className="block rounded border p-2" /></label>
          <button disabled={savingCount} className="rounded bg-blue-700 p-2 text-white">Save count</button>
        </form>}
        {!counts.length && <p>No physical counts recorded.</p>}
        <ul>{counts.map(row => <li key={row.id} className="py-2">
          {row.name} · {new Date(row.recorded_at).toLocaleDateString()} · Expected {row.expected}, counted {row.counted} · {row.reason}
        </li>)}</ul>
      </section>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Movement History</h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {movements.map((movement) => (
            <div key={movement.id} className="p-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {movement.type === 'Stock In' ? <ArrowUpCircle className="text-green-600" /> : <ArrowDownCircle className="text-amber-600" />}
                <div>
                  <p className="font-medium">{movement.product_name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {movement.disposition ? `${movement.disposition} · ` : ''}{movement.reason || movement.type} on {new Date(movement.movement_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <p className="text-sm">Quantity: {movement.quantity} | Remaining: {movement.remaining_stock}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
