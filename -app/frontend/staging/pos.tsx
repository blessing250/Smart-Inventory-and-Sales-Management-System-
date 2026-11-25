'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ContactSelect, type ContactDirectory } from '@/frontend/components/contact-select';
import type { createStagingClient, Page } from './client';

type Client = ReturnType<typeof createStagingClient>;
type Product = { id: string; sku: string; name: string; sellingPrice: number };
type Account = { id: string; name: string; kind: string; currency: string; active: boolean };
type Line = { product: Product; stock: number; quantity: number; unitDiscountRwf: number };
type Tender = { key: string; method: string; accountId: string; amountRwf: number };
type Sale = { sale: { id:string; totalRwf:number; paidRwf:number; outstandingRwf:number } };
const money = (amount:number) => new Intl.NumberFormat('en-RW').format(amount)+' RWF';
const control='w-full rounded-md border border-stone-300 px-3 py-2';
const action='rounded-md bg-emerald-900 px-4 py-2 font-medium text-white disabled:opacity-50';
const methods=[['CASH','Cash'],['BANK','Bank'],['MOBILE_MONEY','Mobile money']];
const emptyTender=():Tender=>({key:crypto.randomUUID(),method:'CASH',accountId:'',amountRwf:0});
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kigali',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function MixedCheckout({client,directory,updated}:{client:Client;directory:ContactDirectory;updated:()=>void}) {
  const [query,setQuery]=useState('');
  const [matches,setMatches]=useState<(Product & {stock:number})[]>([]);
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [lines,setLines]=useState<Line[]>([]);
  const [tenders,setTenders]=useState<Tender[]>([]);
  const [customer,setCustomer]=useState('');
  const [sale,setSale]=useState<Sale['sale']>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const pending=useRef<{signature:string;reference:string;date:string}>(undefined);
  const running=useRef(false);
  useEffect(()=>{
    let live=true;
    client.read<Account[]>('financial-accounts').then(rows=>{if(live)setAccounts(rows.filter(a=>a.active&&a.currency==='RWF'));})
      .catch((e:Error)=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[client]);
  useEffect(()=>{
    let active=true;
    const timer=setTimeout(()=>void client.read<Page<Product>>('products?size=12&q='+encodeURIComponent(query.trim()))
      .then(data=>Promise.all(data.items.map(async product=>({
        ...product,stock:(await client.read<{quantity:number}>('inventory/products/'+product.id+'/balance')).quantity,
      }))))
      .then(products=>{if(active)setMatches(products);}).catch((e:Error)=>{if(active)setError(e.message);}),180);
    return ()=>{active=false;clearTimeout(timer);};
  },[client,query,sale]);
  const total=lines.reduce((n,l)=>n+(l.product.sellingPrice-l.unitDiscountRwf)*l.quantity,0);
  const paid=tenders.reduce((n,t)=>n+t.amountRwf,0);
  const due=total-paid;
  const invalid=lines.some(l=>!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>l.stock||!Number.isSafeInteger(l.unitDiscountRwf)||l.unitDiscountRwf<0||l.unitDiscountRwf>l.product.sellingPrice)
    ||tenders.some(t=>!t.accountId||!Number.isSafeInteger(t.amountRwf)||t.amountRwf<=0);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(running.current||!lines.length||invalid||due<0||(due>0&&!customer))return;
    running.current=true;setBusy(true);setError('');
    const items=lines.map(({product,quantity,unitDiscountRwf})=>({productId:product.id,quantity,unitDiscountRwf}));
    const signature=JSON.stringify({items,tenders,customer});
    if(pending.current?.signature!==signature) pending.current={signature,reference:crypto.randomUUID(),date:date()};
    const {reference,date:businessDate}=pending.current;
    try{
      const result=await client.write<Sale>('sales',{reference,date:businessDate,channel:'Physical shop',customerId:customer||undefined,items,
        payments:tenders.map(({key,...fields})=>({...fields,reference:reference+'-'+key}))});
      setSale(result.sale);setLines([]);setTenders([]);pending.current=undefined;updated();
    }catch(e){setError(e instanceof Error?e.message:'Checkout failed.');}
    finally{running.current=false;setBusy(false);}
  }
  async function receipt(format:'pdf'|'xlsx'){
    if(!sale)return;
    try{
      const blob=await client.download('reports/sale-receipt/'+sale.id+'/export?format='+format);
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download='receipt-'+sale.id+'.'+format;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e instanceof Error?e.message:'Receipt download failed.');}
  }
  return <form onSubmit={submit} className="space-y-4">
    <fieldset disabled={busy} className="space-y-4">
      <label className="block">Find product by name or SKU<input className={control} type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label>
      <div className="max-h-44 space-y-1 overflow-auto">
        {matches.map(p=><button key={p.id} className="block w-full rounded border px-3 py-2 text-left disabled:opacity-50" type="button"
          disabled={!p.stock||lines.some(l=>l.product.id===p.id)} onClick={()=>{setSale(undefined);setLines([...lines,{product:p,stock:p.stock,quantity:1,unitDiscountRwf:0}]);}}>
          {p.name} · {p.sku} · {money(p.sellingPrice)} · {p.stock} available
        </button>)}
        {query&&!matches.length&&<p>No matching products.</p>}
      </div>
      {lines.map((l,i)=><div className="rounded-md border p-3" key={l.product.id}>
        <div className="flex justify-between"><strong>{l.product.name}</strong><button type="button" onClick={()=>setLines(lines.filter((_,j)=>i!==j))}>Remove</button></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Quantity<input type="number" className={control} min={1} max={l.stock} value={l.quantity}
            onChange={e=>setLines(lines.map((v,j)=>j===i?{...v,quantity:Number(e.target.value)}:v))} /></label>
          <label>Discount per unit (RWF)<input type="number" className={control} min={0} max={l.product.sellingPrice} value={l.unitDiscountRwf}
            onChange={e=>setLines(lines.map((v,j)=>j===i?{...v,unitDiscountRwf:Number(e.target.value)}:v))} /></label>
        </div>
      </div>)}
      <ContactSelect kind="Customer" value={customer} directory={directory} onChange={setCustomer} required={due>0}/>
      {tenders.map((t,i)=>{
        const patch=(change:Partial<Tender>)=>setTenders(tenders.map((v,j)=>j===i?{...v,...change}:v));
        return <fieldset key={t.key} className="space-y-2 rounded-md border p-3">
          <legend>Payment {i+1}</legend>
          <label className="block">Method<select className={control} value={t.method} onChange={e=>patch({method:e.target.value,accountId:''})}>
            {methods.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="block">Receiving account<select className={control} required value={t.accountId} onChange={e=>patch({accountId:e.target.value})}>
            <option value="">Choose an account</option>{accounts.filter(a=>a.kind===t.method).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
          <label className="block">Amount (RWF)<input className={control} type="number" min={1} value={t.amountRwf} onChange={e=>patch({amountRwf:Number(e.target.value)})}/></label>
          <button type="button" onClick={()=>setTenders(tenders.filter((_,j)=>j!==i))}>Remove payment</button>
        </fieldset>;
      })}
      <button type="button" className="rounded border px-3 py-2" disabled={tenders.length>=10} onClick={()=>setTenders([...tenders,emptyTender()])}>Add payment</button>
    </fieldset>
    <dl className="rounded-md bg-emerald-50 p-3">
      <div className="flex justify-between"><dt>Preview total</dt><dd>{money(total)}</dd></div>
      <div className="flex justify-between"><dt>Payment entered</dt><dd>{money(paid)}</dd></div>
      <div className="flex justify-between font-semibold"><dt>Remaining balance</dt><dd>{money(due)}</dd></div>
    </dl>
    {due<0&&<p role="alert">Entered payments exceed the preview total.</p>}
    {due>0&&!customer&&<p>Choose a customer for the outstanding balance.</p>}
    <button className={action} disabled={busy||!lines.length||invalid||due<0||(due>0&&!customer)}>{busy?'Confirming…':'Confirm checkout'}</button>
    {error&&<p role="alert">{error}</p>}
    {sale&&<div className="space-y-2" role="status">
      <p>Sale confirmed. Total {money(sale.totalRwf)}. Paid {money(sale.paidRwf)}. Balance due {money(sale.outstandingRwf)}.</p>
      <button type="button" className="mr-2 rounded border px-3 py-2" onClick={()=>void receipt('pdf')}>Receipt PDF</button>
      <button type="button" className="rounded border px-3 py-2" onClick={()=>void receipt('xlsx')}>Receipt Excel</button>
    </div>}
  </form>;
}
