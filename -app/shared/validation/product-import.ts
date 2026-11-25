import { z } from 'zod';
import { product } from './business-input';

const numberCell = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
const optionalText = z.preprocess(value => value == null ? undefined : String(value), z.string().trim().max(200).optional());
export const importedProduct = product.extend({
  sku: z.preprocess(value => typeof value === 'number' ? String(value) : value, z.string().trim().min(1).max(100)),
  selling_price: z.preprocess(numberCell, product.shape.selling_price),
  purchase_price: z.preprocess(numberCell, product.shape.purchase_price).default(0),
  quantity: z.preprocess(numberCell, product.shape.quantity).default(0),
  minimum_quantity: z.preprocess(numberCell, product.shape.minimum_quantity).default(5),
  supplier: optionalText.transform(value => value ?? ''),
  family: optionalText,
});
export const productImport = z.object({ action: z.enum(['preview','confirm']), opening_stock: z.boolean().default(false),
  rows: z.array(z.record(z.string().max(100), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])))
    .min(1).max(200) });
export type ProductImport = z.infer<typeof productImport>;
