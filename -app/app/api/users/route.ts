import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';
import { requireAdmin } from '@/app/lib/auth-utils';

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'employee']),
});

export async function GET() {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  return NextResponse.json(dataStore.getUsers());
}

export async function POST(request: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const parsed = createUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid user data', details: parsed.error.flatten() }, { status: 400 });
  }

  const result = dataStore.createUser(parsed.data);
  if ('error' in result) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result, { status: 201 });
}
