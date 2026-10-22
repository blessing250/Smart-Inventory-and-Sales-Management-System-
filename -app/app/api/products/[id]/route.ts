import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';
import { requireAdmin } from '@/app/lib/auth-utils';

const productUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  purchase_price: z.coerce.number().nonnegative().optional(),
  selling_price: z.coerce.number().nonnegative().optional(),
  quantity: z.coerce.number().int().nonnegative().optional(),
  minimum_quantity: z.coerce.number().int().nonnegative().optional(),
  supplier: z.string().min(1).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const product = dataStore.getProductById(id);

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  return NextResponse.json(product);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const { id } = await context.params;
  const parsed = productUpdateSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid product data', details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = dataStore.updateProduct(id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = dataStore.deleteProduct(id);

  if (!deleted) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
