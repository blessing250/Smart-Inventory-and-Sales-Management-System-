import Link from 'next/link';
import type { ReactNode } from 'react';
import { Package } from 'lucide-react';

export const recoveryField = 'mt-1 block min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800';
export const recoveryButton = 'min-h-11 w-full rounded-lg bg-[#203b30] px-4 py-2 font-semibold text-white hover:bg-[#2f5042] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-60';
export const recoveryLink = 'font-medium text-emerald-900 underline underline-offset-4';

export function RecoveryCard({ title, children }: { title: string; children: ReactNode }) {
  return <main className="grid min-h-dvh place-items-center bg-[#f5f5ef] px-4 py-8 text-stone-900">
    <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex items-center gap-3 font-semibold text-[#203b30]">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-[#203b30] text-[#e7cd92]">
          <Package size={22} aria-hidden />
        </span>
        BizFlow Jewelry
      </div>
      <h1 className="mb-3 text-2xl font-bold tracking-tight text-[#203b30]">{title}</h1>
      {children}
    </section>
  </main>;
}

export function BackToLogin() {
  return <Link href="/login" className={recoveryLink}>Back to login</Link>;
}

export async function recoveryRequest(payload: object) {
  const response = await fetch('/api/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'Recovery is temporarily unavailable.');
  return result as { message?: string };
}
