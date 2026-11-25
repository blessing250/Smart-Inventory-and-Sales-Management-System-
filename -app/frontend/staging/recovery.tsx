'use client';

import {useState,useRef,type FormEvent} from 'react';
import {createStagingClient} from './client';
import Link from 'next/link';

const client=createStagingClient();
const field='w-full rounded border px-3 py-2';
const button='rounded bg-emerald-900 px-4 py-2 text-white disabled:opacity-50';

export function ForgotOwnerPassword() {
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const data=new FormData(e.currentTarget);
    setBusy(true);
    try{
      await client.recovery('forgot-password',{email:String(data.get('email')).trim()});
      setMessage('If the account is eligible for recovery, reset instructions will be sent.');
    }catch(e){setMessage(e instanceof Error?e.message:'Recovery could not be started.');}
    finally{setBusy(false);}
  }
  return <details className="mt-3 rounded border p-3">
    <summary>Forgot password?</summary>
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block">Recovery email<input className={field} name="email" type="email" autoComplete="email" required /></label>
      <button className={button} disabled={busy}>Send reset instructions</button>
      {message&&<p role="status">{message}</p>}
    </form>
  </details>;
}

export function ResetOwnerPassword() {
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(false);
  const saved=useRef('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const data=new FormData(e.currentTarget);
    saved.current||=window.location.hash.slice(1);
    if(!/^[A-Za-z0-9_-]{43}$/.test(saved.current)){setMessage('Open the complete recovery link from your email.');return;}
    window.history.replaceState(null,'',window.location.pathname);
    setBusy(true);
    try{
      await client.recovery('reset-password',{token:saved.current,password:data.get('password'),confirmation:data.get('confirmation')});
      saved.current='';setMessage('Password changed. Sign in with the new password.');setDone(true);
    }catch(e){setMessage(e instanceof Error?e.message:'Password reset failed.');}
    finally{setBusy(false);}
  }
  return <main className="grid min-h-screen place-items-center bg-stone-100 p-4 text-emerald-950">
    <section className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5">
      <h1 className="text-xl font-semibold">Reset staging owner password</h1>
      {!done&&<form onSubmit={submit} className="space-y-3">
        <label className="block">New password<input className={field} name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" required /></label>
        <label className="block">Confirm password<input className={field} name="confirmation" type="password" minLength={12} maxLength={72} autoComplete="new-password" required /></label>
        <button className={button} disabled={busy}>Reset password</button>
      </form>}
      {message&&<p role="status">{message}</p>}
      <Link href="/staging" className="underline">Back to staging sign-in</Link>
    </section>
  </main>;
}
