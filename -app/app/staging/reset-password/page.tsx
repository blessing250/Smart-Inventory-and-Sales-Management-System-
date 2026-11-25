import { notFound } from 'next/navigation';
import { ResetOwnerPassword } from '@/frontend/staging/recovery';

export const dynamic='force-dynamic';

export default function ResetPasswordPage(){
  if(process.env.BIZFLOW_STAGING_ENABLED!=='1'||!process.env.BIZFLOW_STAGING_SPRING_URL)notFound();
  return <ResetOwnerPassword/>;
}
