'use client';

import { useEffect, useState } from 'react';
import { readBusiness } from './business-client';
import type { Currency } from '../../shared/finance/settlement-money';

export type PaymentAccount = { id: string; name: string; kind: string; currency: Currency; active: number };

export function useAccounts() {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    readBusiness<PaymentAccount[]>('/api/finance?view=accounts').then(setAccounts).catch(() => setError('Unable to load receiving accounts.'));
  }, []);
  return { accounts, error };
}
