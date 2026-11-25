import { z } from 'zod';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { money, quantity } from '@/shared/validation/business-input';
import { dataStore } from '@/backend/database/data-store';

const key = z.string().trim().min(1).max(150);
const detail = z.object({ reference: key, notes: z.string().trim().min(1).max(1000) });
const incident = detail.extend({ event: key, item: key, kind: z.enum(['damage', 'shortage']) });
const command = z.discriminatedUnion('action', [
  incident.extend({ action: z.literal('claim'), claimant: key, currency: z.enum(['RWF', 'USD', 'CNY']),
    amount: money.min(1), rate: z.number().int().min(1).max(10000000000) })
    .refine(row => row.currency !== 'RWF' || row.rate === 1000000, 'Use the standard rate for RWF.'),
  z.object({ action: z.literal('decide'), claim: key, accepted: money, notes: detail.shape.notes }),
  incident.extend({ action: z.literal('credit'), payable_minor: money.min(1).optional() }),
  incident.extend({ action: z.literal('cash'), account: key }),
  incident.extend({ action: z.literal('recover'), quantity }),
  incident.extend({ action: z.literal('return'), quantity }),
  incident.extend({ action: z.literal('loss'), close_missing: z.boolean().optional() }),
  detail.extend({ action: z.literal('reverse'), resolution: key }),
]);

export const GET = ownerRoute(request => dataStore.getDiscrepancies(request.nextUrl.searchParams.get('shipment') ?? undefined));
export const POST = ownerRoute(async (request, actor) => dataStore.resolveDiscrepancy(await parse(request, command), actor));
