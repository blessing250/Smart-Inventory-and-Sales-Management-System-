import { z } from 'zod';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { dataStore } from '@/backend/database/data-store';

const label = z.string().trim().min(1).max(100);
const list = z.array(label).max(100).refine(values => new Set(values.map(value => value.toLowerCase())).size === values.length, 'Remove duplicate names.');
const rate = z.number().int().min(1).max(10000000000).nullable();
const preferences = z.object({ categories: list, channels: list,
  expense_categories: list.optional(),
  payment_labels: z.object({ Cash: label.optional(), 'Mobile Money': label.optional(), 'Bank Transfer': label.optional(), Credit: label.optional() }),
  cny_rate_micros: rate, usd_rate_micros: rate });
const business = z.object({ name: z.string().trim().min(1).max(150), address: z.string().trim().max(300),
  phone: z.string().trim().max(50), receipt_footer: z.string().trim().max(400), preferences: preferences.optional() });
const passwordLength = (value: string) => Buffer.byteLength(value) <= 72;
const owner = z.object({ name: z.string().trim().min(1).max(150), email: z.string().trim().email(),
  current: z.string().min(1).refine(passwordLength), password: z.string().min(12).refine(passwordLength).optional() });

export const GET = ownerRoute((_request, actor) => {
  const user = dataStore.getUserById(actor)!;
  return { business: dataStore.getSettings(), preferences: dataStore.getPreferences(), owner: { name: user.name, email: user.email } };
});
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, business);
  return dataStore.saveSettings(input, actor, input.preferences);
});
export const PUT = ownerRoute(async (request, actor) => dataStore.updateOwner(await parse(request, owner), actor));
