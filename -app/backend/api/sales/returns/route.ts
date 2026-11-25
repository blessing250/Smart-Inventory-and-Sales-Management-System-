import { z } from 'zod';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { quantity } from '@/shared/validation/business-input';
import { dataStore } from '@/backend/database/data-store';

const saleReturn = z.object({ item: z.string().min(1), quantity, reason: z.string().trim().min(1).max(500),
  restock: z.boolean(), account: z.string().optional(), reference: z.string().trim().min(1).max(100) });
export const GET = ownerRoute(() => dataStore.getReturns());
export const POST = ownerRoute(async (request, actor) => dataStore.returnSaleItem(await parse(request, saleReturn), actor));
