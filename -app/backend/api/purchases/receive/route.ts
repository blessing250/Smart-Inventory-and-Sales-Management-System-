import { dataStore } from '@/backend/database/data-store';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { z } from 'zod';
import { quantity } from '@/shared/validation/business-input';
const receipt = z.object({ item_id: z.string().min(1), quantity, reference: z.uuid().optional() });
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, receipt);
  return dataStore.receivePurchaseItem(input.item_id, input.quantity, actor, input.reference);
});
