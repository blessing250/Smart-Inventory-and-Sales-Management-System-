import { dataStore } from '@/backend/database/data-store';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { z } from 'zod';
import { method, money } from '@/shared/validation/business-input';
const payment = z.object({ sale_id: z.string().min(1), reference_number: z.string().trim().min(1).max(100),
  amount: money.min(1), method: method.exclude(['Credit']), status: z.literal('Paid').default('Paid'), account: z.string().min(1).optional() });
export const GET = ownerRoute(() => dataStore.getPayments());
export const POST = ownerRoute(async (request, actor) => dataStore.createPayment(await parse(request, payment), actor));
