import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authOptions } from './auth-options';
import { BusinessError, dataStore } from '../database/data-store';
import { SchemaUpgradeRequired } from '../database/business-db';
import { productionAuthOrigin } from './server-config';
import { boundedBody } from '../http/request-body';

async function owner() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  const user = id ? dataStore.getUserById(id) : undefined;
  return user?.role === 'admin' ? user : undefined;
}

export function ownerRoute<Context>(handler: (request: NextRequest, actor: string, context: Context) => unknown) {
  return async (request: NextRequest, context: Context) => {
    try {
      const expectedOrigin = productionAuthOrigin() ?? request.nextUrl.origin;
      const origin = request.headers.get('origin');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          ((origin && origin !== expectedOrigin) || request.headers.get('sec-fetch-site') === 'cross-site')) {
        return NextResponse.json({ error: 'This request must come from BizFlow.' }, { status: 403 });
      }
      const user = await owner();
      if (!user) return NextResponse.json({ error: 'Owner access is required.' }, { status: 403 });
      const result = await handler(request, user.id, context);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (error) {
      if (error instanceof SchemaUpgradeRequired) return NextResponse.json({ error: error.message }, { status: 503 });
      if (error instanceof BusinessError) return NextResponse.json({ error: error.message }, { status: 400 });
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: error.issues[0]?.message || 'Invalid data.' }, { status: 400 });
      }
      console.error(JSON.stringify({ event: 'business.request_failed', method: request.method, time: new Date().toISOString() }));
      return NextResponse.json({ error: 'BizFlow could not complete the request. Check the transaction history before retrying.' }, { status: 500 });
    }
  };
}

export async function parse<T>(request: NextRequest, schema: z.ZodType<T>) {
  const limited = await boundedBody(request, 3 * 1024 * 1024);
  const body: unknown = await limited.json().catch(() => null);
  return schema.parse(body);
}
