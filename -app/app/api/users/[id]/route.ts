import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dataStore } from '@/app/lib/data-store';
import { requireAdmin } from '@/app/lib/auth-utils';

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'employee']).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const { id } = await context.params;
  const parsed = updateUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid user data', details: parsed.error.flatten() }, { status: 400 });
  }

  const result = dataStore.updateUser(id, parsed.data);
  if (!result) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if ('error' in result) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const { id } = await context.params;
  const result = dataStore.deleteUser(id);
  if (!result) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (typeof result === 'object' && 'error' in result) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
