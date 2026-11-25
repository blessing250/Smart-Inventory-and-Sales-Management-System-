'use client';

import { useState } from 'react';
import { BusinessHistory, historyLabels } from '@/frontend/components/business-history';
import { useAccounts } from '@/frontend/lib/use-accounts';

export default function History() {
  const [resource, setResource] = useState<keyof typeof historyLabels>('audit');
  const { accounts } = useAccounts();
  return <main className="space-y-4 p-6">
    <h1 className="text-3xl font-bold">Business history</h1>
    <label className="block">Records<select value={resource} className="mt-1 block rounded border p-2 dark:bg-gray-800"
      onChange={event => setResource(event.target.value as keyof typeof historyLabels)}>
      {Object.entries(historyLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
    </select></label>
    <BusinessHistory key={resource} resource={resource} accounts={resource === 'finance' ? accounts : undefined} />
  </main>;
}
