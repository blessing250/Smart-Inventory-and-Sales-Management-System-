'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { formatRwf } from '@/shared/finance/currency';
import type { Product, Sale } from '@/shared/types/inventory';
import Link from 'next/link';
import { ContactSelect } from '@/frontend/components/contact-select';
import { usePreferences } from '@/frontend/lib/use-preferences';
import { useAccounts } from '@/frontend/lib/use-accounts';
import { BusinessHistory } from '@/frontend/components/business-history';

type CartItem = {
  productId: string;
  quantity: number;
  discount?: number;
};
type Method = Exclude<Sale['payment_method'], 'Credit'>;
type AdditionalPayment = { id: number; method: Method; account: string; amount: string; reference: string };
const paymentMethods = ['Cash', 'Mobile Money', 'Bank Transfer'] as const;

export default function SalesPage() {
  const preferences = usePreferences();
  const { accounts, error: accountError } = useAccounts();
  const [products, setProducts] = useState<Product[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [customer, setCustomer] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [receivingAccount, setReceivingAccount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [additional, setAdditional] = useState<AdditionalPayment[]>([]);
  const [channel, setChannel] = useState('Physical shop');
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Sale['payment_method']>('Mobile Money');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSale, setLastSale] = useState('');
  const request = useRef<{ payload: string; key: string } | null>(null);

  const loadSalesPage = async () => {
    const productsResponse = await fetch('/api/products');

    if (!productsResponse.ok) {
      setError('Unable to load sales data.');
      return;
    }

    const nextProducts: Product[] = await productsResponse.json();
    setProducts(nextProducts);
    setCart([{ productId: nextProducts.find(product => product.quantity > 0)?.id || '', quantity: 1 }]);
    setError('');
  };

  useEffect(() => {
    fetch('/api/products')
      .then(async productsResponse => {
        if (!productsResponse.ok) {
          throw new Error('Unable to load sales data.');
        }
        const nextProducts: Product[] = await productsResponse.json();
        return nextProducts;
      })
      .then(nextProducts => {
        setProducts(nextProducts);
        setCart([{ productId: nextProducts.find(product => product.quantity > 0)?.id || '', quantity: 1 }]);
        setError('');
      })
      .catch((caughtError: Error) => setError(caughtError.message));
  }, []);

  const total = useMemo(
    () =>
      cart.reduce((sum, item) => {
        const product = products.find((current) => current.id === item.productId);
        return sum + ((product?.selling_price ?? 0) - (item.discount ?? 0)) * item.quantity;
      }, 0),
    [cart, products]
  );
  const eligible = (method: string) => accounts.filter(account => account.active && account.currency === 'RWF' && account.kind === method);
  const primaryAmount = paymentMethod === 'Credit' ? 0 : paidAmount === '' ? (additional.length ? 0 : total) : Number(paidAmount);
  const initialPaid = primaryAmount + additional.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const primaryAccount = receivingAccount || eligible(paymentMethod).find(account => account.id === paymentMethod)?.id || '';
  const updateAdditional = (id: number, update: Partial<AdditionalPayment>) =>
    setAdditional(current => current.map(payment => payment.id === id ? { ...payment, ...update } : payment));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      for (const productId of new Set(cart.map(row => row.productId))) {
        const product = products.find(row => row.id === productId);
        const ordered = cart.filter(row => row.productId === productId).reduce((sum,row) => sum + row.quantity,0);
        if (!product || product.quantity < ordered) throw new Error(product ? `Only ${product.quantity} units of ${product.name} are available.` : 'Choose a product for each sale line.');
      }
      if (initialPaid > total) throw new Error('Collected payments cannot exceed the sale total.');
      if (primaryAmount > 0 && !primaryAccount) throw new Error('Choose a receiving account.');
      const payments = [
        ...(primaryAmount > 0 ? [{ method: paymentMethod, account: primaryAccount, amount: primaryAmount,
          reference_number: paymentReference.trim() || undefined }] : []),
        ...additional.map(payment => ({ method: payment.method, account: payment.account, amount: Number(payment.amount),
          reference_number: payment.reference.trim() || undefined })),
      ];
      const payload = {
        customer_name: customer || null,
        customer_id: customerId || undefined,
        payment_method: payments[0]?.method ?? 'Credit',
        channel,
        payments,
        items: cart.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
          unit_discount: item.discount,
        })),
      };
      const serialized = JSON.stringify(payload);
      if (request.current?.payload !== serialized) request.current = { payload: serialized, key: crypto.randomUUID() };
      const response = await fetch('/api/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, request_key: request.current.key }),
      });
      const sale = await response.json();
      if (!response.ok) throw new Error(sale.error || 'Unable to save sale.');
      request.current = null;
      setLastSale(sale.id);
      setHistoryVersion(version => version + 1);
      setCustomer('');
      setCustomerId('');
      setPaidAmount('');
      setPaymentReference('');
      setAdditional([]);
      setCart([]);
      await loadSalesPage();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save sale.');
    } finally {
      setSaving(false);
    }
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
          {lastSale && <p role="status" className="mb-3">Sale saved. <a className="underline" href={`/api/sales/receipt?id=${lastSale}`}>Download receipt</a></p>}
          <div className="space-y-4">
            <label className="block">Find product by name or SKU
              <input type="search" value={search} onChange={event => {
                const value = event.target.value;
                setSearch(value);
                const match = products.find(row => row.quantity > 0 && row.sku?.toLowerCase() === value.trim().toLowerCase());
                if (match) setCart(current => current.length === 1 ? [{ productId: match.id, quantity: 1 }] : current);
              }} className="block w-full rounded border p-2" />
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
                            entryIndex === index ? { ...entry, productId: event.target.value, discount: 0 } : entry
                          )
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2"
                    >
                      {products.filter(option => option.id === item.productId ||
                        `${option.name} ${option.sku ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())).map((productOption) => (
                        <option key={productOption.id} disabled={!productOption.quantity} value={productOption.id}>
                          {productOption.name} · {productOption.quantity} available
                        </option>
                      ))}
                    </select>
                  </label>
                  {cart.length > 1 && <button type="button" className="mt-2 underline" onClick={() => setCart(current => current.filter((_, lineIndex) => index !== lineIndex))}>Remove item</button>}
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
                    {product?.quantity ?? 0} available · {formatRwf(product?.selling_price ?? 0)} each · {formatRwf(((product?.selling_price ?? 0) - (item.discount ?? 0)) * item.quantity)} subtotal
                  </p>
                  <label className="block">Unit discount (RWF)
                    <input type="number" min={0} max={product?.selling_price ?? 0} value={item.discount ?? 0}
                      onChange={event => setCart(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, discount: Number(event.target.value) } : line))}
                      className="block w-full rounded border p-2" />
                  </label>
                </div>
              );
            })}

            <button type="button" onClick={() => setCart((current) => [...current, { productId: products.find(product => product.quantity > 0)?.id || '', quantity: 1 }])} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700">
              <Plus size={18} /> Add Item
            </button>
            <label className="block text-sm font-medium">
              Customer
              <input disabled={!!customerId} value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Optional" className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <ContactSelect kind="Customer" value={customerId} onChange={setCustomerId} />
            <label className="block text-sm font-medium">
              Payment Method
              <select value={paymentMethod} onChange={(event) => {
                setPaymentMethod(event.target.value as Sale['payment_method']);
                setReceivingAccount('');
              }} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                {(['Cash', 'Mobile Money', 'Bank Transfer', 'Credit'] as const).map(method =>
                  <option key={method} value={method}>{preferences?.payment_labels[method] ?? method}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Sales channel
              <input required list="sale-channels" value={channel} onChange={event => setChannel(event.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2" />
              <datalist id="sale-channels">{(preferences?.channels ?? ['Physical shop', 'Online']).map(channel =>
                <option key={channel} value={channel} />)}</datalist>
            </label>
            {accountError && <p role="alert">{accountError}</p>}
            {paymentMethod !== 'Credit' && (<>
              <label className="block text-sm font-medium">
                Payment received (RWF{additional.length ? '' : ', blank for full payment'})
                <input type="number" min={0} value={paidAmount} onChange={event => setPaidAmount(event.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2" />
              </label>
              <label className="block text-sm font-medium">Receiving account
                <select required={primaryAmount > 0} value={primaryAccount} onChange={event => setReceivingAccount(event.target.value)} className="block w-full rounded border p-2">
                  <option value="">Choose account</option>
                  {eligible(paymentMethod).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Payment reference (optional)
                <input value={paymentReference} onChange={event => setPaymentReference(event.target.value)} maxLength={100} className="block w-full rounded border p-2" />
              </label>
            </>)}
            {additional.map(payment => <fieldset className="space-y-2 rounded border p-3" key={payment.id}>
              <legend>Additional payment</legend>
              <label>Method<select value={payment.method} onChange={event => updateAdditional(payment.id, { method: event.target.value as Method, account: '' })} className="block w-full rounded border p-2">
                {paymentMethods.map(method => <option key={method} value={method}>{preferences?.payment_labels[method] ?? method}</option>)}
              </select></label>
              <label>Receiving account<select required value={payment.account} onChange={event => updateAdditional(payment.id, { account: event.target.value })} className="block w-full rounded border p-2">
                <option value="">Choose account</option>{eligible(payment.method).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select></label>
              <label>Amount (RWF)<input required type="number" min={1} value={payment.amount} onChange={event => updateAdditional(payment.id, { amount: event.target.value })} className="block w-full rounded border p-2" /></label>
              <label>Payment reference (optional)<input maxLength={100} value={payment.reference} onChange={event => updateAdditional(payment.id, { reference: event.target.value })} className="block w-full rounded border p-2" /></label>
              <button type="button" className="underline" onClick={() => setAdditional(current => current.filter(row => row.id !== payment.id))}>Remove payment</button>
            </fieldset>)}
            <button type="button" disabled={additional.length >= 9} className="rounded border px-3 py-2" onClick={() => setAdditional(current => [
              ...current, { id: (current.at(-1)?.id ?? 0) + 1, method: 'Cash', account: '', amount: '', reference: '' },
            ])}>Add payment</button>
            <p className="text-sm">Collected {formatRwf(initialPaid)} · Outstanding {formatRwf(Math.max(0, total - initialPaid))}</p>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-4 text-lg font-semibold">
              Total: {formatRwf(total)}
            </div>
            <button disabled={saving || !cart.length || !cart.every(row => row.productId)} className="w-full rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 disabled:opacity-50">Confirm sale</button>
          </div>
        </form>

        <div className="min-w-0 xl:col-span-2">
          <BusinessHistory resource="sales" refresh={historyVersion} action={row => <div className="flex gap-3">
            <a href={`/api/sales/receipt?id=${encodeURIComponent(row.id)}`} className="underline">PDF</a>
            <Link href={`/dashboard/sales/returns#${row.id}`} className="underline">Return</Link>
          </div>} />
        </div>
      </div>
    </div>
  );
}
