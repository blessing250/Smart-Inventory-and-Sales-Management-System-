import { dataStore } from '@/backend/database/data-store';
import { ownerRoute } from '@/backend/auth/auth-utils';
import { reportPeriod } from '@/backend/reports/report-period';
import { operationalReport } from '@/backend/reports/operational-report';
import { z } from 'zod';

export const GET = ownerRoute(request => {
  const query = request.nextUrl.searchParams;
  if (!query.has('report')) return dataStore.getReports(reportPeriod(query));
  const report = operationalReport(dataStore, query);
  if (!query.has('page')) return report;
  const pageParams = z.object({ page: z.coerce.number().int().min(1).max(1000000),
    size: z.coerce.number().int().min(1).max(100).default(25) }).parse(Object.fromEntries(query));
  const pages = Math.max(1, Math.ceil(report.rows.length / pageParams.size));
  const page = Math.min(pageParams.page, pages);
  const start = (page - 1) * pageParams.size;
  return { ...report, total: report.rows.length, page, pages, rows: report.rows.slice(start, start + pageParams.size) };
});
