import { dataStore } from '@/backend/database/data-store';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { z } from 'zod';
import { line, money } from '@/shared/validation/business-input';
const purchase = z.object({ supplier_name: z.string().trim().max(200), supplier_id: z.string().min(1).optional(),
  currency: z.enum(['RWF', 'CNY', 'USD']).default('RWF'),
  rate_micros: z.number().int().min(1).max(10000000000).default(1000000),
  invoice_reference: z.string().trim().max(200).default(''),
  request_key: z.uuid().optional(),
  items: z.array(line.extend({ unit_cost: money })).min(1).max(100),
}).refine(input => !!(input.supplier_id || input.supplier_name), 'Choose a supplier or enter a name.')
  .refine(input => input.currency !== 'RWF' || input.rate_micros === 1000000, 'RWF exchange rate must equal one.');
export const GET = ownerRoute(() => dataStore.getPurchases());
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, purchase);
  return dataStore.createPurchase(input.supplier_name, input.items, actor, input.currency, input.rate_micros, input.invoice_reference, input.supplier_id, input.request_key);
});
