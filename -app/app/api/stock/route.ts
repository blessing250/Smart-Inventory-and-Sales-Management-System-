import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';

const movementSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  type: z.enum(['Stock In', 'Stock Out']),
});

export function GET() {
  return NextResponse.json({
    products: dataStore.getProducts(),
    movements: dataStore.getStockMovements(),
  });
}

export async function POST(request: NextRequest) {
  const parsed = movementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid stock movement', details: parsed.error.flatten() }, { status: 400 });
  }

  const result = dataStore.moveStock(parsed.data.product_id, parsed.data.quantity, parsed.data.type);
  if ('error' in result) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
