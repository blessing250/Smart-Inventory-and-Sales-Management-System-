import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { session, user } = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: session }));
vi.mock('./auth-options', () => ({ authOptions: {} }));
vi.mock('../database/data-store', () => ({
  BusinessError: class extends Error {},
  dataStore: { getUserById: user },
}));

import { ownerRoute } from './auth-utils';

beforeEach(() => { session.mockReset(); user.mockReset(); });

test('owner routes reject missing sessions and recheck the stored role', async () => {
  const request = new NextRequest('http://localhost/api/history');
  const handler = vi.fn((_request, actor: string) => ({ actor }));
  const route = ownerRoute(handler);
  session.mockResolvedValueOnce(null).mockResolvedValue({ user: { id: 'u', role: 'admin' } });
  expect((await route(request, undefined)).status).toBe(403);
  user.mockReturnValueOnce({ id: 'u', role: 'employee' }).mockReturnValueOnce({ id: 'u', role: 'admin' });
  expect((await route(request, undefined)).status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
  expect(await (await route(request, undefined)).json()).toEqual({ actor: 'u' });
});

test('cross-origin business writes are rejected before looking up a session', async () => {
  const handler = vi.fn();
  const request = new NextRequest('http://localhost/api/finance', {
    method: 'POST', headers: { origin: 'https://different.example.test' },
  });
  expect((await ownerRoute(handler)(request, undefined)).status).toBe(403);
  expect(session).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});
