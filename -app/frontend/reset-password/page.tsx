'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BackToLogin, RecoveryCard, recoveryButton, recoveryField, recoveryLink, recoveryRequest } from '@/frontend/components/recovery-card';
import { newPassword, passwordRequirements } from '@/shared/validation/recovery-input';

const invalidLink = 'This reset link is invalid or has expired.';

export default function ResetPassword() {
  const router = useRouter();
  const token = useRef<string | undefined>(undefined);
  const started = useRef(false);
  const [status, setStatus] = useState<'checking' | 'valid' | 'failed' | 'success'>('checking');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current = location.hash.slice(1);
    history.replaceState(history.state, '', location.pathname);
    recoveryRequest({ action: 'verify', token: token.current }).then(() => setStatus('valid'), failure => {
      setError(failure instanceof Error ? failure.message : invalidLink);
      setStatus('failed');
    });
  }, []);

  useEffect(() => {
    if (status !== 'success') return;
    const timeout = window.setTimeout(() => router.replace('/login'), 6000);
    return () => window.clearTimeout(timeout);
  }, [router, status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = newPassword.safeParse(form.get('password'));
    const confirmation = form.get('confirmation');
    if (!password.success || password.data !== confirmation) {
      setError(password.success ? 'Passwords must match.' : passwordRequirements);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await recoveryRequest({ action: 'reset', token: token.current, password: password.data, confirmation });
      token.current = undefined;
      setStatus('success');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not reset your password.');
    } finally {
      setBusy(false);
    }
  }

  return <RecoveryCard title={status === 'success' ? 'Password reset successful' : 'Reset your password'}>
    {status === 'checking' && <p role="status" className="mb-6 text-stone-600">Checking your reset link…</p>}
    {status === 'success' && <p role="status" className="mb-6 text-stone-600">Sign in again with your new password.</p>}
    {status !== 'success' && error && <p role="alert" className="mb-4 text-sm text-red-800">{error}</p>}
    {status === 'valid' && <form method="post" action="/api/recovery" onSubmit={submit} className="mb-6 space-y-4">
      <p id="password-requirements" className="text-sm text-stone-600">{passwordRequirements}</p>
      <label className="block text-sm font-medium">New password
        <input className={recoveryField} required name="password" type={show ? 'text' : 'password'} autoComplete="new-password"
          aria-describedby="password-requirements" />
      </label>
      <label className="block text-sm font-medium">Confirm password
        <input className={recoveryField} required name="confirmation" type={show ? 'text' : 'password'} autoComplete="new-password" />
      </label>
      <button type="button" onClick={() => setShow(!show)} className={recoveryLink} aria-pressed={show}>
        {show ? 'Hide passwords' : 'Show passwords'}
      </button>
      <button className={recoveryButton} disabled={busy}>{busy ? 'Saving password…' : 'Reset password'}</button>
    </form>}
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {(status === 'valid' || status === 'failed') && <Link href="/forgot-password" className={recoveryLink}>Request a new link</Link>}
      <BackToLogin />
    </div>
  </RecoveryCard>;
}
