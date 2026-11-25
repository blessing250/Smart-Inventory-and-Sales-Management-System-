'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { signOut } from 'next-auth/react';
import { readBusiness, postBusiness } from '@/frontend/lib/business-client';
import type { Preferences } from '@/shared/types/preferences';

type Settings = {
  business: { name: string; address: string; phone: string; receipt_footer: string };
  owner: { name: string; email: string };
  preferences: Preferences;
};
const field = 'block w-full rounded border p-2 dark:bg-gray-800';
const button = 'rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { readBusiness<Settings>('/api/settings').then(setSettings).catch(error => setMessage(error.message)); }, []);

  async function save(event: FormEvent<HTMLFormElement>, owner: boolean) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setMessage('');
    try {
      if (owner) {
        const response = await fetch('/api/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, password: values.password || undefined }),
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Unable to update owner.');
        await signOut({ callbackUrl: '/login' });
      } else {
        const lines = (key: string) => String(values[key] ?? '').split('\n').map(value => value.trim()).filter(Boolean);
        const rate = (key: string) => {
          const value = String(values[key] ?? '');
          if (!value) return null;
          if (!/^\d{1,5}(\.\d{1,6})?$/.test(value)) throw new Error('Enter the exchange rate with up to six decimal places.');
          const [whole, fraction = ''] = value.split('.');
          return Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
        };
        await postBusiness('/api/settings', { ...values, preferences: {
          categories: lines('categories'), channels: lines('channels'), expense_categories: lines('expense_categories'),
          payment_labels: Object.fromEntries(['Cash', 'Mobile Money', 'Bank Transfer', 'Credit']
            .map(key => [key, String(values[key] ?? '').trim()]).filter(([, value]) => value)),
          cny_rate_micros: rate('cny'), usd_rate_micros: rate('usd'),
        } });
        setMessage('Business settings saved.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-5 p-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      {message && <p role="status">{message}</p>}
      {!settings && !message && <p>Loading settings…</p>}
      {settings && <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={event => void save(event, false)} className="space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
          <h2 className="font-semibold">Business and receipts</h2>
          <label className="block">Business name<input required name="name" defaultValue={settings.business.name} className={field} /></label>
          <label className="block">Address<input name="address" defaultValue={settings.business.address} className={field} /></label>
          <label className="block">Phone<input name="phone" type="tel" defaultValue={settings.business.phone} className={field} /></label>
          <label className="block">Receipt footer<textarea name="receipt_footer" defaultValue={settings.business.receipt_footer} className={field} /></label>
          <p>Reporting currency RWF</p>
          <label className="block">Expense categories (one per line)<textarea name="expense_categories"
            defaultValue={settings.preferences.expense_categories?.join('\n')} className={field} /></label>
          <label className="block">Product categories (one per line)<textarea name="categories" defaultValue={settings.preferences.categories.join('\n')} className={field} /></label>
          <label className="block">Sales channels (one per line)<textarea name="channels" defaultValue={settings.preferences.channels.join('\n')} className={field} /></label>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend>Payment display names</legend>
            {(['Cash', 'Mobile Money', 'Bank Transfer', 'Credit'] as const).map(key => <label key={key}>{key}
              <input name={key} placeholder={key} defaultValue={settings.preferences.payment_labels[key]} className={field} />
            </label>)}
          </fieldset>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend>Exchange-rate defaults for new purchases</legend>
            <label>RWF per CNY<input name="cny" type="number" min="0.000001" max={10000} step="0.000001"
              defaultValue={settings.preferences.cny_rate_micros ? settings.preferences.cny_rate_micros / 1000000 : ''} className={field} /></label>
            <label>RWF per USD<input name="usd" type="number" min="0.000001" max={10000} step="0.000001"
              defaultValue={settings.preferences.usd_rate_micros ? settings.preferences.usd_rate_micros / 1000000 : ''} className={field} /></label>
          </fieldset>
          <button disabled={busy} className={button}>Save business details</button>
        </form>
        <form onSubmit={event => void save(event, true)} className="space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
          <h2 className="font-semibold">Owner account</h2>
          <label className="block">Name<input required name="name" defaultValue={settings.owner.name} className={field} /></label>
          <label className="block">Email<input required name="email" type="email" defaultValue={settings.owner.email} className={field} /></label>
          <label className="block">Current password<input required name="current" autoComplete="current-password" type="password" className={field} /></label>
          <label className="block">New password (optional)<input name="password" autoComplete="new-password" type="password" minLength={12} className={field} /></label>
          <button disabled={busy} className={button}>Save account and sign in again</button>
        </form>
      </div>}
    </main>
  );
}
