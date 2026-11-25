import { jsPDF } from 'jspdf';

type Column = { title: string; weight?: number; right?: boolean };
const ink = '#202D2A';
const muted = '#52615C';
const accent = '#B68A44';
const margin = 15;
const lineHeight = 4.4;

export function businessPdf(title: string, brand: string, landscape = false) {
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', format: 'a4', compress: true });
  doc.setProperties({ title, author: brand });
  const width = doc.internal.pageSize.getWidth() - 2 * margin;
  const height = doc.internal.pageSize.getHeight();
  const bottom = height - 21;
  let y = 0;
  let pageTop = 0;

  function text(value: string, x: number, baseline: number, size: number, color = ink, bold = false, right = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color);
    doc.text(value, x, baseline, { align: right ? 'right' : 'left' });
  }

  function wrap(value: string, max: number, size: number, bold = false): string[] {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
    return doc.splitTextToSize(value || ' ', max);
  }

  function page() {
    doc.setFillColor(accent).rect(margin, 12, 12, 1.4, 'F');
    const brandLines = wrap(brand, width, 10, true);
    brandLines.forEach((line, index) => text(line, margin, 20 + index * lineHeight, 10, muted, true));
    const titleStart = 30 + (brandLines.length - 1) * lineHeight;
    const titleLines = wrap(title, width, 22, true);
    titleLines.forEach((line, index) => text(line, margin, titleStart + index * 8, 22, ink, true));
    y = titleStart + (titleLines.length - 1) * 8 + 8;
    pageTop = y;
  }

  function nextPage() { doc.addPage(); page(); }
  function ensure(space: number) { if (y + space > bottom) nextPage(); }

  function paragraph(value: string) {
    for (const line of wrap(value, width, 10)) {
      ensure(6);
      text(line, margin, y + 3.5, 10, muted);
      y += 5;
    }
  }

  function table(label: string, columns: Column[], rows: (string | number)[][]) {
    const totalWeight = columns.reduce((total, column) => total + (column.weight ?? 1), 0);
    const widths = columns.map(column => width * (column.weight ?? 1) / totalWeight);
    const offsets = widths.map((_, index) => margin + widths.slice(0, index).reduce((a, b) => a + b, 0));
    const size = columns.length > 8 ? 8 : 9.5;
    const header = columns.map((column, i) => wrap(column.title, widths[i] - 5, size, true));
    const headerHeight = Math.max(...header.map(lines => lines.length)) * lineHeight + 4;
    const headingHeight = headerHeight + (label ? 8 : 0);
    const cells = (row: (string | number)[]) => columns.map((_, i) => wrap(String(row[i] ?? ''), widths[i] - 5, size));
    const rowLines = (row: string[][]) => Math.max(...row.map(cell => cell.length));
    const freshCapacity = Math.floor((bottom - pageTop - headingHeight - 4) / lineHeight);
    function heading(continued = false) {
      if (label) {
        text(continued ? `${label} (continued)` : label, margin, y + 4, 12, ink, true);
        y += 8;
      }
      doc.setFillColor(ink).rect(margin, y, width, headerHeight, 'F');
      header.forEach((lines, i) => lines.forEach((line, j) => {
        const right = columns[i].right;
        text(line, offsets[i] + (right ? widths[i] - 2.5 : 2.5), y + 4.5 + j * lineHeight, size, '#FFFFFF', true, right);
      }));
      y += headerHeight;
    }
    y += 5;
    const firstLines = rows.length ? rowLines(cells(rows[0])) : 1;
    ensure(headingHeight + (firstLines <= freshCapacity ? firstLines : 1) * lineHeight + 4);
    heading();
    if (!rows.length) {
      paragraph('No records for this section.');
      return;
    }
    rows.forEach((row, index) => {
      const lines = cells(row);
      const count = rowLines(lines);
      let cursor = 0;
      while (cursor < count) {
        const available = Math.floor((bottom - y - 4) / lineHeight);
        if (available < 1 || (cursor === 0 && available < count && count <= freshCapacity)) {
          nextPage();
          heading(true);
          continue;
        }
        const take = Math.min(count - cursor, available);
        const rowHeight = take * lineHeight + 4;
        if (index % 2 === 0) doc.setFillColor('#F4F6F4').rect(margin, y, width, rowHeight, 'F');
        lines.forEach((cell, i) => cell.slice(cursor, cursor + take).forEach((line, j) => {
          const right = columns[i].right;
          text(line, offsets[i] + (right ? widths[i] - 2.5 : 2.5), y + 4.5 + j * lineHeight, size, ink, false, right);
        }));
        y += rowHeight;
        cursor += take;
      }
    });
  }

  function highlight(label: string, value: string) {
    y += 5;
    ensure(17);
    doc.setFillColor('#F6EBD8').rect(margin, y, width, 15, 'F');
    text(label, margin + 4, y + 9.5, 11, ink, true);
    text(value, margin + width - 4, y + 9.5, 14, ink, true, true);
    y += 18;
  }

  function finish() {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor('#CDD4CF').setLineWidth(0.2).line(margin, height - 15, margin + width, height - 15);
      text(`${i} / ${pages}`, margin + width, height - 9, 9, muted, false, true);
    }
    return new Uint8Array(doc.output('arraybuffer'));
  }

  page();
  return { paragraph, table, highlight, finish };
}
