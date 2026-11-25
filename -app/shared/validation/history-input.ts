import { z } from 'zod';

export const historyResources = ['products', 'stock', 'purchases', 'shipments', 'receipts', 'sales', 'contacts', 'orders', 'finance', 'audit'] as const;
export const historyInput = z.object({
  resource: z.enum(historyResources),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(150).default(''),
  status: z.string().trim().max(100).default(''),
  account: z.string().trim().max(100).default(''),
  sort: z.enum(['latest', 'oldest', 'name', 'amount']).default('latest'),
});
export type HistoryQuery = z.infer<typeof historyInput> & { start?: string; end?: string };
