'use client';

import { useState, type FormEvent } from 'react';
import { BackToLogin, RecoveryCard, recoveryButton, recoveryField, recoveryRequest } from '@/frontend/components/recovery-card';
import { recoveryEmail } from '@/shared/validation/recovery-input';

export default function ForgotPassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = recoveryEmail.safeParse(new FormData(event.currentTarget).get('email'));
    if (!email.success) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const result = await recoveryRequest({ action: 'request', email: email.data });
      setConfirmation(result.message ?? 'If an account exists for this email address, password reset instructions will be sent.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not request a reset link.');
    } finally {
      setBusy(false);
    }
  }

  return <RecoveryCard title={confirmation ? 'Check your email' : 'Forgot your password?'}>
    {confirmation ? <p role="status" className="mb-6 text-stone-600">{confirmation}</p> : <>
      <p className="mb-6 text-stone-600">Enter your registered owner email to request a password reset link.</p>
      <form method="post" action="/api/recovery" onSubmit={submit} className="mb-6 space-y-4">
        <label className="block text-sm font-medium">Email address
          <input className={recoveryField} required name="email" type="email" autoComplete="email" maxLength={254}
            aria-invalid={!!error} aria-describedby={error ? 'recovery-error' : undefined} />
        </label>
        {error && <p id="recovery-error" role="alert" className="text-sm text-red-800">{error}</p>}
        <button className={recoveryButton} disabled={busy}>{busy ? 'Requesting link…' : 'Send reset link'}</button>
      </form>
    </>}
    <BackToLogin />
  </RecoveryCard>;
}
