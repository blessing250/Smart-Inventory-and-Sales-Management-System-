import { z } from 'zod';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { dataStore } from '@/backend/database/data-store';

const contact = z.object({ kind: z.enum(['Customer', 'Supplier', 'Agent']), name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(100), email: z.union([z.literal(''), z.email()]), location: z.string().trim().max(200),
  id: z.string().min(1).optional(), create: z.boolean().optional() });
export const GET = ownerRoute(request => {
  const view = request.nextUrl.searchParams.get('view');
  if (view === 'unlinked') return dataStore.getUnlinkedContacts();
  if (view === 'directory') return dataStore.getContactDirectory();
  return dataStore.getContacts();
});
export const POST = ownerRoute(async (request, actor) => dataStore.saveContact(await parse(request, contact), actor));
export const PUT = ownerRoute(async (request, actor) => {
  const input = await parse(request, z.object({ id: z.string().min(1), kind: z.enum(['sale', 'purchase', 'order']), contact: z.string().min(1) }));
  return dataStore.linkContact(input.id, input.kind, input.contact, actor);
});
