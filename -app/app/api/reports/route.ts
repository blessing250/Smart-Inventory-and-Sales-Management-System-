import { NextResponse } from 'next/server';
import { dataStore } from '@/app/lib/data-store';
import { requireAdmin } from '@/app/lib/auth-utils';

export async function GET() {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  return NextResponse.json(dataStore.getReports());
}
