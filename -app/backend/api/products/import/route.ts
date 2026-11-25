import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { dataStore } from '@/backend/database/data-store';
import { productImport } from '@/shared/validation/product-import';

export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, productImport);
  return input.action === 'preview' ? dataStore.previewProductImport(input) : dataStore.confirmProductImport(input, actor);
});
