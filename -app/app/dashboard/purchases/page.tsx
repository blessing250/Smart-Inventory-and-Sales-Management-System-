'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { formatRwf } from '@/app/lib/inventory-demo-data';
import type { Product, Purchase } from '@/app/types/inventory';

export default function PurchasesPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [supplier, setSupplier] = useState('ABC Ltd');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(100);
  const [unitCost, setUnitCost] = useState(1000);
  const [error, setError] = useState('');
  const total = quantity * unitCost;

  const loadPurchasesPage = async () => {
    const [productsResponse, purchasesResponse] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/purchases'),
    ]);

    if (!productsResponse.ok || !purchasesResponse.ok) {
      setError('Unable to load purchases data.');
      return;
    }

    const nextProducts: Product[] = await productsResponse.json();
    setProducts(nextProducts);
    setPurchases(await purchasesResponse.json());
    setProductId((current) => current || nextProducts[0]?.id || '');
    setError('');
  };

  useEffect(() => {
    Promise.all([fetch('/api/products'), fetch('/api/purchases')])
      .then(async ([productsResponse, purchasesResponse]) => {
        if (!productsResponse.ok || !purchasesResponse.ok) {
          throw new Error('Unable to load purchases data.');
        }
        const nextProducts: Product[] = await productsResponse.json();
        const nextPurchases: Purchase[] = await purchasesResponse.json();
        return { nextProducts, nextPurchases };
      })
      .then(({ nextProducts, nextPurchases }) => {
        setProducts(nextProducts);
        setPurchases(nextPurchases);
        setProductId(nextProducts[0]?.id || '');
        setError('');
      })
      .catch((caughtError: Error) => setError(caughtError.message));
  }, []);

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          Purchase management is available to admin users only.
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplier_name: supplier,
        items: [{ product_id: productId, quantity, unit_cost: unitCost }],
      }),
    });

    if (!response.ok) {
      setError('Unable to save purchase.');
      return;
    }

    await loadPurchasesPage();
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Purchase Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Track supplier purchases and calculate total purchase cost automatically.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Purchase Entry</h2>
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Supplier
              <input value={supplier} onChange={(event) => setSupplier(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Product
              <select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Quantity
              <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Cost Per Unit
              <input type="number" min="0" value={unitCost} onChange={(event) => setUnitCost(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-4 font-semibold">
              Total Purchase Cost: {formatRwf(total)}
            </div>
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700">
              <Plus size={18} /> Save Purchase
            </button>
          </div>
        </form>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto lg:col-span-2">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                {['Purchase ID', 'Supplier', 'Date', 'Total Amount'].map((heading) => (
                  <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="px-6 py-4 font-medium">{purchase.id}</td>
                  <td className="px-6 py-4">{purchase.supplier_name}</td>
                  <td className="px-6 py-4">{new Date(purchase.purchase_date).toLocaleDateString()}</td>
                  <td className="px-6 py-4 font-semibold">{formatRwf(purchase.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
