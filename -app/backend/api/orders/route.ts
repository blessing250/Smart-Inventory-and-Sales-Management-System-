import { z } from 'zod';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { line, method, money } from '@/shared/validation/business-input';
import { dataStore } from '@/backend/database/data-store';

const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), customer: z.string().trim().max(200), customer_id: z.string().min(1).optional(),
    contact: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(100),
    items: z.array(line).min(1).max(100) }).refine(input => !!(input.customer_id || input.customer), 'Choose a customer or enter a name.'),
  z.object({ action: z.literal('confirm'), id: z.string().min(1), method, paid: money.optional() }),
  z.object({ action: z.literal('cancel'), id: z.string().min(1) }),
  z.object({ action: z.literal('delivery'), id: z.string().min(1), status: z.enum(['Pending', 'Ready', 'Delivered', 'Collected']) }),
]);

export const GET = ownerRoute(() => dataStore.getOnlineOrders());
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, command);
  if (input.action === 'create') return dataStore.createOnlineOrder(input.customer, input.contact, input.source, input.items, actor, input.customer_id);
  if (input.action === 'confirm') return dataStore.changeOnlineOrder(input.id, input.action, actor, input.method, input.paid);
  if (input.action === 'delivery') return dataStore.changeOnlineOrder(input.id, input.action, actor, undefined, undefined, input.status);
  return dataStore.changeOnlineOrder(input.id, input.action, actor);
});
