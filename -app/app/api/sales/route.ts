import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';

const saleSchema = z.object({
  customer_name: z.string().optional().nullable(),
  payment_method: z.enum(['Cash', 'Mobile Money', 'Bank Transfer', 'Credit']),
  items: z.array(
    z.object({
      product_id: z.string().min(1),
      quantity: z.coerce.number().int().positive(),
    })
  ).min(1),
});

export function GET() {
  return NextResponse.json(dataStore.getSales());
}

export async function POST(request: NextRequest) {
  const parsed = saleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid sale data', details: parsed.error.flatten() }, { status: 400 });
  }

  const result = dataStore.createSale(
    parsed.data.customer_name || null,
    parsed.data.payment_method,
    parsed.data.items
  );

  if ('error' in result) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
