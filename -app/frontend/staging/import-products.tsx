'use client';

import { useRef,useState } from 'react';
import type { createStagingClient } from './client';
import { autoMap,mapImportRows,parseProductSheet,sheetFields,type ImportMapping,type ParsedSheet,type SheetKey } from './import-sheet';

type Result={row:number;sku:string;name:string;action:string;errors:string[];warnings:string[]};
type Outcome={created:number;updated:number;skipped:number;rows:Result[]};
const button='rounded-md bg-emerald-900 px-4 py-2 font-medium text-white disabled:opacity-50';

export function GuidedProductImport({client,updated}:{client:ReturnType<typeof createStagingClient>;updated:()=>void}) {
  const [sheet,setSheet]=useState<ParsedSheet>();
  const [mapping,setMapping]=useState<ImportMapping>({});
  const [mode,setMode]=useState('SKIP');
  const [preview,setPreview]=useState<Result[]>();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const running=useRef(false);
  const reference=useRef('');
  const reset=()=>{setPreview(undefined);reference.current='';setMessage('');};
  async function inspect(file:File|undefined){
    reset();setSheet(undefined);
    if(!file||running.current)return;
    running.current=true;setBusy(true);
    try{const data=await parseProductSheet(file);setSheet(data);setMapping(autoMap(data.headings));}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to read the spreadsheet.');}
    finally{running.current=false;setBusy(false);}
  }
  async function send(confirm:boolean){
    if(!sheet||running.current)return;
    running.current=true;setBusy(true);setMessage('');
    try{
      const mapped=mapImportRows(sheet,mapping);
      if(mapped.some(row=>row.errors.length)){
        setPreview(mapped.map(row=>({row:row.row,sku:String(row.product.sku??''),name:String(row.product.name??''),action:'',
          errors:row.errors,warnings:[]})));
        return;
      }
      const rows=mapped.map(({product,quantity})=>({product,quantity}));
      if(confirm){
        reference.current||=crypto.randomUUID();
        const result=await client.write<Outcome>('products/import/confirm',{mode,rows,reference:reference.current});
        setMessage(`Imported. ${result.created} created, ${result.updated} updated, ${result.skipped} skipped. Stock unchanged.`);
        setPreview(undefined);updated();
      } else setPreview(await client.write<Result[]>('products/import/preview',{mode,rows}));
    }catch(e){setMessage(e instanceof Error?e.message:'Import failed.');}
    finally{running.current=false;setBusy(false);}
  }
  return <section className="space-y-3">
    <label className="block">Product spreadsheet<input type="file" className="block w-full rounded border p-2" accept=".csv,.xlsx"
      disabled={busy} onChange={e=>void inspect(e.target.files?.[0])}/></label>
    {sheet&&<>
      <p>{sheet.rows.length} rows found. Map columns before previewing. New products start with zero stock.</p>
      <label className="block">Existing SKUs<select className="block w-full rounded border p-2" value={mode} disabled={busy}
        onChange={e=>{reset();setMode(e.target.value);}}>
        <option value="SKIP">Skip existing SKUs</option><option value="UPDATE">Update existing product details</option>
      </select></label>
      <div className="grid grid-cols-2 gap-2">
        {(Object.entries(sheetFields) as [SheetKey,string][]).map(([key,label])=><label key={key} className="min-w-0 text-sm">{label}
          <select aria-label={'Map '+label} className="block w-full rounded border p-1" value={mapping[key]??''} disabled={busy}
            onChange={e=>{const v=e.target.value;reset();setMapping({...mapping,[key]:v===''?undefined:Number(v)});}}>
            <option value="">Unmapped</option>{sheet.headings.map((heading,index)=><option value={index} key={index}>{heading||'Column '+(index+1)}</option>)}
          </select></label>)}
      </div>
      <button type="button" className={button} disabled={busy} onClick={()=>void send(false)}>Preview import</button>
    </>}
    {preview&&<div className="space-y-3">
      <ul aria-label="Import preview" className="max-h-72 divide-y overflow-auto">
        {preview.map(row=><li key={row.row} className="py-2 text-sm"><strong>{row.row}. {row.sku} {row.name}</strong> {row.action}
          {row.errors.map(error=><p key={error} className="text-red-800">{error}</p>)}
          {row.warnings.map(warning=><p key={warning}>{warning}</p>)}
        </li>)}
      </ul>
      <button type="button" className={button} disabled={busy||preview.some(row=>row.errors.length>0)}
        onClick={()=>void send(true)}>Confirm import</button>
    </div>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
