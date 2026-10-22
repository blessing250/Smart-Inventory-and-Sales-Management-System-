'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus, ReceiptText } from 'lucide-react';
import { formatRwf } from '@/app/lib/inventory-demo-data';
import type { Product, Sale } from '@/app/types/inventory';

type CartItem = {
  productId: string;
  quantity: number;
};

export default function SalesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [customer, setCustomer] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Sale['payment_method']>('Mobile Money');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [error, setError] = useState('');

  const loadSalesPage = async () => {
    const [productsResponse, salesResponse] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/sales'),
    ]);

    if (!productsResponse.ok || !salesResponse.ok) {
      setError('Unable to load sales data.');
      return;
    }

    const nextProducts: Product[] = await productsResponse.json();
    const nextSales: Sale[] = await salesResponse.json();
    setProducts(nextProducts);
    setSales(nextSales);
    setCart((current) => current.length > 0 ? current : [{ productId: nextProducts[0]?.id || '', quantity: 1 }]);
    setError('');
  };

  useEffect(() => {
    Promise.all([fetch('/api/products'), fetch('/api/sales')])
      .then(async ([productsResponse, salesResponse]) => {
        if (!productsResponse.ok || !salesResponse.ok) {
          throw new Error('Unable to load sales data.');
        }
        const nextProducts: Product[] = await productsResponse.json();
        const nextSales: Sale[] = await salesResponse.json();
        return { nextProducts, nextSales };
      })
      .then(({ nextProducts, nextSales }) => {
        setProducts(nextProducts);
        setSales(nextSales);
        setCart([{ productId: nextProducts[0]?.id || '', quantity: 1 }]);
        setError('');
      })
      .catch((caughtError: Error) => setError(caughtError.message));
  }, []);

  const total = useMemo(
    () =>
      cart.reduce((sum, item) => {
        const product = products.find((current) => current.id === item.productId);
        return sum + (product?.selling_price ?? 0) * item.quantity;
      }, 0),
    [cart, products]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: customer || null,
        payment_method: paymentMethod,
        items: cart.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
        })),
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data.error || 'Unable to save sale.');
      return;
    }

    setCustomer('');
    setCart([{ productId: products[0]?.id || '', quantity: 1 }]);
    await loadSalesPage();
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Sales Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Record every sale with customer, item, quantity, unit price, total, and payment method.
        </p>
      </div>

      <div className="grid xl:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 xl:col-span-1">
          <h2 className="text-lg font-semibold mb-4">Create Sale</h2>
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Customer
              <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Optional" className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Payment Method
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as Sale['payment_method'])} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                <option>Cash</option>
                <option>Mobile Money</option>
                <option>Bank Transfer</option>
                <option>Credit</option>
              </select>
            </label>

            {cart.map((item, index) => {
              const product = products.find((current) => current.id === item.productId);
              return (
                <div key={index} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <label className="block text-sm font-medium">
                    Product
                    <select
                      value={item.productId}
                      onChange={(event) =>
                        setCart((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, productId: event.target.value } : entry
                          )
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2"
                    >
                      {products.map((productOption) => (
                        <option key={productOption.id} value={productOption.id}>{productOption.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-3 block text-sm font-medium">
                    Quantity
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(event) =>
                        setCart((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, quantity: Number(event.target.value) } : entry
                          )
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2"
                    />
                  </label>
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                    Unit price: {formatRwf(product?.selling_price ?? 0)} | Subtotal: {formatRwf((product?.selling_price ?? 0) * item.quantity)}
                  </p>
                </div>
              );
            })}

            <button type="button" onClick={() => setCart((current) => [...current, { productId: products[0]?.id || '', quantity: 1 }])} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700">
              <Plus size={18} /> Add Item
            </button>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-4 text-lg font-semibold">
              Total: {formatRwf(total)}
            </div>
            <button className="w-full rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700">Save Sale</button>
          </div>
        </form>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto xl:col-span-2">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                {['Sale ID', 'Date', 'Customer', 'Payment', 'Total'].map((heading) => (
                  <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="px-6 py-4 font-medium"><ReceiptText className="mr-2 inline h-4 w-4" />{sale.id}</td>
                  <td className="px-6 py-4">{new Date(sale.sale_date).toLocaleDateString()}</td>
                  <td className="px-6 py-4">{sale.customer_name || 'Walk-in Customer'}</td>
                  <td className="px-6 py-4">{sale.payment_method}</td>
                  <td className="px-6 py-4 font-semibold">{formatRwf(sale.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
