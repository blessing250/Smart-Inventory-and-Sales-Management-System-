import { databaseIsReady } from '@/backend/database/business-db';
import { productionAuthOrigin } from '@/backend/auth/server-config';


export function GET() {
  let ready = false;
  try {
    productionAuthOrigin();
    ready = databaseIsReady();
  } catch {
    // Keep internal paths and database errors private.
  }
  return Response.json({ status: ready ? 'ready' : 'unavailable' }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
