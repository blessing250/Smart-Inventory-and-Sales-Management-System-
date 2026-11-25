import { notFound } from 'next/navigation';
import { StagingWorkspace } from '@/frontend/staging/workspace';

export const dynamic = 'force-dynamic';

export default function StagingPage() {
  if (process.env.BIZFLOW_STAGING_ENABLED !== '1' || !process.env.BIZFLOW_STAGING_SPRING_URL) notFound();
  return <StagingWorkspace />;
}
