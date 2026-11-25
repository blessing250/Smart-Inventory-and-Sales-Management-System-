'use client';

import { useEffect, useState } from 'react';
import { formatRwf } from '@/shared/finance/currency';
import { reportTitles, type OperationalReport, type ReportName } from '@/shared/types/operational-report';

const control = 'block w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800';
const pageSize = 25;

export function OperationalReports({ period }: { period: string }) {
  const [report, setReport] = useState<ReportName>('inventory');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recorded');
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<{ key: string; data?: OperationalReport & { total: number; pages: number; page: number }; error?: string }>();
  const query = new URLSearchParams(period);
  query.set('report', report);
  query.set('q', search);
  query.set('sort', sort);
  const key = query.toString();
  const pageKey = `${key}&page=${page}&size=${pageSize}`;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { fetch(`/api/reports?${pageKey}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load this report.');
      if (!controller.signal.aborted) setResponse({ key: pageKey, data: body });
    }).catch(error => {
      if (!controller.signal.aborted) setResponse({ key: pageKey, error: error.message });
    }); }, 250);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [pageKey]);

  const current = response?.key === pageKey ? response : undefined;
  const rows = current?.data?.rows ?? [];
  const pageCount = current?.data?.pages ?? 1;
  const currentPage = current?.data?.page ?? 1;

  return <section className="mt-6 space-y-4 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
    <h2 className="text-lg font-semibold">Operational reports</h2>
    <div className="grid gap-3 sm:grid-cols-3">
      <label>Report<select className={control} value={report} onChange={event => { setReport(event.target.value as ReportName); setPage(1); }}>
        {Object.entries(reportTitles).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
      </select></label>
      <label>Search records<input type="search" className={control} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
      <label>Sort first column<select className={control} value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
        <option value="recorded">Default order</option><option value="asc">Ascending</option><option value="desc">Descending</option>
      </select></label>
    </div>
    {!current && <p role="status">Loading report…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.data && <>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <p>{current.data.scope} · {current.data.total} matching records</p>
        <a className="underline" href={`/api/reports/export?format=pdf&${key}`}>PDF (all matching)</a>
        <a className="underline" href={`/api/reports/export?format=excel&${key}`}>Excel (all matching)</a>
      </div>
      {!rows.length ? <p>No matching records.</p> : <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="bg-gray-50 dark:bg-gray-700">{current.data.columns.map(column =>
            <th className="p-2" key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) =>
            <tr key={index} className="border-t border-gray-200 dark:border-gray-700">{row.map((cell, col) =>
              <td className="p-2" key={col}>{typeof cell === 'number' && current.data?.columns[col].endsWith('(RWF)') ? formatRwf(cell) : cell}</td>)}</tr>
          )}</tbody>
        </table>
      </div>}
      {pageCount > 1 && <nav aria-label="Report pages" className="flex items-center gap-3">
        <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage} of {pageCount}</span>
        <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
      </nav>}
    </>}
  </section>;
}
