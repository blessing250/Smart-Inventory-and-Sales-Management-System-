export const receiptLimit = 2 * 1024 * 1024;
export const receiptAccept = 'application/pdf,image/jpeg,image/png,image/webp';
export type ExpenseReceiptUpload = { filename: string; contentType: string; contents: Uint8Array };

export function expenseReceiptUpload(filename: string, reportedType: string, contents: Uint8Array): ExpenseReceiptUpload | null {
  if (!contents.length || contents.length > receiptLimit) return null;
  const header = Buffer.from(contents.subarray(0, 12));
  const contentType = header.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
    : header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png'
    : header.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
    : header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : '';
  if (!contentType || (reportedType && reportedType !== 'application/octet-stream' && reportedType !== contentType)) return null;
  return { filename: filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 150) || 'receipt', contentType, contents };
}
