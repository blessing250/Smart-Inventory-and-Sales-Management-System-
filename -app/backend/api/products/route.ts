import { dataStore } from '@/backend/database/data-store';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { product } from '@/shared/validation/business-input';
export const GET = ownerRoute(() => dataStore.getProducts());
export const POST = ownerRoute(async (request, actor) => dataStore.createProduct(await parse(request, product), actor));
