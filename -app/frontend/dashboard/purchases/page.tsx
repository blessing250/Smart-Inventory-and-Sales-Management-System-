'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { formatRwf } from '@/shared/finance/currency';
import type { Product, Purchase, PurchaseItem } from '@/shared/types/inventory';
import { ContactSelect } from '@/frontend/components/contact-select';
import { usePreferences } from '@/frontend/lib/use-preferences';
import { fixedInput } from '@/shared/finance/native-display';
import { reportingValue, type Currency } from '@/shared/finance/settlement-money';

type PurchaseWithItems = Purchase & { items: (PurchaseItem & {
  received_quantity: number; damaged_quantity: number; reserved_quantity: number; closed_quantity: number;
})[] };

export default function PurchasesPage() {
  const preferences = usePreferences();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<PurchaseWithItems[]>([]);
  const [supplier, setSupplier] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [extraLines, setExtraLines] = useState<{ id: number; productId: string; quantity: number; unitCost: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState<Currency>('RWF');
  const [rate, setRate] = useState(1);
  const [rateConfirmed, setRateConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const purchaseRequest = useRef<{ key: string; body: string } | null>(null);
  const [invoice, setInvoice] = useState('');
  const [receiving, setReceiving] = useState(false);
  const receipts = useRef(new Map<string, { quantity: number; reference: string }>());
  const [error, setError] = useState('');
  const lines = [{ productId, quantity, unitCost }, ...extraLines];
  const draftKey = 'bizflow.purchase.draft';
  function amounts() {
    const rate_micros = currency === 'RWF' ? 1000000 : fixedInput(String(rate), 6) ?? 0;
    const items = lines.map(line => ({ product_id: line.productId, quantity: line.quantity,
      unit_cost: fixedInput(String(line.unitCost), currency === 'RWF' ? 0 : 2) ?? 0 }));
    if (!items.every(item => Number.isSafeInteger(item.quantity * item.unit_cost))) throw new Error('A purchase line exceeds the supported amount.');
    return { rate_micros, items, total: items.reduce((sum,item) => sum + reportingValue(item.quantity*item.unit_cost,currency,rate_micros),0) };
  }
  let total: number | null;
  try { total = amounts().total; } catch { total = null; }
  const matchingProducts = (current: string) => products.filter(product => product.id === current ||
    `${product.name} ${product.sku ?? ''} ${product.family ?? ''}`.toLowerCase().includes(productSearch.trim().toLowerCase()));
  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ supplier,supplierId,productId,quantity,unitCost,extraLines,currency,rate,invoice }));
      setNotice('Draft saved in this browser. No purchase or stock movement was posted.');
    } catch { setError('Unable to save a draft in this browser.'); }
  }
  function resumeDraft() {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) { setNotice('No saved purchase draft.'); return; }
      const draft = JSON.parse(raw) as { supplier: string; supplierId: string; productId: string; quantity: number; unitCost: number;
        extraLines: typeof extraLines; currency: Currency; rate: number; invoice: string };
      setSupplier(draft.supplier); setSupplierId(draft.supplierId); setProductId(draft.productId); setQuantity(draft.quantity);
      setUnitCost(draft.unitCost); setExtraLines(draft.extraLines); setCurrency(draft.currency); setRate(draft.rate); setInvoice(draft.invoice);
      setRateConfirmed(false);
      setNotice('Draft loaded for review.');
    } catch { setError('Unable to reopen this purchase draft.'); }
  }

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
        const nextPurchases: PurchaseWithItems[] = await purchasesResponse.json();
        return { nextProducts, nextPurchases };
      })
      .then(({ nextProducts, nextPurchases }) => {
        setProducts(nextProducts);
        setPurchases(nextPurchases);
        setProductId(current => current || nextProducts[0]?.id || '');
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
    setSaving(true);
    try {
      const { rate_micros, items } = amounts();
      if (currency !== 'RWF' && (!rateConfirmed || !rate_micros)) throw new Error('Confirm the actual exchange rate before posting.');
      const payload = { supplier_name: supplier, supplier_id: supplierId || undefined, currency, rate_micros,
        invoice_reference: invoice, items };
      const body = JSON.stringify(payload);
      if (purchaseRequest.current?.body !== body) purchaseRequest.current = { body, key: crypto.randomUUID() };
      const response = await fetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, request_key: purchaseRequest.current.key }),
    });

      if (!response.ok) throw new Error((await response.json()).error || 'Unable to save purchase.');
      purchaseRequest.current = null;
      try { localStorage.removeItem(draftKey); } catch { /* Browser storage is optional. */ }
      setExtraLines([]);
      setInvoice('');
      setRateConfirmed(false);
      setNotice('Purchase posted. Stock will update when the items are received.');
      await loadPurchasesPage();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save purchase.');
    } finally {
      setSaving(false);
    }
  };

  async function receive(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const quantity = Number(new FormData(form).get('received'));
    setReceiving(true);
    try {
      const previous = receipts.current.get(itemId);
      const reference = previous?.quantity === quantity ? previous.reference : crypto.randomUUID();
      receipts.current.set(itemId, { quantity, reference });
      const response = await fetch('/api/purchases/receive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, quantity, reference }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to confirm receipt.');
      receipts.current.delete(itemId);
      form.reset();
      await loadPurchasesPage();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to confirm receipt.');
    } finally {
      setReceiving(false);
    }
  }

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
          {notice && <p role="status" className="mb-3">{notice}</p>}
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Supplier
              <input required={!supplierId} disabled={!!supplierId} value={supplier} onChange={(event) => setSupplier(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <ContactSelect kind="Supplier" value={supplierId} onChange={setSupplierId} />
            <label className="block">Invoice reference<input value={invoice} onChange={event => setInvoice(event.target.value)} className="mt-2 w-full rounded border px-3 py-2" /></label>
            <label className="block">Currency<select value={currency} onChange={event => {
              const next = event.target.value as Currency;
              setCurrency(next);
              setRateConfirmed(false);
              const defaultRate = next === 'CNY' ? preferences?.cny_rate_micros : next === 'USD' ? preferences?.usd_rate_micros : 1000000;
              setRate((defaultRate ?? 0) / 1000000);
            }} className="mt-2 w-full rounded border px-3 py-2"><option>RWF</option><option>CNY</option><option>USD</option></select></label>
            {currency !== 'RWF' && <>
              <label className="block">RWF per {currency}<input required type="number" min="0.000001" step="0.000001" value={rate}
                onChange={event => { setRate(Number(event.target.value)); setRateConfirmed(false); }} className="mt-2 w-full rounded border px-3 py-2" /></label>
              <label className="block"><input required type="checkbox" checked={rateConfirmed}
                onChange={event => setRateConfirmed(event.target.checked)} /> Confirm this is the actual purchase rate</label>
            </>}
            <label className="block">Find products<input type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)}
              className="block w-full rounded border p-2" /></label>
            <label className="block text-sm font-medium">
              Product
              <select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                {matchingProducts(productId).map((product) => (
                  <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Quantity
              <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Cost per unit ({currency})
              <input type="number" min="0" step={currency === 'RWF' ? 1 : 0.01} value={unitCost} onChange={(event) => setUnitCost(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" />
            </label>
            {extraLines.map(line => {
              const update = (values: Partial<typeof line>) => setExtraLines(current => current.map(entry => entry.id === line.id ? { ...entry, ...values } : entry));
              return <fieldset key={line.id} className="space-y-2 rounded border p-3">
                <label className="block">Product<select required value={line.productId} onChange={event => update({ productId: event.target.value })} className="block w-full rounded border p-2">
                  {matchingProducts(line.productId).map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                </select></label>
                <label className="block">Quantity<input required type="number" min={1} value={line.quantity} onChange={event => update({ quantity: Number(event.target.value) })} className="block w-full rounded border p-2" /></label>
                <label className="block">Cost per unit ({currency})<input required type="number" min={0} step={currency === 'RWF' ? 1 : 0.01} value={line.unitCost} onChange={event => update({ unitCost: Number(event.target.value) })} className="block w-full rounded border p-2" /></label>
                <button type="button" className="underline" onClick={() => setExtraLines(current => current.filter(entry => entry.id !== line.id))}>Remove item</button>
              </fieldset>;
            })}
            <button type="button" disabled={!products.length || extraLines.length >= 99} className="rounded border px-3 py-2"
              onClick={() => setExtraLines(current => [...current, { id: (current.at(-1)?.id ?? 0) + 1, productId: products[0]?.id ?? '', quantity: 1, unitCost: 0 }])}>Add item</button>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-4 font-semibold">
              Total purchase cost {total === null ? 'Check the amounts' : formatRwf(total)}
            </div>
            <button disabled={saving || !products.length} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
              <Plus size={18} /> Save Purchase
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} className="rounded border px-3 py-2" onClick={saveDraft}>Save draft</button>
              <button type="button" disabled={saving} className="rounded border px-3 py-2" onClick={resumeDraft}>Resume draft</button>
            </div>
          </div>
        </form>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto lg:col-span-2">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                {['Purchase ID', 'Supplier', 'Date', 'Total Amount', 'Receiving'].map((heading) => (
                  <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="px-6 py-4 font-medium">{purchase.id}</td>
                  <td className="px-6 py-4">{purchase.supplier_name}<p>{purchase.invoice_reference}</p><p>{purchase.currency ?? 'RWF'} · {Number(purchase.rate_micros ?? 1000000) / 1000000} RWF per unit</p></td>
                  <td className="px-6 py-4">{new Date(purchase.purchase_date).toLocaleDateString()}</td>
                  <td className="px-6 py-4 font-semibold">{formatRwf(purchase.total_amount)}</td>
                  <td className="px-6 py-4">
                    {purchase.items.map(item => (
                      <div key={item.id} className="mb-2">
                        <p>{products.find(product => product.id === item.product_id)?.name ?? item.product_id} · {item.received_quantity}/{item.quantity} usable</p>
                        {item.damaged_quantity > 0 && <p>{item.damaged_quantity} received damaged</p>}
                        {item.reserved_quantity > 0 && <p>{item.reserved_quantity} reserved for shipments</p>}
                        {item.closed_quantity > 0 && <p>{item.closed_quantity} closed as missing</p>}
                        {item.received_quantity + item.damaged_quantity + item.reserved_quantity + item.closed_quantity < item.quantity && (
                          <form onSubmit={event => void receive(event, item.id)} className="flex gap-2">
                            <input aria-label="Received quantity" name="received" type="number" min={1} max={item.quantity - item.received_quantity - item.damaged_quantity - item.reserved_quantity - item.closed_quantity} required className="w-24 rounded border px-2" />
                            <button disabled={receiving} className="rounded bg-blue-600 px-2 py-1 text-white disabled:opacity-50">Receive locally</button>
                          </form>
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
