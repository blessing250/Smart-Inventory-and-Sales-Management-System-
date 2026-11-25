import { createHash } from 'node:crypto';
import type { User } from '../../shared/types/inventory';

export function ownerSessionStamp(user: Pick<User, 'email' | 'password_hash'>) {
  return createHash('sha256').update(user.email).update('\0').update(user.password_hash).digest('hex');
}

export function validOwnerSession(user: User | undefined, stamp: unknown) {
  return user?.role === 'admin' && typeof stamp === 'string' && ownerSessionStamp(user) === stamp;
}
