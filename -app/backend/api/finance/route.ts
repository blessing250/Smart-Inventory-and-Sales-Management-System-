import { z } from 'zod';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { dataStore } from '@/backend/database/data-store';
import { money } from '@/shared/validation/business-input';

const currency = z.enum(['RWF', 'USD', 'CNY']);
const common = z.object({ amount: money.min(1), account: z.string().min(1), reference: z.string().trim().min(1).max(100),
  rate: z.number().int().min(1).max(10000000000).optional(), settled_on: z.iso.date().optional() });
const entry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), name: z.string().trim().min(1).max(100), type: z.enum(['Cash', 'Bank Transfer', 'Mobile Money']), currency: currency.default('RWF') }),
  z.object({ kind: z.literal('account_status'), account: z.string().min(1), active: z.boolean() }),
  common.extend({ kind: z.literal('opening') }),
  common.extend({ kind: z.literal('transfer'), destination: z.string().min(1) }),
  common.extend({ kind: z.literal('exchange'), destination: z.string().min(1), received: money.min(1), fee: money.default(0) }),
  common.extend({ kind: z.literal('expense'), category: z.string().trim().min(1).max(100) }),
  common.extend({ kind: z.literal('supplier_payment'), purchase: z.string().min(1), payable_minor: money.min(1).optional() }),
  common.extend({ kind: z.literal('shipment_payment'), shipment: z.string().min(1) }),
]);
export const GET = ownerRoute(request => {
  const view = request.nextUrl.searchParams.get('view');
  if (view === 'accounts') return dataStore.getAccounts();
  if (view === 'balances') return { accounts: dataStore.getAccountBalances() };
  return dataStore.getFinance();
});
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, entry);
  if (input.kind === 'account') return dataStore.createAccount(input.name, input.type, actor, input.currency);
  if (input.kind === 'account_status') return dataStore.setAccountActive(input.account, input.active, actor);
  return dataStore.recordFinance(input, actor);
});
export const PUT = ownerRoute(async (request, actor) => {
  const input = await parse(request, z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(500) }));
  return dataStore.reverseFinance(input.id, input.reason, actor);
});
