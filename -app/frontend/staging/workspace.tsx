'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { createStagingClient, StagingError, type Owner, type Report, type Trend } from './client';
import { ContactSelect, type ContactDirectory } from '@/frontend/components/contact-select';
import { MixedCheckout } from './pos';
import { GuidedProductImport } from './import-products';
import { ShipmentReview } from './shipment-review';
import { ForgotOwnerPassword } from './recovery';
import { BusinessSettings } from './settings';

type RecordRow = Record<string, unknown>;
type Option = { id: string; label: string };
type Field = { key: string; label: string; type?: 'number' | 'date' | 'file'; source?: string; options?: string[]; optional?: boolean; value?: string };
type Values = Record<string, string | number>;
type Workflow = { label: string; method?: string; fields: Field[]; lines?: Field[]; existingReceipt?: boolean; image?:boolean;
  request: (v: Values, key: string, lines: Values[]) => [string, object] };
type Module = { path: string; columns: string[]; workflows: Workflow[] };
const control = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-950';
const button = 'rounded-lg bg-emerald-900 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50';
const card = 'rounded-xl border border-stone-200 bg-white p-5 shadow-sm';
const field = (key: string, label: string, more: Partial<Field> = {}): Field => ({ key, label, ...more });
const choice = (key: string, label: string, source: string, optional = false) => field(key, label, { source, optional });
const amount = (key: string, label: string, value = '', optional = false) => field(key, label, { type: 'number', value, optional });
const date = field('date', 'Business date', { type: 'date' });
const product = choice('productId', 'Product', 'products');
const account = choice('accountId', 'Account', 'financial-accounts');
const methods = ['CASH', 'BANK', 'MOBILE_MONEY'];
const modules: Record<string, Module> = {
  Products: { path: 'products', columns: ['sku', 'name', 'category', 'sellingPrice'], workflows: [
    { label: 'Register product', fields: [field('sku','SKU'), field('name','Product name'), field('category','Category'),
      choice('familyId','Family','product-families',true), field('variantSize','Size',{ optional:true }),
      field('variantColor','Color',{ optional:true }), field('variantMaterial','Material',{ optional:true }),
      amount('sellingPrice','Price (RWF)'), amount('estimatedUnitCost','Estimated unit cost (RWF)','0'),
      amount('reorderThreshold','Reorder threshold','0')], request: v => ['products', v] },
    { label: 'Add product family', fields: [field('name','Family name')], request: v => ['product-families',v] },
    { label: 'Import products', fields:[],request:v=>['products/import/confirm',v] },
    {label:'Upload product image',method:'PUT',image:true,fields:[product,field('image','Product image',{type:'file'})],
      request:({productId})=>[`products/${productId}/image`,{}]},
    {label:'Edit product details',method:'PATCH',fields:[product,field('name','Product name',{optional:true}),field('category','Category',{optional:true}),
      field('variantSize','Size',{optional:true}),field('variantColor','Color',{optional:true}),field('variantMaterial','Material',{optional:true}),
      field('variantDesign','Design',{optional:true}),amount('sellingPrice','Price (RWF)','',true)],
      request:({productId,...v})=>[`products/${productId}`,v]},
    {label:'Archive product',fields:[product],request:({productId})=>[`products/${productId}/archive`,{}]},
  ] },
  Inventory: { path: 'inventory/balances', columns: ['sku', 'name', 'quantity', 'valueRwf', 'version'], workflows: [
    { label: 'Record opening stock', fields: [product,amount('quantity','Quantity'),amount('valueRwf','Total value (RWF)'),field('reason','Reason')],
      request: ({ productId, ...v },reference) => [`inventory/products/${productId}/opening`,{ ...v, reference }] },
    { label: 'Draft stock count', fields: [product,amount('observedQuantity','Observed quantity'),amount('expectedVersion','Version shown in stock list'),field('reason','Reason')],
      request: ({ productId, ...v },reference) => [`inventory/products/${productId}/counts`,{ ...v, reference }] },
    { label: 'Confirm stock count', fields: [choice('id','Count','inventory/counts')],
      request: ({ id }) => [`inventory/counts/${id}/confirm`,{}] },
  ] },
  Purchases: { path: 'purchases', columns: ['reference','supplierName','currency','totalRwf','status'], workflows: [
    { label: 'Quick purchase', fields: [choice('supplierId','Supplier','procurement-contacts?kind=SUPPLIER'),date,
      field('currency','Currency',{ options:['RWF','USD','CNY'] }),amount('rateMicros','RWF rate in millionths','1000000')],
      lines:[product,amount('quantity','Quantity','1'),amount('unitMinor','Unit price in currency minor units')],
      request: (v,reference,lines) => ['purchases',{ ...v,reference,lines }] },
    { label: 'Add supplier or agent', fields: [field('kind','Contact type',{ options:['SUPPLIER','AGENT'] }),field('name','Name'),field('phone','Phone',{ optional:true })],
      request: v => ['procurement-contacts',v] },
    {label:'Pay supplier',fields:[choice('supplierId','Supplier','procurement-contacts?kind=SUPPLIER'),account,{...date,optional:true},
      amount('rwfRateMicros','Settlement RWF rate in millionths','',true)],
      lines:[choice('purchaseId','Purchase','purchases'),amount('amountRwf','Payment (RWF)'),amount('payableMinor','Native obligation discharged','',true),
        amount('sourceMinor','Native amount paid','',true)],
      request:({supplierId,...v},reference,allocations)=>[`suppliers/${supplierId}/payments`,{...v,reference,allocations}]},
  ] },
  Shipments: { path: 'shipments', columns: ['tracking','agentName','plannedDate','status'], workflows: [
    { label: 'Plan shipment', fields: [field('tracking','Tracking reference'),choice('agentId','Agent','procurement-contacts?kind=AGENT'),
      field('plannedDate','Planned date',{ type:'date' })],lines:[choice('lineId','Purchase line','purchase-lines'),amount('quantity','Planned quantity','1')],
      request: (v,_,lines) => ['shipments',{ ...v,lines }] },
    { label: 'Record shipment charges', method:'PUT',fields:[choice('shipment','Shipment','shipments'),field('allocation','Allocation',{ options:['QUANTITY','VALUE'] }),
      ...['shipping','customs','clearing','other'].map(key=>amount(key,key,'0'))],
      request: ({ shipment,...v }) => [`shipments/${shipment}/charges`,v] },
    { label: 'Receive shipment', fields:[choice('shipment','Shipment','shipments'),date],lines:[choice('lineId','Manifest purchase line','purchase-lines'),
      amount('usable','Usable','0'),amount('damaged','Damaged','0'),amount('missing','Confirmed missing','0'),field('explanation','Discrepancy explanation',{ optional:true })],
      request: ({ shipment,date },reference,lines) => [`shipments/${shipment}/receipts`,{ date,reference,lines }] },
    {label:'Review shipment and discrepancies',fields:[],request:v=>['shipments',v]},
    {label:'Pay shipment charge',fields:[choice('shipment','Shipment','shipments'),account,
      field('chargeKind','Charge type',{options:['SHIPPING','CUSTOMS','CLEARING','OTHER']}),amount('amountRwf','Amount (RWF)'),
      amount('sourceMinor','Native amount (minor units)','',true),amount('rwfRateMicros','RWF reporting rate in millionths','',true)],
      request:({shipment,...v},reference)=>[`shipments/${shipment}/payments`,{...v,reference}]},
  ] },
  Sales: { path:'sales', columns:['reference','customerName','totalRwf','paidRwf','outstandingRwf','status'], workflows:[
    { label:'Quick sale',fields:[],request:v=>['sales',v] },
    { label:'Add customer',fields:[field('name','Customer name'),field('phone','Phone',{ optional:true })],request:v=>['customers',v] },
    { label:'Record customer payment',fields:[choice('sale','Sale','sales'),account,field('method','Payment method',{ options:methods }),amount('amountRwf','Amount (RWF)')],
      request:({ sale,...v },reference)=>[`sales/${sale}/payments`,{ ...v,reference }] },
    { label:'Reverse customer payment',fields:[choice('payment','Customer payment','sale-payments'),field('reason','Reason')],
      request:({payment,reason},reference)=>{
        const [sale,id]=String(payment).split(':');
        return [`sales/${sale}/payments/${id}/reverse`,{reference,reason}];
      }},
    { label:'Return item',fields:[choice('sale','Sale','sales'),choice('itemId','Original sale item','sale-items'),amount('quantity','Quantity','1'),
      field('condition','Condition',{ options:['USABLE','DAMAGED'] }),field('reason','Reason'),choice('refundAccountId','Refund account','financial-accounts',true)],
      request:({ sale,...v },reference)=>[`sales/${sale}/returns`,{ ...v,reference }] },
  ] },
  Orders: {path:'online-orders',columns:['reference','customerName','status','fulfillment','paymentStatus'],workflows:[
    {label:'Create online order',fields:[choice('customerId','Customer','customers',true),field('customerName','Customer name',{optional:true}),
      field('contact','Contact'),field('source','Source')],lines:[product,amount('quantity','Quantity','1')],
      request:(v,reference,items)=>['online-orders',{...v,reference,items}]},
    {label:'Confirm order',fields:[choice('id','Order','online-orders'),date,choice('accountId','Receiving account','financial-accounts',true),
      field('method','Payment method',{options:methods}),amount('amountRwf','Actual payment (RWF)','0')],
      request:({id,date,accountId,method,amountRwf},reference)=>[`online-orders/${id}/confirm`,{date,
        payments:Number(amountRwf)>0?[{reference,accountId,method,amountRwf}]:[]}]},
    {label:'Cancel pending order',fields:[choice('id','Order','online-orders')],request:({id})=>[`online-orders/${id}/cancel`,{}]},
    {label:'Update order fulfillment',method:'PUT',fields:[choice('id','Order','online-orders'),
      field('status','Fulfillment status',{options:['PENDING','READY','DELIVERED','COLLECTED']})],
      request:({id,status})=>[`online-orders/${id}/fulfillment`,{status}]},
  ]},
  Expenses: { path:'expenses',columns:['date','categoryName','amountRwf','payee','receiptCount','reversed'],workflows:[
    { label:'Record expense',fields:[amount('amountRwf','Amount (RWF)'),choice('categoryId','Category','expense-categories'),account,
      { ...date, optional:true },field('description','Description',{ optional:true }),field('receiptReference','Receipt reference',{ optional:true }),
      field('receipt','Attach receipt',{ type:'file',optional:true })],request:(v,reference)=>['expenses',{ ...v,reference }] },
    { label:'Attach receipt to saved expense',existingReceipt:true,fields:[choice('id','Expense','expenses'),field('receipt','Receipt',{type:'file'})],
      request:({id})=>[`expenses/${id}/receipts`,{}] },
    {label:'Reverse expense',fields:[choice('id','Expense','expenses'),field('reason','Reason')],
      request:({id,reason},reference)=>[`finance/transactions/${id}/reverse`,{reference,reason}]},
  ] },
  Accounts: { path:'financial-accounts',columns:['name','kind','currency','balanceMinor','active'],workflows:[
    { label:'Add RWF account',fields:[field('name','Account name'),field('kind','Account type',{ options:methods }),amount('openingRwf','Opening balance (RWF)','0')],
      request:v=>['financial-accounts',v] },
    {label:'Add foreign account',fields:[field('name','Account name'),field('kind','Account type',{options:methods}),
      field('currency','Currency',{options:['USD','CNY']}),amount('openingMinor','Opening balance in minor units','0'),
      amount('rwfRateMicros','RWF rate in millionths','',true)],request:v=>['financial-accounts/native',v]},
    {label:'Transfer RWF',fields:[choice('fromAccount','From account','financial-accounts'),choice('toAccount','To account','financial-accounts'),amount('amountRwf','Amount (RWF)')],
      request:(v,reference)=>['finance/transfers',{...v,reference}]},
    {label:'Exchange or transfer native currency',fields:[choice('fromAccount','From account','financial-accounts'),
      choice('toAccount','To account','financial-accounts'),amount('sourceMinor','Sent in source minor units'),
      amount('destinationMinor','Received in destination minor units'),amount('rwfRateMicros','RWF reporting rate in millionths'),
      amount('exchangeRateMicros','Destination per source rate in millionths','',true),amount('feeMinor','Fee in source minor units','0')],
      request:(v,reference)=>['finance/exchanges',{...v,reference}]},
    {label:'Rename account',method:'PATCH',fields:[account,field('name','Account name')],
      request:({accountId,name})=>[`financial-accounts/${accountId}`,{name}]},
    {label:'Archive account',fields:[account],request:({accountId})=>[`financial-accounts/${accountId}/archive`,{}]},
  ] },
};
const reportKinds = { sales:'Sales and gross profit', receivables:'Customer receivables', payables:'Supplier payables', expenses:'Operating expenses',
  accounts:'Account balances', transactions:'Account transactions', settlements:'Settlements and exchange differences', inventory:'Inventory valuation', movements:'Stock movements',
  purchases:'Purchases', receipts:'Shipment receiving and landed costs', discrepancies:'Shipment discrepancies' };
const format = new Intl.NumberFormat('en-RW');
const client = createStagingClient();
const contactPaths = { Customer:'customers', Supplier:'procurement-contacts?kind=SUPPLIER' };
const stagingDirectory: ContactDirectory = {
  async list(kind) {
    const path=contactPaths[kind];
    const rows=getRows(await client.read<{items:RecordRow[]}>(`${path}${path.includes('?')?'&':'?'}size=100`));
    return rows.map(row=>({id:String(row.id),kind,name:String(row.name),phone:String(row.phone??''),
      email:String(row.email??''),location:String(row.location??'')}));
  },
  create(kind,name,phone) {
    return kind==='Customer'?client.write('customers',{name,phone}):
      client.write('procurement-contacts',{kind:'SUPPLIER',name,phone});
  },
};
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed.';
const kigali = () => new Intl.DateTimeFormat('en-CA',{ timeZone:'Africa/Kigali',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());

export function StagingWorkspace() {
  const [owner,setOwner] = useState<Owner>();
  const [ready,setReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [section,setSection] = useState('Dashboard');
  useEffect(() => {
    let live=true;
    client.read<Owner>('auth/me').then(result => { if(live) setOwner(result); })
      .catch(error => { if(live && (!(error instanceof StagingError) || error.status!==401)) setError(errorText(error)); })
      .finally(()=> { if(live) setReady(true); });
    return ()=>{ live=false; };
  },[]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await client.login(String(data.get('email')),String(data.get('password')));
      setOwner(await client.read<Owner>('auth/me'));
    } catch(error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  if(!ready) return <main className="p-8" role="status">Checking owner session…</main>;
  if(!owner) return <main className="grid min-h-screen place-items-center bg-stone-100 px-4 text-emerald-950">
    <div className={`${card} w-full max-w-sm space-y-4`}><form onSubmit={login} className="space-y-4">
      <h1 className="text-2xl font-bold">BizFlow Jewelry</h1>
      <p className="text-stone-600">Sign in to the staging workspace.</p>
      <label className="block">Owner email<input className={control} name="email" type="email" autoComplete="username" required /></label>
      <label className="block">Password<input className={control} name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className={button} disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
    </form><ForgotOwnerPassword/></div>
  </main>;
  return <main className="min-h-screen bg-stone-100 text-emerald-950">
    <header className="border-b border-emerald-950 bg-emerald-950 text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div><h1 className="text-xl font-semibold">BizFlow Jewelry</h1><p className="text-sm text-emerald-200">Staging · {owner.name}</p></div>
        <button className="rounded-lg border border-emerald-600 px-4 py-2" onClick={() => void client.logout()
          .then(()=>{setOwner(undefined);setError('');}).catch(error=>setError(errorText(error)))}>Sign out</button>
      </div>
    </header>
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <nav aria-label="Workspace" className="flex flex-wrap gap-2">
        {['Dashboard', ...Object.keys(modules), 'Reports','Settings'].map(name => <button key={name} aria-pressed={name===section}
          onClick={()=>{setError('');setSection(name);}} className={`rounded-lg px-4 py-2 ${name===section?'bg-emerald-900 text-white':'bg-white'}`}>{name}</button>)}
      </nav>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {section==='Dashboard'?<Dashboard />:section==='Reports'?<Reports />:section==='Settings'?<BusinessSettings client={client}/>:
        <ModuleScreen key={section} name={section} config={modules[section]} />}
    </div>
  </main>;
}

function getRows(result: RecordRow[] | { items: RecordRow[] }) { return Array.isArray(result)?result:result.items; }
function summary(row: RecordRow) {
  return String(row.name ?? row.tracking ?? row.reference ?? row.sku ?? row.customerName ?? row.id);
}
async function options(source: string): Promise<Option[]> {
  if(source==='sale-payments'){
    const {items}=await client.read<{items:RecordRow[]}>('sales?size=20');
    return (await Promise.all(items.map(async sale=>(await client.read<RecordRow[]>(`sales/${sale.id}/payments`))
      .filter(p=>!p.reversalId).map(p=>({id:`${sale.id}:${p.id}`,label:`${summary(sale)} · ${p.reference} · ${p.amountRwf} RWF`}))))).flat();
  }
  const nested=source==='purchase-lines'||source==='sale-items';
  const root=source==='purchase-lines'?'purchases':source==='sale-items'?'sales':source;
  const path=root==='financial-accounts'||root==='expense-categories'?root:`${root}${root.includes('?')?'&':'?'}size=${nested?15:100}`;
  const rows=getRows(await client.read<RecordRow[] | { items: RecordRow[] }>(path));
  if(!nested) return rows.filter(row=>row.active!==false).map(row=>({ id:String(row.id),label:summary(row) }));
  const groups=await Promise.all(rows.map(async row=>{
    const detail=await client.read<{ lines?:RecordRow[]; items?:RecordRow[] }>(`${root}/${row.id}`);
    return (detail.lines??detail.items??[]).map(line=>({id:String(line.id),
      label:`${summary(row)} · ${String(line.productName??line.productId)} · ${String(line.outstanding??line.quantity??'')}`}));
  }));
  return groups.flat();
}

function ModuleScreen({name,config}:{ name:string;config:Module }) {
  const [workflow,setWorkflow] = useState(0);
  const [rows,setRows] = useState<RecordRow[]>([]);
  const [version,setVersion] = useState(0);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  useEffect(()=>{
    let live=true;
    client.read<RecordRow[] | { items: RecordRow[] }>(config.path).then(result=>{if(live)setRows(getRows(result));})
      .catch(error=>{if(live)setError(errorText(error));}).finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[config.path,version]);
  return <div className="grid gap-5 lg:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
    <section className={card}>
      <label className="block">Action<select className={control} value={workflow} onChange={e=>setWorkflow(Number(e.target.value))}>
        {config.workflows.map((item,i)=><option value={i} key={item.label}>{item.label}</option>)}
      </select></label>
      <div className="mt-4">
        {config.workflows[workflow].label==='Quick sale'?<MixedCheckout client={client} directory={stagingDirectory} updated={()=>setVersion(n=>n+1)}/>:
          config.workflows[workflow].label==='Import products'?<GuidedProductImport client={client} updated={()=>setVersion(n=>n+1)}/>:
          config.workflows[workflow].label==='Review shipment and discrepancies'?<ShipmentReview client={client}/>:
          <ActionForm key={workflow} workflow={config.workflows[workflow]} updated={()=>setVersion(n=>n+1)} version={version} />}
      </div>
    </section>
    <section className={`${card} min-w-0`}>
      <h2 className="mb-3 text-lg font-semibold">{name}</h2>
      {error&&<p role="alert">{error}</p>}
      {loading?<p role="status">Loading records…</p>:<Rows columns={config.columns} rows={rows} />}
    </section>
  </div>;
}

function ActionForm({workflow,updated,version}:{workflow:Workflow;updated:()=>void;version:number}) {
  const [available,setAvailable] = useState<Record<string,Option[]>>({});
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [lineCount,setLineCount] = useState(1);
  const key=useRef<string | undefined>(undefined);
  const inFlight=useRef(false);
  useEffect(()=>{
    let live=true;
    const sources=[...new Set([...workflow.fields,...workflow.lines??[]].flatMap(f=>
      f.source && !Object.values(contactPaths).includes(f.source)?[f.source]:[]))];
    Promise.all(sources.map(async source=>[source,await options(source)] as const))
      .then(pairs=>{if(live)setAvailable(Object.fromEntries(pairs));}).catch(error=>{if(live)setMessage(errorText(error));});
    return ()=>{live=false;};
  },[workflow,version]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(inFlight.current)return;
    inFlight.current=true;
    const form=event.currentTarget;
    const data=new FormData(form);
    function values(fields:Field[],prefix='') {
      const result:Values={};
      for(const f of fields) {
        const value=data.get(prefix+f.key);
        if(typeof value==='string' && value!=='') result[f.key]=f.type==='number'?Number(value):value;
      }
      return result;
    }
    key.current??=crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const lines=workflow.lines??[];
      const [route,body]=workflow.request(values(workflow.fields),key.current,
        Array.from({length:lineCount},(_,index)=>values(lines,`line${index}-`)));
      const file=data.get(workflow.image?'image':'receipt');
      let payload:object|FormData=body;
      if(file instanceof File && file.size>0) {
        const multipart=new FormData();
        if(!workflow.existingReceipt&&!workflow.image) multipart.append('expense',new Blob([JSON.stringify(body)],{ type:'application/json' }));
        multipart.append(workflow.image?'image':'receipt',file);
        payload=multipart;
      }
      await client.write(route,payload,workflow.method);
      key.current=undefined;
      form.reset();
      setLineCount(1);
      setMessage('Saved.');
      updated();
    } catch(error) { setMessage(errorText(error)); }
    finally { setBusy(false);inFlight.current=false; }
  }
  function render(f: Field,prefix='') {
    if(f.source===contactPaths.Customer||f.source===contactPaths.Supplier) {
      return <StagingContact key={f.key} name={prefix+f.key} kind={f.source===contactPaths.Customer?'Customer':'Supplier'}
        required={!f.optional} changed={()=>{key.current=undefined;}} />;
    }
    return <label className="block text-sm" key={f.key}>{f.label}{f.optional?' (optional)':''}
      {f.source||f.options?<select name={prefix+f.key} className={control} required={!f.optional} defaultValue={f.options?.[0]??''}>
        {f.source&&<option value="">Choose…</option>}{(f.source?available[f.source]??[]:f.options!.map(s=>({id:s,label:s})))
          .map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
      </select>:<input name={prefix+f.key} className={control} type={f.type??'text'} required={!f.optional}
        min={f.type==='number'?0:undefined} accept={f.type==='file'?(workflow.image?'image/png,image/jpeg,image/webp':'image/png,image/jpeg,image/webp,application/pdf'):undefined}
        defaultValue={f.type==='date'?kigali():f.value} />}
    </label>;
  }
  return <form onSubmit={submit} onChange={()=>{if(!inFlight.current)key.current=undefined;}} className="mt-4 space-y-3">
    {workflow.fields.map(f=>render(f))}
    {workflow.lines&&<div className="space-y-3">
      {Array.from({length:lineCount},(_,index)=><fieldset key={index} className="space-y-2 rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-semibold">Item {index+1}</legend>
        {workflow.lines?.map(f=>render(f,`line${index}-`))}
      </fieldset>)}
      <div className="flex gap-2">
        <button type="button" className="rounded border px-3 py-1 text-sm" disabled={busy||lineCount>=100}
          onClick={()=>{key.current=undefined;setLineCount(n=>n+1);}}>Add item</button>
        {lineCount>1&&<button type="button" className="rounded border px-3 py-1 text-sm" disabled={busy}
          onClick={()=>{key.current=undefined;setLineCount(n=>n-1);}}>Remove last item</button>}
      </div>
    </div>}
    <button className={button} disabled={busy}>{busy?'Saving…':'Save'}</button>
    {message&&<p role="status">{message}</p>}
  </form>;
}

function StagingContact({name,kind,required,changed}:{name:string;kind:'Customer'|'Supplier';required:boolean;changed:()=>void}) {
  const [selected,setSelected]=useState('');
  return <div>
    <input type="hidden" name={name} value={selected} />
    <ContactSelect kind={kind} required={required} directory={stagingDirectory} value={selected}
      onChange={value=>{setSelected(value);changed();}} />
  </div>;
}

function Rows({columns,rows,labels}:{columns:string[];rows:RecordRow[];labels?:Record<string,string>}) {
  if(!rows.length)return <p className="text-stone-600">No matching records.</p>;
  return <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm">
    <thead className="bg-emerald-900 text-white"><tr>{columns.map(c=><th scope="col" className="px-3 py-2" key={c}>
      {labels?.[c]??c.replace(/([A-Z])/g,' $1')}</th>)}</tr></thead>
    <tbody>{rows.map((row,i)=><tr className="border-b border-stone-200" key={String(row.id??i)}>
      {columns.map(c=><td className="px-3 py-2" key={c}>{typeof row[c]==='number'?format.format(row[c]):String(row[c]??'—')}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Dashboard() {
  const [range,setRange]=useState({from:kigali().slice(0,8)+'01',to:kigali()});
  const [trend,setTrend]=useState<Trend[]>([]);
  const [message,setMessage]=useState('Loading trend…');
  useEffect(()=>{
    let live=true;
    client.read<Trend[]>(`reports/dashboard?${new URLSearchParams(range)}`).then(rows=>{
      if(live) { setTrend(rows);setMessage(rows.length?'':'No sales for this period.'); }
    }).catch(error=>{if(live){setTrend([]);setMessage(errorText(error));}});
    return ()=>{live=false;};
  },[range]);
  return <section className={card}>
    <h2 className="text-xl font-semibold">Sales and gross profit</h2>
    <DateRange value={range} apply={setRange} />
    {message?<p role="status" className="mt-4">{message}</p>:<div className="mt-5 h-80" aria-label="Sales and gross profit trend in Rwandan francs">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trend} accessibilityLayer><CartesianGrid stroke="#e7e5e4" vertical={false} />
          <XAxis dataKey="day" tick={{fontSize:12}} /><YAxis tickFormatter={n=>format.format(n)} width={90} />
          <Tooltip formatter={value=>`${format.format(Number(value))} RWF`} />
          <Line name="Net sales" dataKey="revenue_rwf" stroke="#065f46" strokeWidth={3} />
          <Line name="Gross profit" dataKey="gross_profit_rwf" stroke="#a16207" strokeWidth={3} />
        </LineChart>
      </ResponsiveContainer>
    </div>}
  </section>;
}

function DateRange({value,apply}:{value:{from:string;to:string};apply:(value:{from:string;to:string})=>void}) {
  return <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event=>{
    event.preventDefault();const data=new FormData(event.currentTarget);
    apply({from:String(data.get('from')),to:String(data.get('to'))});
  }}>
    <label>From<input className={control} name="from" type="date" defaultValue={value.from} required /></label>
    <label>To<input className={control} name="to" type="date" defaultValue={value.to} required /></label>
    <button className={button}>Apply dates</button>
  </form>;
}

function Reports() {
  const [kind,setKind]=useState<keyof typeof reportKinds>('sales');
  const [group,setGroup]=useState('day');
  const [range,setRange]=useState({from:kigali().slice(0,8)+'01',to:kigali()});
  const [page,setPage]=useState(0);
  const [report,setReport]=useState<Report>();
  const [error,setError]=useState('');
  const filters=new URLSearchParams(kind==='accounts'||kind==='inventory'?{}:{...range,group}).toString();
  useEffect(()=>{
    let live=true;
    client.read<Report>(`reports/${kind}?page=${page}&${filters}`).then(result=>{if(live)setReport(result);})
      .catch(error=>{if(live)setError(errorText(error));});
    return ()=>{live=false;};
  },[kind,page,filters]);
  function reset() {setPage(0);setReport(undefined);setError('');}
  async function download(extension:'pdf'|'xlsx') {
    try {
      const blob=await client.download(`reports/${kind}/export?format=${extension}&${filters}`);
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download=`bizflow-${kind}.${extension}`;
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) { setError(errorText(error)); }
  }
  return <section className={`${card} space-y-4`}>
    <h2 className="text-xl font-semibold">Reports</h2>
    <div className="flex flex-wrap gap-4">
      <label>Report<select className={control} value={kind} onChange={e=>{reset();setKind(e.target.value as keyof typeof reportKinds);}}>
        {Object.entries(reportKinds).map(([key,name])=><option value={key} key={key}>{name}</option>)}
      </select></label>
      {kind==='sales'&&<label>Group by<select className={control} value={group} onChange={e=>{reset();setGroup(e.target.value);}}>
        {['day','week','month','product','category','channel'].map(g=><option key={g}>{g}</option>)}
      </select></label>}
    </div>
    {kind!=='accounts'&&kind!=='inventory'&&<DateRange value={range} apply={value=>{reset();setRange(value);}} />}
    {error&&<p role="alert">{error}</p>}
    {report?<><div className="flex flex-wrap items-center gap-3">
      <p>{report.total} matching records</p>
      <button className={button} onClick={()=>void download('pdf')}>Download PDF</button>
      <button className={button} onClick={()=>void download('xlsx')}>Download Excel</button>
    </div>
    <Rows columns={report.columns.map(c=>c.key)} rows={report.rows} labels={Object.fromEntries(report.columns.map(c=>[c.key,c.label]))} />
    <p>{Object.entries(report.totals).map(([key,value])=>`${key.replaceAll('_',' ')}: ${format.format(value)}`).join(' · ')}</p>
    <div className="flex gap-2">
      <button className={button} disabled={page===0} onClick={()=>setPage(n=>n-1)}>Previous</button>
      <button className={button} disabled={(page+1)*25>=report.total} onClick={()=>setPage(n=>n+1)}>Next</button>
    </div></>:!error&&<p role="status">Loading report…</p>}
  </section>;
}
