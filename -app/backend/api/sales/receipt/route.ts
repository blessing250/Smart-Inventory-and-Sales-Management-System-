import { NextResponse } from 'next/server';
import { ownerRoute } from '@/backend/auth/auth-utils';
import { formatRwf } from '@/shared/finance/currency';
import { dataStore } from '@/backend/database/data-store';
import { businessPdf } from '@/backend/reports/business-pdf';

export const GET = ownerRoute(request => {
  const sale = dataStore.getSaleReceipt(request.nextUrl.searchParams.get('id') ?? '');
  if (!sale) return NextResponse.json({ error: 'Sale was not found.' }, { status: 404 });
  const settings = dataStore.getSettings();
  const pdf = businessPdf('Sales receipt', settings.name);
  if (settings.address) pdf.paragraph(settings.address);
  if (settings.phone) pdf.paragraph(settings.phone);
  pdf.paragraph(`Receipt reference: ${sale.id}`);
  pdf.paragraph(new Intl.DateTimeFormat('en-RW', { timeZone: 'Africa/Kigali', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sale.sale_date)));
  pdf.paragraph(`Customer: ${sale.customer_name || 'Walk-in customer'}`);
  pdf.table('Items', [
    { title: 'Product', weight: 3 }, { title: 'Qty', right: true, weight: 0.6 },
    { title: 'Unit price', right: true }, { title: 'Line total', right: true },
  ], sale.items.map(line => [line.name, line.quantity, formatRwf(line.selling_price), formatRwf(line.subtotal)]));
  pdf.table('Payment summary', [{ title: 'Description', weight: 2 }, { title: 'Amount', right: true }], [
    ['Sale total', formatRwf(sale.total_amount)],
    ...(sale.returned ? [['Returns credited', formatRwf(sale.returned)]] : []),
    ...(sale.refunded ? [['Refunded', formatRwf(sale.refunded)]] : []),
    ['Net paid', formatRwf(sale.total_amount - sale.returned - sale.balance)],
  ]);
  pdf.highlight('Balance due', formatRwf(sale.balance));
  if (sale.payments.length) pdf.table('Payment details', [
    { title: 'Payment method', weight: 1.1 }, { title: 'Account', weight: 1.2 },
    { title: 'Reference', weight: 1.8 }, { title: 'Amount', right: true, weight: 1.15 },
  ], sale.payments.map(payment => [payment.method, payment.name, payment.reference_number, formatRwf(payment.amount)]));
  if (settings.receipt_footer) pdf.paragraph(settings.receipt_footer);
  return new NextResponse(pdf.finish(), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="receipt-${sale.id}.pdf"` },
  });
});
