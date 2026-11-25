'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { postBusiness, readBusiness } from '@/frontend/lib/business-client';
import { formatRwf } from '@/shared/finance/currency';
import type { Product } from '@/shared/types/inventory';
import { ContactSelect } from '@/frontend/components/contact-select';
import { usePreferences } from '@/frontend/lib/use-preferences';

type Order = {
  id: string; customer_name: string; contact: string; source: string; status: string; delivery_status: string;
  items: { product_id: string; name: string; quantity: number; price: number }[]; balance: number | null;
};
const input = 'block w-full rounded border p-2 dark:bg-gray-800';
const button = 'rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50';

export default function OrdersPage() {
  const preferences = usePreferences();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState([1]);
  const [customerId, setCustomerId] = useState('');
  useEffect(() => {
    Promise.all([readBusiness<Product[]>('/api/products'), readBusiness<Order[]>('/api/orders')])
      .then(([products, orders]) => { setProducts(products); setOrders(orders); })
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  async function save(command: object, form?: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      await postBusiness('/api/orders', command);
      form?.reset();
      if (form) setCustomerId('');
      setOrders(await readBusiness<Order[]>('/api/orders'));
      setMessage('Order updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update order.');
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void save({
      action: 'create', customer: data.get('customer'), contact: data.get('contact'), source: data.get('source'),
      customer_id: customerId || undefined,
      items: lines.map(id => ({ product_id: data.get(`product-${id}`), quantity: Number(data.get(`quantity-${id}`)) })),
    }, form);
  }

  return (
    <main className="space-y-5 p-6">
      <h1 className="text-3xl font-bold">Online orders</h1>
      {message && <p role="status">{message}</p>}
      <form className="grid gap-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800 sm:grid-cols-2" onSubmit={create}>
        <label>Customer<input required={!customerId} name="customer" className={input} /></label>
        <ContactSelect kind="Customer" value={customerId} onChange={setCustomerId} />
        <label>Contact<input required name="contact" className={input} /></label>
        <label>Source<select name="source" className={input}><option>WhatsApp</option><option>Instagram</option><option>Phone</option><option>Other</option></select></label>
        {lines.map(id => (
          <fieldset key={id} className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <label>Product<select required name={`product-${id}`} className={input}>
              <option value="">Choose product</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.name} · {formatRwf(product.selling_price)}</option>)}
            </select></label>
            <label>Quantity<input required name={`quantity-${id}`} type="number" min={1} defaultValue={1} className={input} /></label>
            {lines.length > 1 && <button type="button" className="justify-self-start underline" onClick={() => setLines(lines.filter(line => line !== id))}>Remove line</button>}
          </fieldset>
        ))}
        <button type="button" className="rounded border p-2" onClick={() => setLines([...lines, Math.max(...lines) + 1])}>Add item</button>
        <button className={button} disabled={busy || !products.length}>Record pending order</button>
      </form>
      {loading && <p>Loading orders…</p>}
      {!loading && !orders.length && <p>No orders recorded.</p>}
      {orders.map(order => <section key={order.id} className="space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
        <h2 className="font-semibold">{order.customer_name} · {order.source} · {order.status}</h2>
        <p>{order.contact}</p>
        <ul>{order.items.map(item => <li key={item.product_id}>{item.quantity} × {item.name} ({formatRwf(item.price)} each)</li>)}</ul>
        <p>Total {formatRwf(order.items.reduce((total, item) => total + item.price * item.quantity, 0))}
          {order.balance !== null && <> · Outstanding {formatRwf(order.balance)}</>}</p>
        {order.status === 'Pending' && <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => {
          event.preventDefault();
          if (!window.confirm('Confirm this order and record the sale?')) return;
          const values = new FormData(event.currentTarget);
          void save({ action: 'confirm', id: order.id, method: values.get('method'),
            paid: values.get('paid') === '' ? undefined : Number(values.get('paid')) });
        }}>
          <label>Payment method<select name="method" className={input}>
            {(['Credit', 'Cash', 'Mobile Money', 'Bank Transfer'] as const).map(method =>
              <option key={method} value={method}>{preferences?.payment_labels[method] ?? method}</option>)}
          </select></label>
          <label>Amount received (RWF)<input name="paid" type="number" min={0} placeholder="Blank uses method default" className={input} /></label>
          <button disabled={busy} className={button}>Confirm sale</button>
          <button type="button" disabled={busy} className="rounded border p-2" onClick={() => {
            if (window.confirm('Cancel this pending order?')) void save({ action: 'cancel', id: order.id });
          }}>Cancel order</button>
        </form>}
        {order.status === 'Confirmed' && <label className="block">Delivery or collection<select className={input} disabled={busy} value={order.delivery_status}
          onChange={event => void save({ action: 'delivery', id: order.id, status: event.target.value })}>
          {['Pending', 'Ready', 'Delivered', 'Collected'].map(status => <option key={status}>{status}</option>)}
        </select></label>}
      </section>)}
    </main>
  );
}
