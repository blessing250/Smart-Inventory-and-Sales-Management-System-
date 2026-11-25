import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { dataStore } from '@/backend/database/data-store';
import { boundedBody } from '@/backend/http/request-body';
import { recoveryInput } from '@/shared/validation/recovery-input';
import { recoveryOrigin, recoveryTransport } from '@/backend/auth/recovery-email';
import { completePasswordReset, recoveryConfirmation, recoveryRateLimit, requestPasswordReset, verifyPasswordReset } from '@/backend/auth/password-recovery';

const rateLimit = recoveryRateLimit();

export function GET() {
  redirect('/forgot-password');
}

export async function POST(request: Request) {
  const unavailable = () => Response.json({ error: 'Email recovery is currently unavailable. Contact your BizFlow administrator.' }, { status: 503 });
  let origin: string;
  try {
    origin = recoveryOrigin();
  } catch {
    return unavailable();
  }
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'This request must come from BizFlow.' }, { status: 403 });
  }
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return Response.json({ error: 'Invalid recovery request.' }, { status: 400 });
  }
  const input = recoveryInput.safeParse(await boundedBody(request, 4096).then(body => body.json()).catch(() => null));
  if (!input.success) return Response.json({ error: input.error.issues[0]?.message ?? 'Invalid recovery request.' }, { status: 400 });
  const retry = rateLimit(input.data.action);
  if (retry) return Response.json({ error: 'Too many attempts. Wait a minute and try again.' }, {
    status: 429, headers: { 'Retry-After': String(retry) },
  });
  const transport = recoveryTransport();
  if (!transport) return unavailable();
  const payload = input.data;
  if (payload.action === 'request') {
    after(async () => {
      try {
        await requestPasswordReset(dataStore, payload.email, transport.email, origin, transport.send);
      } catch {
        console.error(JSON.stringify({ event: 'recovery.request_failed', time: new Date().toISOString() }));
      }
    });
    return Response.json({ message: recoveryConfirmation }, { status: 202 });
  }

  try {
    const valid = payload.action === 'verify'
      ? verifyPasswordReset(dataStore, payload.token, transport.email)
      : await completePasswordReset(dataStore, payload.token, transport.email, payload.password);
    return valid ? Response.json({ ok: true }) :
      Response.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 });
  } catch {
    console.error(JSON.stringify({ event: 'recovery.database_failed', time: new Date().toISOString() }));
    return unavailable();
  }
}
