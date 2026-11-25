'use client';

import {useEffect,useState,type FormEvent} from 'react';
import type {createStagingClient} from './client';

type Profile={name:string;address:string;phone:string;receiptFooter:string};
const fields={name:'Business name',address:'Address',phone:'Phone',receiptFooter:'Receipt footer'} as const;

export function BusinessSettings({client}:{client:ReturnType<typeof createStagingClient>}){
  const [profile,setProfile]=useState<Profile>();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let live=true;
    client.read<Profile>('settings').then(value=>{if(live)setProfile(value);}).catch((e:Error)=>{if(live)setMessage(e.message);});
    return()=>{live=false;};
  },[client]);
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!profile||busy)return;
    setBusy(true);setMessage('');
    try{setProfile(await client.write<Profile>('settings',profile,'PUT'));setMessage('Business settings saved.');}
    catch(e){setMessage(e instanceof Error?e.message:'Settings could not be saved.');}
    finally{setBusy(false);}
  }
  return <section className="max-w-xl space-y-3 rounded-xl bg-white p-5">
    <h2 className="text-xl font-semibold">Business settings</h2>
    {profile?<form onSubmit={save} className="space-y-3">
      {(Object.keys(fields) as (keyof Profile)[]).map(key=><label className="block" key={key}>{fields[key]}
        <input className="block w-full rounded border p-2" value={profile[key]} required={key==='name'}
          onChange={e=>setProfile({...profile,[key]:e.target.value})}/></label>)}
      <button className="rounded bg-emerald-900 px-4 py-2 text-white" disabled={busy}>Save settings</button>
    </form>:!message&&<p role="status">Loading settings…</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
