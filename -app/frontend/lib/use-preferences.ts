'use client';

import { useEffect, useState } from 'react';
import { readBusiness } from './business-client';
import type { Preferences } from '../../shared/types/preferences';

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>();
  useEffect(() => {
    readBusiness<{ preferences: Preferences }>('/api/settings').then(result => setPreferences(result.preferences)).catch(() => {});
  }, []);
  return preferences;
}
