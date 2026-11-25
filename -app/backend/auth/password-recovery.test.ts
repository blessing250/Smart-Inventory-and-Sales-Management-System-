import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openBusinessDatabase } from '../database/business-db';
import { DataStore } from '../database/data-store';
import { ownerSessionStamp, validOwnerSession } from './owner-session';
import { completePasswordReset, recoveryRateLimit, requestPasswordReset, verifyPasswordReset } from './password-recovery';
import { recoveryInput } from '../../shared/validation/recovery-input';

const email = 'fixture@example.test';
const oldPassword = 'fixture-previous-password';
const password = 'fixture-replacement-password';
const origin = 'https://bizflow.example.test';
let dir: string;
let database: ReturnType<typeof openBusinessDatabase>;
let store: DataStore;
let ownerId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bizflow-recovery-'));
  database = openBusinessDatabase(join(dir, 'fixture.sqlite'));
  store = new DataStore(() => database);
  ownerId = store.provisionOwner('Fixture', email, oldPassword);
});

afterEach(() => {
  database.close();
  rmSync(dir, { recursive: true, maxRetries: 5 });
});

function mailbox() {
  const deliver = vi.fn<(recipient: string, link: string) => Promise<void>>().mockResolvedValue(undefined);
  const token = () => new URL(deliver.mock.lastCall![1]).hash.slice(1);
  return { deliver, token };
}

test('issues one expiring digest to the verified registered owner', async () => {
  const { deliver, token } = mailbox();
  const time = Date.now();
  await requestPasswordReset(store, 'unknown@example.test', email, origin, deliver, time);
  await requestPasswordReset(store, email, 'unverified@example.test', origin, deliver, time);
  expect(deliver).not.toHaveBeenCalled();
  await requestPasswordReset(store, email, email, origin, deliver, time);
  expect(deliver).toHaveBeenCalledOnce();
  expect(deliver.mock.lastCall?.[0]).toBe(email);
  expect(new URL(deliver.mock.lastCall![1]).search).toBe('');
  expect(database.prepare('SELECT * FROM password_resets').get()).toEqual({
    owner_id: ownerId, expires_at: time + 30 * 60_000,
    token_hash: createHash('sha256').update(token()).digest('hex'),
  });
  expect(verifyPasswordReset(store, 'invalid', email, time)).toBe(false);
  expect(verifyPasswordReset(store, token(), email, time + 30 * 60_000)).toBe(false);
  const previous = token();
  await requestPasswordReset(store, email, email, origin, deliver, time + 30_000);
  expect(deliver).toHaveBeenCalledOnce();
  await requestPasswordReset(store, email, email, origin, deliver, time + 60_000);
  expect(verifyPasswordReset(store, previous, email, time + 60_000)).toBe(false);
  expect(verifyPasswordReset(store, token(), email, time + 60_000)).toBe(true);
});

test('failed delivery removes the unusable token and reports a sanitized error', async () => {
  const deliver = vi.fn().mockRejectedValue(new Error('internal SMTP details'));
  await expect(requestPasswordReset(store, email, email, origin, deliver)).rejects.toThrow(/^Recovery delivery failed\.$/);
  expect(database.prepare('SELECT * FROM password_resets').all()).toEqual([]);
});

test('reset commits once, revokes the old session and preserves business data across reopen', async () => {
  const prior = store.getUserById(ownerId)!;
  const stamp = ownerSessionStamp(prior);
  expect(validOwnerSession(prior, stamp)).toBe(true);
  const product = store.createProduct({ name: 'Fixture ring', category: 'Jewelry', purchase_price: 25,
    selling_price: 50, quantity: 2, minimum_quantity: 0, supplier: '' }, ownerId);
  const { deliver, token } = mailbox();
  await requestPasswordReset(store, email, email, origin, deliver);
  expect(await Promise.all([
    completePasswordReset(store, token(), email, password),
    completePasswordReset(store, token(), email, password),
  ])).toEqual(expect.arrayContaining([true, false]));
  expect(await completePasswordReset(store, token(), email, password)).toBe(false);
  const reopened = openBusinessDatabase(join(dir, 'fixture.sqlite'));
  try {
    const saved = new DataStore(() => reopened);
    const owner = saved.getUserById(ownerId)!;
    expect(bcrypt.compareSync(oldPassword, owner.password_hash)).toBe(false);
    expect(bcrypt.compareSync(password, owner.password_hash)).toBe(true);
    expect(validOwnerSession(owner, stamp)).toBe(false);
    expect(validOwnerSession(owner, undefined)).toBe(false);
    expect(owner).toMatchObject({ email, role: 'admin' });
    expect(saved.getProductById(product.id)).toMatchObject({ quantity: 2, stock_value: 50 });
    expect(reopened.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='owner.password_reset'").get()).toEqual({ count: 1 });
  } finally {
    reopened.close();
  }
}, 20_000);

test('validates password length, UTF-8 bytes and confirmation', () => {
  const input = { action: 'reset', token: 'a'.repeat(43) };
  expect(recoveryInput.safeParse({ ...input, password, confirmation: password }).success).toBe(true);
  for (const invalid of ['short', '🔒'.repeat(19)]) {
    expect(recoveryInput.safeParse({ ...input, password: invalid, confirmation: invalid }).success).toBe(false);
  }
  expect(recoveryInput.safeParse({ ...input, password, confirmation: oldPassword }).success).toBe(false);
});

test('limits request, verification and reset independently and reopens after one minute', () => {
  const attempt = recoveryRateLimit();
  for (const [action, limit] of [['request', 10], ['verify', 30], ['reset', 8]] as const) {
    for (let i = 0; i < limit; i++) expect(attempt(action, 0)).toBe(0);
    expect(attempt(action, 0)).toBe(60);
    expect(attempt(action, 60_000)).toBe(0);
  }
});
