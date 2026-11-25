import { NextRequest } from 'next/server';

const roots = new Set(['auth', 'products', 'product-families', 'inventory', 'procurement-contacts', 'purchases',
  'shipments', 'customers', 'sales', 'online-orders', 'financial-accounts', 'expense-categories', 'expenses',
  'finance', 'suppliers', 'reports', 'settings']);
const maxBody = 3 * 1024 * 1024;

async function relay(request: NextRequest, context: RouteContext<'/spring/api/v1/[...path]'>) {
  const target = process.env.BIZFLOW_STAGING_SPRING_URL;
  if (process.env.BIZFLOW_STAGING_ENABLED !== '1' || !target) return Response.json({ error: 'Staging is disabled.' }, { status: 404 });
  const { path } = await context.params;
  if (!roots.has(path[0]) || path.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    return Response.json({ error: 'Unknown staging operation.' }, { status: 404 });
  }
  const headers = new Headers();
  for (const name of ['authorization', 'origin', 'sec-fetch-site', 'content-type', 'accept', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = request.cookies.get('bizflow_spring_refresh');
  if (path[0] === 'auth' && ['browser-refresh', 'browser-logout'].includes(path[1]) && cookie &&
      /^[A-Za-z0-9_-]{43}$/.test(cookie.value)) headers.set('Cookie', `${cookie.name}=${cookie.value}`);
  const body = request.body;
  let payload: Uint8Array<ArrayBuffer> | undefined;
  if (body) {
    const reader = body.getReader();
    const bytes: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > maxBody) {
          await reader.cancel();
          return Response.json({ error: 'The request exceeds 3 MiB.' }, { status: 413 });
        }
        bytes.push(chunk.value);
      }
      payload = new Uint8Array(length);
      let offset = 0;
      for (const chunk of bytes) { payload.set(chunk, offset); offset += chunk.byteLength; }
    } catch {
      return Response.json({ error: 'The upload was interrupted.' }, { status: 400 });
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const url = new URL(`/api/v1/${path.join('/')}`, target);
    url.search = request.nextUrl.search;
    const upstream = await fetch(url, { method: request.method, headers, body: payload, redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const output = new Headers({ 'Cache-Control': 'private, no-store' });
    for (const name of ['content-type', 'content-disposition', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) output.set(name, value);
    }
    if (path[0] === 'auth') {
      for (const value of upstream.headers.getSetCookie()) output.append('Set-Cookie', value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch {
    return Response.json({ error: 'The staging backend is temporarily unavailable.' }, { status: 502 });
  }
}

export { relay as GET, relay as POST, relay as PUT, relay as PATCH };
