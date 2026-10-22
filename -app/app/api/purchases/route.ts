import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';
import { requireAdmin } from '@/app/lib/auth-utils';

const purchaseSchema = z.object({
  supplier_name: z.string().min(1),
  items: z.array(
    z.object({
      product_id: z.string().min(1),
      quantity: z.coerce.number().int().positive(),
      unit_cost: z.coerce.number().nonnegative(),
    })
  ).min(1),
});

export async function GET() {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  return NextResponse.json(dataStore.getPurchases());
}

export async function POST(request: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const parsed = purchaseSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid purchase data', details: parsed.error.flatten() }, { status: 400 });
  }

  const purchase = dataStore.createPurchase(parsed.data.supplier_name, parsed.data.items);
  return NextResponse.json(purchase, { status: 201 });
}
