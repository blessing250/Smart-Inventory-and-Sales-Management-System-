import type { Currency } from './settlement-money';

export function formatNative(value: number, currency: Currency) {
  const divisor = currency === 'RWF' ? 1 : 100;
  return `${currency} ${new Intl.NumberFormat('en-RW', {
    minimumFractionDigits: divisor === 1 ? 0 : 2,
    maximumFractionDigits: divisor === 1 ? 0 : 2,
  }).format(value / divisor)}`;
}

export function fixedInput(value: FormDataEntryValue | null, places: number) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const [whole, fraction = '', ...extra] = text.split('.');
  if (extra.length || !/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > places) {
    throw new Error(`Enter a nonnegative amount with up to ${places} decimal places.`);
  }
  const result = Number(whole + fraction.padEnd(places, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('The amount is too large.');
  return result;
}
