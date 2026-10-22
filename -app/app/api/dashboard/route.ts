import { NextResponse } from 'next/server';
import { dataStore } from '@/app/lib/data-store';

export function GET() {
  return NextResponse.json({
    stats: dataStore.getDashboardStats(),
    products: dataStore.getProducts(),
    sales: dataStore.getSales(),
    payments: dataStore.getPayments(),
  });
}
