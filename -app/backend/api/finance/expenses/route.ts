import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { BusinessError, dataStore } from '@/backend/database/data-store';
import { expenseFilters, expenseInput } from '@/shared/validation/expense-input';
import { receiptForm } from '@/backend/http/expense-receipt-request';

export const GET = ownerRoute(request => dataStore.getExpenses(expenseFilters.parse(Object.fromEntries(request.nextUrl.searchParams))));
export const POST = ownerRoute(async (request, actor) => {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return dataStore.recordExpense(await parse(request, expenseInput), actor);
  }
  const { form, attachment } = await receiptForm(request);
  const raw = form.get('expense');
  if (typeof raw !== 'string') throw new BusinessError('Enter the expense details.');
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new BusinessError('Enter valid expense details.'); }
  return dataStore.recordExpense(expenseInput.parse(input), actor, attachment);
});
