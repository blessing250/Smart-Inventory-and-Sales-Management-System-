import { z } from 'zod';
export const nonnegativeQuantity = z.number().int().min(0).max(1000000);
export const quantity = nonnegativeQuantity.min(1);
export const money = z.number().int().min(0).max(1000000000);
export const line = z.object({ product_id: z.string().min(1), quantity });
export const method = z.enum(['Cash', 'Mobile Money', 'Bank Transfer', 'Credit']);
export const product = z.object({
  name: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(100),
  sku: z.string().trim().max(100).optional(), description: z.string().trim().max(4000).optional(),
  family: z.string().trim().max(100).nullish(),
  variant_size: z.string().trim().max(100).optional(), variant_color: z.string().trim().max(100).optional(),
  variant_material: z.string().trim().max(100).optional(), variant_design: z.string().trim().max(100).optional(),
  purchase_price: money, selling_price: money, quantity: nonnegativeQuantity,
  minimum_quantity: nonnegativeQuantity, supplier: z.string().trim().max(200),
});
