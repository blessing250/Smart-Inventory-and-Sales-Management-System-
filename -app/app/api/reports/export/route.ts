import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { dataStore } from '@/app/lib/data-store';
import { requireAdmin } from '@/app/lib/auth-utils';
import { formatRwf } from '@/app/lib/inventory-demo-data';

export async function GET(request: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const format = request.nextUrl.searchParams.get('format') || 'excel';
  const reports = dataStore.getReports();

  const rows = [
    ['Daily Products Sold', reports.daily.products_sold],
    ['Daily Revenue', formatRwf(reports.daily.revenue)],
    ['Daily Expenses', formatRwf(reports.daily.expenses)],
    ['Daily Profit', formatRwf(reports.daily.profit)],
    ['Monthly Revenue', formatRwf(reports.monthly.revenue)],
    ['Monthly Purchases', formatRwf(reports.monthly.purchases)],
    ['Monthly Profit', formatRwf(reports.monthly.profit)],
    ['Remaining Stock', reports.monthly.remaining_stock],
  ];

  if (format === 'pdf') {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Smart Inventory Report', 14, 18);
    doc.setFontSize(10);
    rows.forEach(([label, value], index) => {
      doc.text(`${label}: ${value}`, 14, 32 + index * 8);
    });
    doc.text('Best Selling Products', 14, 104);
    reports.monthly.best_selling_products.forEach((item, index) => {
      doc.text(`${item.product}: ${item.units} units, ${formatRwf(item.revenue)}`, 14, 116 + index * 8);
    });

    const pdf = new Uint8Array(doc.output('arraybuffer'));
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="smart-inventory-report.pdf"',
      },
    });
  }

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet([['Metric', 'Value'], ...rows]);
  const bestSellingSheet = XLSX.utils.json_to_sheet(reports.monthly.best_selling_products);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(workbook, bestSellingSheet, 'Best Selling');
  const excel = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);

  return new NextResponse(excel, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="smart-inventory-report.xlsx"',
    },
  });
}
