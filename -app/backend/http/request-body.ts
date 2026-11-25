import { BusinessError } from '../database/data-store';

export async function boundedBody(request: Request, limit: number, invalid = new BusinessError('The request is too large.')) {
  if (Number(request.headers.get('content-length')) > limit) throw invalid;
  if (!request.body) return new Response(null);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw invalid;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(new Uint8Array(Buffer.concat(chunks, size)), {
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  });
}
