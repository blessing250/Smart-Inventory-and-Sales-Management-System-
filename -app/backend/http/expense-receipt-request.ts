import { BusinessError } from '../database/data-store';
import { expenseReceiptUpload, receiptLimit } from '../../shared/validation/expense-receipt';
import { boundedBody } from './request-body';

export async function receiptForm(request: Request) {
  const invalid = new BusinessError('Choose a PDF, JPEG, PNG or WebP receipt up to 2 MiB.');
  const limit = receiptLimit + 16 * 1024;
  const limited = await boundedBody(request, limit, invalid);
  const form = await limited.formData().catch(() => null);
  if (!form) throw invalid;
  const file = form.get('attachment');
  if (file === null || (file instanceof File && !file.name && !file.size)) return { form, attachment: undefined };
  if (!(file instanceof File) || file.size > receiptLimit) throw invalid;
  const attachment = expenseReceiptUpload(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
  if (!attachment) throw invalid;
  return { form, attachment };
}
