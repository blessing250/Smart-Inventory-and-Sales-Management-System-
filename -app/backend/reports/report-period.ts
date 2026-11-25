import { z } from 'zod';
import { BusinessError } from '../database/data-store';

export function reportPeriod(params: URLSearchParams) {
  const start = params.get('start') || undefined;
  const end = params.get('end') || undefined;
  const iso = z.iso.date();
  if ((start && !iso.safeParse(start).success) || (end && !iso.safeParse(end).success) ||
      (start && end && start > end)) {
    throw new BusinessError('Choose a valid report date range.');
  }
  return { start, end };
}
