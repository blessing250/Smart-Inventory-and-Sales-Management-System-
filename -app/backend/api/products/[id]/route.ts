import { dataStore } from '@/backend/database/data-store';
import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { NextResponse } from 'next/server';
import { product } from '@/shared/validation/business-input';
const update = product.omit({ quantity: true, purchase_price: true }).partial();
const missing = () => NextResponse.json({ error: 'Product not found.' }, { status: 404 });
type ProductContext = { params: Promise<{ id: string }> };
export const GET = ownerRoute<ProductContext>(async (_request, _actor, { params }) => dataStore.getProductById((await params).id) ?? missing());
export const PUT = ownerRoute<ProductContext>(async (request, actor, { params }) =>
  dataStore.updateProduct((await params).id, await parse(request, update), actor));
export const DELETE = ownerRoute<ProductContext>(async (_request, actor, { params }) =>
  dataStore.deleteProduct((await params).id, actor) ? { ok: true } : missing());
