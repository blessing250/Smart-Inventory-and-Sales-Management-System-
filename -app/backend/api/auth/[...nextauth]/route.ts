import NextAuth from 'next-auth';
import { authOptions } from '@/backend/auth/auth-options';
import { productionAuthOrigin } from '@/backend/auth/server-config';
import type { NextRequest } from 'next/server';

const handler = NextAuth(authOptions);
type Context = { params: Promise<{ nextauth: string[] }> };
let attempts = 0;
let resetAt = 0;

async function auth(request: NextRequest, context: Context) {
  let origin: string;
  try {
    origin = productionAuthOrigin() ?? request.nextUrl.origin;
  } catch {
    console.error(JSON.stringify({ event: 'auth.configuration_invalid', time: new Date().toISOString() }));
    return Response.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 });
  }
  const { nextauth } = await context.params;
  if (request.method === 'POST' && nextauth[0] === 'callback' && nextauth[1] === 'credentials') {
    const now = Date.now();
    if (now >= resetAt) {
      attempts = 0;
      resetAt = now + 60_000;
    }
    if (attempts >= 20) {
      return Response.json({
        url: new URL('/login?error=RateLimited', origin).href,
        error: 'Too many sign-in attempts. Wait a minute and try again.',
      }, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((resetAt - now) / 1000)), 'Cache-Control': 'no-store' },
      });
    }
    attempts++;
  }
  return handler(request, context);
}

export { auth as GET, auth as POST };
