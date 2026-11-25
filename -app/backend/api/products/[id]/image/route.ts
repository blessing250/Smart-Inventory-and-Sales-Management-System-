import { NextResponse } from 'next/server';
import { ownerRoute } from '@/backend/auth/auth-utils';
import { BusinessError, dataStore } from '@/backend/database/data-store';
import { boundedBody } from '@/backend/http/request-body';

type Context = { params: Promise<{ id: string }> };
export const GET = ownerRoute<Context>(async (_request, _actor, { params }) => {
  const image = dataStore.getProductImage((await params).id);
  if (!image) return NextResponse.json({ error: 'Image was not found.' }, { status: 404 });
  return new Response(new Uint8Array(image.contents), { headers: {
    'Content-Type': image.content_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  } });
});

export const PUT = ownerRoute<Context>(async (request, actor, { params }) => {
  const invalid = new BusinessError('Choose a JPEG, PNG or WebP image up to 2 MiB.');
  const limited = await boundedBody(request, 2 * 1024 * 1024 + 8192, invalid);
  const form = await limited.formData().catch(() => null);
  const image = form?.get('image');
  if (!(image instanceof File) || !image.size || image.size > 2 * 1024 * 1024) throw invalid;
  const contents = Buffer.from(await image.arrayBuffer());
  const header = contents.subarray(0, 12);
  const type = header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png'
    : header.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
    : header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (!type || type !== image.type) throw invalid;
  return dataStore.saveProductImage((await params).id, type, contents, actor);
});
