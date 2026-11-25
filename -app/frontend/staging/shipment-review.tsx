'use client';

import { useEffect,useRef,useState,type FormEvent } from 'react';
import type { createStagingClient,Page } from './client';

type Client=ReturnType<typeof createStagingClient>;
type Shipment={id:string;tracking:string;status:string};
type Line={lineId:string;planned:number;usable:number;damaged:number;missing:number;outstanding:number};
type Receipt={id:string;reference:string;corrected:boolean;receiptDate:string};
type Claim={id:string;status:string;claimedRwf:number;acceptedRwf:number|null;compensatedRwf:number};
type Issue={receiptId:string;lineId:string;kind:string;status:string;damagedHeld:number;missing:number;exposureRwf:number;remainingRwf:number;
  claim:Claim|null;resolutions:{id:string;action:string;amountRwf:number;notes:string}[]};
type Detail={shipment:Shipment;lines:Line[];receipts:Receipt[];issues:Issue[];finance:{outstandingRwf:number;capitalizedRwf:number;heldRwf:number}};
type Account={id:string;name:string;currency:string;active:boolean};
const control='block w-full rounded-md border px-3 py-2';
const button='rounded-md bg-emerald-900 px-3 py-2 font-medium text-white disabled:opacity-50';
const rwf=(n:number)=>n.toLocaleString('en-RW')+' RWF';

export function ShipmentReview({client}:{client:Client}) {
  const [shipments,setShipments]=useState<Shipment[]>([]);
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [selected,setSelected]=useState('');
  const [detail,setDetail]=useState<Detail>();
  const [version,setVersion]=useState(0);
  const [error,setError]=useState('');
  useEffect(()=>{
    let live=true;
    Promise.all([client.read<Page<Shipment>>('shipments?size=100'),client.read<Account[]>('financial-accounts')])
      .then(([ships,accounts])=>{if(live){setShipments(ships.items);setAccounts(accounts.filter(a=>a.active&&a.currency==='RWF'));}})
      .catch((e:Error)=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[client]);
  useEffect(()=>{
    if(!selected)return;
    let live=true;
    const base='shipments/'+selected;
    Promise.all([client.read<{shipment:Shipment;lines:Line[]}>(base),client.read<Page<Receipt>>(base+'/receipts?size=100'),
      client.read<Issue[]>(base+'/claims'),client.read<Detail['finance']>(base+'/financial-reconciliation')])
      .then(([shipment,receipts,issues,finance])=>{if(live)setDetail({...shipment,receipts:receipts.items,issues,finance});})
      .catch((e:Error)=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[client,selected,version]);
  const refresh=()=>setVersion(n=>n+1);
  return <section className="space-y-4">
    <label className="block">Shipment<select className={control} value={selected} onChange={e=>{setSelected(e.target.value);setDetail(undefined);setError('');}}>
      <option value="">Choose shipment</option>{shipments.map(s=><option key={s.id} value={s.id}>{s.tracking} · {s.status}</option>)}
    </select></label>
    {error&&<p role="alert">{error}</p>}
    {selected&&!detail&&!error&&<p role="status">Loading shipment…</p>}
    {detail&&<>
      <p>Capitalized {rwf(detail.finance.capitalizedRwf)} · Held {rwf(detail.finance.heldRwf)} · Shipment payable {rwf(detail.finance.outstandingRwf)}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{['Line','Expected','Usable','Damaged','Shortage','Pending'].map(label=><th scope="col" key={label} className="px-2 py-1">{label}</th>)}</tr></thead>
        <tbody>{detail.lines.map(l=><tr key={l.lineId}>{[l.lineId.slice(0,8),l.planned,l.usable,l.damaged,l.missing,l.outstanding]
          .map((value,index)=><td className="px-2 py-1" key={index}>{value}</td>)}</tr>)}</tbody>
      </table></div>
      <h3 className="font-semibold">Receiving history</h3>
      {detail.receipts.map(r=><details key={r.id} className="rounded border p-3">
        <summary>{r.reference} · {r.receiptDate} · {r.corrected?'Corrected':'Active'}</summary>
        {r.corrected?<CorrectionHistory client={client} path={`shipments/${selected}/receipts/${r.id}/correction`} />:
          <Command key={r.id} client={client} path={`shipments/${selected}/receipts/${r.id}/correction`} label="Reverse eligible receipt"
            description="This reopens manifest quantities and reverses eligible stock value. Later dependent transactions can block the correction."
            fields={[{name:'reason',label:'Correction reason'}]} refresh={refresh}/>}
      </details>)}
      <h3 className="font-semibold">Damage and shortage</h3>
      {!detail.issues.length&&<p>No active discrepancies.</p>}
      {detail.issues.map(issue=><IssueCard key={issue.receiptId+issue.lineId+issue.kind} issue={issue} accounts={accounts}
        client={client} path={'shipments/'+selected} refresh={refresh}/>)}
    </>}
  </section>;
}

function CorrectionHistory({client,path}:{client:Client;path:string}) {
  const [message,setMessage]=useState('');
  return <div>
    <button type="button" className="underline" onClick={()=>void client.read<{reason:string;recordedAt:string}>(path)
      .then(result=>setMessage(result.reason+' · '+result.recordedAt)).catch((e:Error)=>setMessage(e.message))}>Load correction details</button>
    {message&&<p role="status">{message}</p>}
  </div>;
}

function IssueCard({issue,client,path,accounts,refresh}:{issue:Issue;client:Client;path:string;accounts:Account[];refresh:()=>void}){
  const [action,setAction]=useState('CASH');
  const base={receiptId:issue.receiptId,lineId:issue.lineId,kind:issue.kind};
  const claim=issue.claim;
  const moneyField=(name:string,label:string,optional=false)=>({name,label,numeric:true,optional});
  const unresolved=claim?.acceptedRwf!==null && claim && claim.acceptedRwf>claim.compensatedRwf;
  return <details className="space-y-3 rounded border p-3">
    <summary className="font-semibold">{issue.kind} · {issue.status} · {rwf(issue.remainingRwf)} remaining</summary>
    <p>Held damaged units {issue.damagedHeld} · Missing units {issue.missing} · Exposure {rwf(issue.exposureRwf)}</p>
    {claim&&<p>Claim {claim.status} · Requested {rwf(claim.claimedRwf)} · Accepted {claim.acceptedRwf===null?'Awaiting decision':rwf(claim.acceptedRwf)} · Compensated {rwf(claim.compensatedRwf)}</p>}
    {issue.resolutions.map(r=><p key={r.id}>{r.action} · {rwf(r.amountRwf)} · {r.notes}</p>)}
    {!claim&&issue.remainingRwf>0&&<Command client={client} path={path+'/claims'} label="Submit claim" base={base} refresh={refresh}
      description="Submitting a claim leaves amounts and stock unchanged."
      fields={[{name:'claimant',label:'Supplier or carrier'},moneyField('amountRwf','Requested RWF'),{name:'notes',label:'Notes',optional:true}]}/>}
    {claim&&claim.acceptedRwf===null&&<Command client={client} path={path+'/claims/'+claim.id+'/decision'} label="Decide claim" reference={false}
      refresh={refresh} description="Enter zero to reject the claim. An acceptance authorizes compensation but does not post it."
      fields={[moneyField('acceptedRwf','Accepted RWF'),{name:'notes',label:'Decision notes'}]}/>}
    {issue.remainingRwf>0&&(unresolved||!claim||claim.acceptedRwf!==null)&&<>
      <label className="block">Resolution<select className={control} value={unresolved?action:'LOSS'} onChange={e=>setAction(e.target.value)}>
        {unresolved?<><option value="CASH">Cash compensation</option><option value="CREDIT">Supplier credit</option></>:<option value="LOSS">Approve loss</option>}
      </select></label>
      <Command key={unresolved?action:'LOSS'} client={client} path={path+'/resolutions'} label="Post resolution" refresh={refresh}
        base={{...base,action:unresolved?action:'LOSS'}} description={unresolved&&action==='CASH'?'The receiving account will gain the amount entered.':
          unresolved?'The original supplier payable will decrease by the approved amount.':'Recognizes a loss with no cash or stock movement.'}
        fields={[moneyField('amountRwf','Amount (RWF)'),
          ...(unresolved&&action==='CASH'?[{name:'accountId',label:'Receiving account',options:accounts}]:[]),
          ...(unresolved&&action==='CREDIT'?[moneyField('payableMinor','Native payable minor units',true)]:[]),{name:'notes',label:'Resolution notes'}]}/>
    </>}
  </details>;
}

type Field={name:string;label:string;numeric?:boolean;optional?:boolean;options?:Account[]};
function Command({client,path,label,description,base={},fields,refresh,reference=true}:{
  client:Client;path:string;label:string;description:string;base?:object;fields:Field[];refresh:()=>void;reference?:boolean;
}){
  const [review,setReview]=useState<Record<string,unknown>>();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const running=useRef(false);
  const op=useRef('');
  function prepare(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const body:Record<string,unknown>={...base};
    for(const f of fields){const value=String(form.get(f.name)??'').trim();if(value)body[f.name]=f.numeric?Number(value):value;}
    op.current=crypto.randomUUID();setReview(body);setMessage('');
  }
  async function commit(){
    if(!review||running.current)return;
    running.current=true;setBusy(true);
    try{await client.write(path,reference?{...review,reference:op.current}:review);setReview(undefined);setMessage('Saved.');refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'The operation could not be saved.');}
    finally{running.current=false;setBusy(false);}
  }
  return <div className="my-3 space-y-2 rounded-md border p-3">
    <p className="font-medium">{label}</p>
    {review?<div className="space-y-2">
      <p>{description}</p>{fields.map(f=>review[f.name]!==undefined&&<p key={f.name}>{f.label}: {String(f.options?.find(o=>o.id===review[f.name])?.name??review[f.name])}</p>)}
      <button type="button" className={button} disabled={busy} onClick={()=>void commit()}>Confirm {label.toLowerCase()}</button>
      <button type="button" className="ml-3 underline" disabled={busy} onClick={()=>setReview(undefined)}>Edit</button>
    </div>:<form onSubmit={prepare} className="space-y-2">{fields.map(f=><label className="block" key={f.name}>{f.label}
      {f.options?<select className={control} name={f.name} required={!f.optional}><option value="">Choose account</option>
        {f.options.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>:
        <input className={control} name={f.name} type={f.numeric?'number':'text'} min={f.numeric?0:undefined} required={!f.optional}/>}</label>)}
      <button className={button}>Review {label.toLowerCase()}</button></form>}
    {message&&<p role="status">{message}</p>}
  </div>;
}
