import { roundedShare } from './costing';

export type Currency = 'RWF' | 'USD' | 'CNY';
export const rateScale = 1000000;

export function reportingValue(minor: number, currency: Currency, rate: number) {
  return roundedShare(minor, rate, currency === 'RWF' ? rateScale : rateScale * 100);
}
