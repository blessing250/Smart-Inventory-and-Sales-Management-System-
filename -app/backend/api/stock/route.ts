import { dataStore } from '@/backend/database/data-store';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { z } from 'zod';
import { line, nonnegativeQuantity } from '@/shared/validation/business-input';
const movement = line.extend({ type: z.enum(['Stock In', 'Stock Out']), reason: z.string().trim().min(1).max(500),
  disposition: z.enum(['Damaged', 'Missing']).optional() });
const count = z.object({ product_id: z.string().min(1), expected: z.number().int().nonnegative(),
  counted: nonnegativeQuantity, reason: z.string().trim().min(1).max(500) });
export const GET = ownerRoute(() => ({ products: dataStore.getProducts(), movements: dataStore.getStockMovements(), counts: dataStore.getStockCounts() }));
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, movement);
  return dataStore.moveStock(input.product_id, input.quantity, input.type, input.reason, actor, input.disposition);
});
export const PUT = ownerRoute(async (request, actor) => {
  const input = await parse(request, count);
  return dataStore.countStock(input.product_id, input.expected, input.counted, input.reason, actor);
});
