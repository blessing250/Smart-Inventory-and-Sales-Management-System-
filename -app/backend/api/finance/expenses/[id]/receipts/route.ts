import { NextResponse } from 'next/server';
import { ownerRoute } from '@/backend/auth/auth-utils';
import { BusinessError, dataStore } from '@/backend/database/data-store';
import { receiptForm } from '@/backend/http/expense-receipt-request';

type Context = { params: Promise<{ id: string }> };

export const POST = ownerRoute<Context>(async (request, actor, { params }) => {
  const { attachment } = await receiptForm(request);
  if (!attachment) throw new BusinessError('Choose a receipt to attach.');
  return dataStore.attachExpenseReceipt((await params).id, attachment, actor);
});

export const GET = ownerRoute<Context>(async (request, _actor, { params }) => {
  const receipt = dataStore.getExpenseReceipt((await params).id, request.nextUrl.searchParams.get('receipt') ?? '');
  if (!receipt) return NextResponse.json({ error: 'Receipt was not found.' }, { status: 404 });
  const filename = receipt.filename.replace(/[^a-zA-Z0-9._ -]/g, '_');
  return new Response(new Uint8Array(receipt.contents), { headers: {
    'Content-Type': receipt.content_type,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
});
