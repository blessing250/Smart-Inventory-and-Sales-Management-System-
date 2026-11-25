'use client';

import { useState } from 'react';

type InputRow = Record<string, string | number | boolean | null>;
type Preview = { row: number; sku: string; error: string; product?: { name: string; quantity: number; selling_price: number } };

export function ProductImport({ onImported }: { onImported: () => Promise<void> }) {
  const [file, setFile] = useState<File>();
  const [opening, setOpening] = useState(false);
  const [preview, setPreview] = useState<{ rows: InputRow[]; results: Preview[] }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(action: 'preview' | 'confirm') {
    setBusy(true);
    setMessage('');
    try {
      let rows = preview?.rows;
      if (action === 'preview') {
        if (!file || file.size > 2 * 1024 * 1024 || !/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Choose a CSV or XLSX file up to 2 MiB.');
        setPreview(undefined);
        const XLSX = await import('xlsx');
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, sheetRows: 202, sheets: 0 });
        const sheet = book.Sheets[book.SheetNames[0]];
        if (!sheet) throw new Error('The file has no worksheet.');
        rows = XLSX.utils.sheet_to_json<InputRow>(sheet, { raw: true, blankrows: false }).map(row =>
          Object.fromEntries(Object.entries(row).map(([key,value]) => [key.trim().toLowerCase(), value])));
        if (!rows.length || rows.length > 200) throw new Error('Each import must have 1 to 200 product rows.');
      }
      if (!rows) throw new Error('Preview the file first.');
      if (action === 'confirm' && !window.confirm(opening ? 'Import these products and post the reviewed opening stock?' : 'Import these products with zero opening stock?')) return;
      const response = await fetch('/api/products/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rows, opening_stock: opening }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to import products.');
      if (action === 'preview') setPreview({ rows, results: result });
      else {
        setPreview(undefined);
        setMessage(`${result.count} products imported.`);
        await onImported();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to import products.'); }
    finally { setBusy(false); }
  }
  return <details className="mb-6 space-y-3 rounded-lg bg-white p-5 shadow dark:bg-gray-800">
    <summary className="cursor-pointer font-semibold">Import products from Excel or CSV</summary>
    <p className="text-sm">Use sku, name, category and selling_price headings. Optional columns include supplier, family, minimum_quantity, quantity and purchase_price. Use whole RWF values.</p>
    <label className="block">Product spreadsheet<input type="file" accept=".csv,.xlsx" disabled={busy}
      onChange={event => { setFile(event.target.files?.[0]); setPreview(undefined); }} className="block w-full" /></label>
    <label className="block"><input type="checkbox" checked={opening} disabled={busy}
      onChange={event => { setOpening(event.target.checked); setPreview(undefined); }} /> Import opening quantities and costs</label>
    <button type="button" disabled={!file || busy} className="rounded border px-3 py-2 disabled:opacity-50" onClick={() => void send('preview')}>Preview import</button>
    {message && <p role="status">{message}</p>}
    {preview && <>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>
        {['Row','SKU','Product','Opening stock','Validation'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}
      </tr></thead><tbody>{preview.results.map(row => <tr className="border-t" key={row.row}>
        <td className="p-2">{row.row}</td><td className="p-2">{row.sku}</td><td className="p-2">{row.product?.name}</td>
        <td className="p-2">{row.product?.quantity}</td><td className="p-2">{row.error || 'Ready'}</td>
      </tr>)}</tbody></table></div>
      <button type="button" disabled={busy || preview.results.some(row => Boolean(row.error))} className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50"
        onClick={() => void send('confirm')}>Confirm import</button>
    </>}
  </details>;
}
