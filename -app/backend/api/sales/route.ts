import { dataStore } from '@/backend/database/data-store';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { z } from 'zod';
import { line, method, money } from '@/shared/validation/business-input';
const sale = z.object({ customer_name: z.string().trim().max(200).nullish(), payment_method: method,
  paid_amount: money.optional(), channel: z.string().trim().min(1).max(100).default('Physical shop'),
  request_key: z.uuid().optional(),
  payments: z.array(z.object({ method: method.exclude(['Credit']), amount: money.min(1), account: z.string().min(1),
    reference_number: z.string().trim().min(1).max(100).optional() })).max(10).optional(),
  customer_id: z.string().min(1).optional(),
  items: z.array(line.extend({ unit_discount: money.optional() })).min(1).max(100) })
  .refine(input => !input.payments || (!!input.request_key && input.paid_amount === undefined), 'Mixed checkout requires a retry key and individual payment amounts.');
export const GET = ownerRoute(() => dataStore.getSales());
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, sale);
  return dataStore.createSale(input.customer_name ?? null, input.payment_method, input.items, actor, input.paid_amount, input.channel, input.request_key, input.customer_id, input.payments);
});
