import { ownerRoute } from '@/backend/auth/auth-utils';
import { dataStore } from '@/backend/database/data-store';
import { historyInput } from '@/shared/validation/history-input';
import { reportPeriod } from '@/backend/reports/report-period';

export const GET = ownerRoute(request => {
  const params = request.nextUrl.searchParams;
  return dataStore.getHistory({ ...historyInput.parse(Object.fromEntries(params)), ...reportPeriod(params) });
});
