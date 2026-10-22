import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';
import { requireAdmin } from '@/app/lib/auth-utils';

const productSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  purchase_price: z.coerce.number().nonnegative(),
  selling_price: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().int().nonnegative(),
  minimum_quantity: z.coerce.number().int().nonnegative(),
  supplier: z.string().min(1),
});

export function GET() {
  return NextResponse.json(dataStore.getProducts());
}

export async function POST(request: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const parsed = productSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid product data', details: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(dataStore.createProduct(parsed.data), { status: 201 });
}
