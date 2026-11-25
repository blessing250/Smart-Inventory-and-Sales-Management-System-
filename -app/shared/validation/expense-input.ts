import { z } from 'zod';
import { money } from './business-input';

export const expenseInput = z.object({
  request_key: z.uuid(), amount: money.min(1),
  category: z.string().trim().min(1).max(100),
  account: z.string().min(1).max(100),
  settled_on: z.iso.date(),
  rate: z.number().int().min(1).max(10000000000).optional(),
  description: z.string().trim().max(1000).default(''),
  payee: z.string().trim().max(200).default(''),
  receipt: z.string().trim().max(150).default(''),
  related: z.string().trim().max(200).default(''),
});
export type ExpenseInput = z.infer<typeof expenseInput>;

export const expenseFilters = z.object({
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
  category: z.string().trim().max(100).default(''),
  account: z.string().trim().max(100).default(''),
  q: z.string().trim().max(150).default(''),
  sort: z.enum(['latest','oldest','amount','asc','desc','recorded']).default('latest'),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
}).refine(row => !row.start || !row.end || row.start <= row.end, 'Choose a valid date range.');
export type ExpenseFilters = z.infer<typeof expenseFilters>;
