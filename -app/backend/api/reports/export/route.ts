import { NextResponse } from 'next/server';
import { businessPdf } from '@/backend/reports/business-pdf';
import * as XLSX from 'xlsx';
import { dataStore } from '@/backend/database/data-store';
import { ownerRoute } from '@/backend/auth/auth-utils';
import { formatRwf } from '@/shared/finance/currency';
import { reportPeriod } from '@/backend/reports/report-period';
import { operationalReport } from '@/backend/reports/operational-report';
import type { OperationalReport } from '@/shared/types/operational-report';
import { z } from 'zod';

const exportFormat = z.enum(['excel', 'pdf']);

function operationalExport(report: OperationalReport, name: string, format: string) {
  if (format === 'pdf') {
    const pdf = businessPdf(report.title, dataStore.getSettings().name, report.columns.length > 5);
    pdf.paragraph(report.scope);
    pdf.paragraph(`${report.rows.length} matching records`);
    if (report.totals) pdf.highlight('Net operating expenses', formatRwf(report.totals.amount));
    const columns = report.columns.map((title, index) => {
      const currency = title.endsWith('(RWF)');
      const numeric = report.rows.some(row => typeof row[index] === 'number');
      return { title, right: currency || numeric, weight: currency ? 1.35 : numeric ? 0.8 : /notes|explanation|reason/i.test(title) ? 2 : 1.25 };
    });
    pdf.table('', columns, report.rows.map(row => row.map((cell, i) =>
      typeof cell === 'number' && report.columns[i].endsWith('(RWF)') ? formatRwf(cell) : cell)));
    if (report.totals) pdf.table('Totals by category', [{ title: 'Category', weight: 2 }, { title: 'Amount', right: true }],
      report.totals.groups.map(row => [row.category,formatRwf(row.amount)]));
    return new NextResponse(pdf.finish(), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="bizflow-${name}.pdf"` },
    });
  }
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[report.title], [report.scope], report.columns, ...report.rows]);
  report.rows.forEach((row, rowIndex) => row.forEach((value, col) => {
    if (typeof value === 'number' && report.columns[col].endsWith('(RWF)')) {
      sheet[XLSX.utils.encode_cell({ r: rowIndex + 3, c: col })].z = '"RWF " #,##0';
    }
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
  if (report.totals) {
    const totals = XLSX.utils.aoa_to_sheet([['Category','Amount (RWF)'],['Net operating expenses',report.totals.amount],
      ...report.totals.groups.map(row => [row.category,row.amount])]);
    XLSX.utils.book_append_sheet(workbook, totals, 'Totals');
  }
  return new NextResponse(new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="bizflow-${name}.xlsx"`,
    },
  });
}

export const GET = ownerRoute(request => {
  const query = request.nextUrl.searchParams;
  const format = exportFormat.parse(query.get('format') ?? 'excel');
  const name = query.get('report');
  if (name !== null) return operationalExport(operationalReport(dataStore, query), name, format);
  const period = reportPeriod(query);
  const reports = dataStore.getReports(period);

  const rows = [
    ['Daily Products Sold', reports.daily.products_sold],
    ['Daily Revenue', formatRwf(reports.daily.revenue)],
    ['Daily Expenses', formatRwf(reports.daily.expenses)],
    ['Daily Gross Profit', formatRwf(reports.daily.profit)],
    ['This Week Revenue', formatRwf(reports.weekly.revenue)],
    ['This Week Gross Profit', formatRwf(reports.weekly.profit)],
    ['Period Revenue', formatRwf(reports.monthly.revenue)],
    ['Period Purchases', formatRwf(reports.monthly.purchases)],
    ['Period Operating Expenses', formatRwf(reports.monthly.expenses)],
    ['Period Gross Profit', formatRwf(reports.monthly.profit)],
    ['Remaining Stock', reports.monthly.remaining_stock],
  ];

  if (format === 'pdf') {
    const pdf = businessPdf('Business report', dataStore.getSettings().name);
    pdf.paragraph(period.start || period.end
      ? `Selected period: ${period.start ?? 'Earliest'} to ${period.end ?? 'latest'} (Kigali dates)`
      : 'Selected period: current month (Kigali dates)');
    const metrics = [{ title: 'Metric', weight: 2 }, { title: 'Value', right: true }];
    pdf.table('Selected period and current stock', metrics, rows.slice(6));
    pdf.table('Today', metrics, rows.slice(0, 4));
    pdf.table('This week', metrics, rows.slice(4, 6));
    pdf.table('Sales by channel', [{ title: 'Channel', weight: 2 }, { title: 'Net sales', right: true }],
      reports.monthly.channels.map(row => [row.channel, formatRwf(row.revenue)]));
    pdf.table('Product sales', [{ title: 'Product', weight: 2.5 }, { title: 'Net units', right: true },
      { title: 'Net sales', right: true }], reports.monthly.best_selling_products.map(row => [row.product, row.units, formatRwf(row.revenue)]));
    return new NextResponse(pdf.finish(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="bizflow-report.pdf"',
      },
    });
  }

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet([['Metric', 'Value'], ...rows]);
  const bestSellingSheet = XLSX.utils.json_to_sheet(reports.monthly.best_selling_products);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(workbook, bestSellingSheet, 'Best Selling');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reports.monthly.channels), 'Sales Channels');
  const excel = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);

  return new NextResponse(excel, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="bizflow-report.xlsx"',
    },
  });
});
