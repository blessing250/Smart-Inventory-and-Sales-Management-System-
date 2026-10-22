import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';

const paymentSchema = z.object({
  sale_id: z.string().min(1),
  reference_number: z.string().optional(),
  amount: z.coerce.number().positive(),
  method: z.enum(['Cash', 'Mobile Money', 'Bank Transfer', 'Credit']),
  status: z.enum(['Paid', 'Pending', 'Failed']),
});

export function GET() {
  return NextResponse.json(dataStore.getPayments());
}

export async function POST(request: NextRequest) {
  const parsed = paymentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payment data', details: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(dataStore.createPayment(parsed.data), { status: 201 });
}
