import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { DataStore } from '../database/data-store';

const lifetime = 30 * 60_000;
export const recoveryConfirmation = 'If an account exists for this email address, password reset instructions will be sent.';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function requestPasswordReset(store: DataStore, email: string, verifiedEmail: string, origin: string,
  deliver: (email: string, link: string) => Promise<void>, now = Date.now()) {
  if (email.toLowerCase() !== verifiedEmail.toLowerCase()) return;
  const owner = store.getUserByEmail(email);
  if (owner?.role !== 'admin') return;
  const token = randomBytes(32).toString('base64url');
  const hash = hashToken(token);
  if (!store.savePasswordReset(owner, hash, now + lifetime)) return;

  const link = new URL('/reset-password', origin);
  link.hash = token;
  try {
    await deliver(owner.email, link.href);
  } catch {
    store.deletePasswordReset(hash);
    throw new Error('Recovery delivery failed.');
  }
}

export function verifyPasswordReset(store: DataStore, token: string, verifiedEmail: string, now = Date.now()) {
  return store.getPasswordReset(hashToken(token), now)?.email.toLowerCase() === verifiedEmail.toLowerCase();
}

export async function completePasswordReset(store: DataStore, token: string, verifiedEmail: string, password: string) {
  if (!verifyPasswordReset(store, token, verifiedEmail)) return false;
  const passwordHash = await bcrypt.hash(password, 12);
  return store.resetOwnerPassword(hashToken(token), passwordHash);
}

export function recoveryRateLimit() {
  const counters = new Map<string, { count: number; until: number }>();
  return (action: 'request' | 'verify' | 'reset', now = Date.now()) => {
    const limit = { request: 10, verify: 30, reset: 8 }[action];
    let entry = counters.get(action);
    if (!entry || entry.until <= now) {
      entry = { count: 0, until: now + 60_000 };
      counters.set(action, entry);
    }
    if (entry.count >= limit) return Math.ceil((entry.until - now) / 1000);
    entry.count++;
    return 0;
  };
}
