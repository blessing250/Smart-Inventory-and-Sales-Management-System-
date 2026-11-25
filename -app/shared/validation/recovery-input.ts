import { z } from 'zod';

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This reset link is invalid or has expired.');
export const recoveryEmail = z.string().trim().max(254).pipe(z.email());
export const passwordRequirements = 'Use at least 12 characters and at most 72 UTF-8 bytes.';
export const newPassword = z.string().min(12, passwordRequirements)
  .refine(value => new TextEncoder().encode(value).length <= 72, passwordRequirements);

export const recoveryInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), email: recoveryEmail }),
  z.object({ action: z.literal('verify'), token }),
  z.object({ action: z.literal('reset'), token, password: newPassword, confirmation: z.string().max(72) })
    .refine(value => value.password === value.confirmation, 'Passwords must match.'),
]);
