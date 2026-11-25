import { expect, test, vi } from 'vitest';
import { createStagingClient } from './client';

test('staging reads share a refresh and use an in-memory bearer', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    if (String(path).endsWith('browser-refresh')) return Response.json({ accessToken: 'fixture-token', expiresIn: 600 });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token');
    return Response.json({ ok: true });
  });
  const client = createStagingClient(fetcher);
  await expect(Promise.all([client.read('products'), client.read('inventory/balances')])).resolves.toEqual([{ ok: true }, { ok: true }]);
  expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('browser-refresh'))).toHaveLength(1);
});

test('an interrupted write is surfaced without automatically replaying checkout', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ accessToken: 'fixture-token', expiresIn: 600 }))
    .mockRejectedValueOnce(new TypeError('network failure'));
  const client = createStagingClient(fetcher);
  await expect(client.write('sales', { reference: 'pending-reference' })).rejects.toMatchObject({ status: 0 });
  expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/sales'))).toHaveLength(1);
});
