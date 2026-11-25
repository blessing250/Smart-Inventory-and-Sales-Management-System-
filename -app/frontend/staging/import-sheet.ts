type Cell = string | number | boolean | null;
export const sheetFields = {
  sku:'SKU',name:'Product name',category:'Category',sellingPrice:'Selling price (RWF)',estimatedUnitCost:'Estimated cost (RWF)',
  reorderThreshold:'Reorder threshold',quantity:'Sheet quantity',familyId:'Existing family ID',supplierLabel:'Supplier',
  description:'Description',variantSize:'Size',variantColor:'Color',variantMaterial:'Material',variantDesign:'Design',
} as const;
export type SheetKey = keyof typeof sheetFields;
export type ImportMapping = Partial<Record<SheetKey, number>>;
export type ParsedSheet = { headings:string[]; rows:Cell[][] };
const required = ['sku','name','category','sellingPrice'] as const;
const integerFields = new Set<SheetKey>(['sellingPrice','estimatedUnitCost','reorderThreshold','quantity']);

async function checkZip(buffer:ArrayBuffer) {
  const view=new DataView(buffer);
  let end=-1;
  for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--) {
    if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===buffer.byteLength){end=i;break;}
  }
  if(end<0) throw new Error('Choose a valid XLSX workbook.');
  const count=view.getUint16(end+10,true);
  const directory=view.getUint32(end+16,true);
  let start=directory;
  if(count<1 || count>150 || start>=end || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0) {
    throw new Error('This workbook has an unsupported archive structure.');
  }
  let expanded=0;
  for(let i=0;i<count;i++){
    if(start+46>end || view.getUint32(start,true)!==0x02014b50)throw new Error('Choose a valid XLSX workbook.');
    const declared=view.getUint32(start+24,true);
    const compressed=view.getUint32(start+20,true);
    const method=view.getUint16(start+10,true);
    const local=view.getUint32(start+42,true);
    expanded+=declared;
    if(expanded>16*1024*1024)throw new Error('Expanded workbook exceeds 16 MiB.');
    if((view.getUint16(start+8,true)&1)!==0 || local+30>directory || view.getUint32(local,true)!==0x04034b50 ||
      view.getUint16(local+8,true)!==method)throw new Error('Choose a valid unencrypted XLSX workbook.');
    const data=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
    if(data+compressed>directory)throw new Error('Choose a valid XLSX workbook.');
    if(method===0){
      if(compressed!==declared)throw new Error('Choose a valid XLSX workbook.');
    }else if(method===8){
      const reader=new Blob([buffer.slice(data,data+compressed)]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      let actual=0;
      try{
        for(;;){
          const chunk=await reader.read();
          if(chunk.done)break;
          actual+=chunk.value.byteLength;
          if(actual>declared){await reader.cancel();throw new Error('Workbook entry exceeds its declared size.');}
        }
        if(actual!==declared)throw new Error('Workbook entry size does not match.');
      }finally{reader.releaseLock();}
    }else throw new Error('This XLSX compression method is unsupported.');
    start+=46+view.getUint16(start+28,true)+view.getUint16(start+30,true)+view.getUint16(start+32,true);
  }
  if(start!==end)throw new Error('Choose a valid XLSX workbook.');
}

export async function parseProductSheet(file:File):Promise<ParsedSheet> {
  if(file.size<1||file.size>2*1024*1024||!/\.(csv|xlsx)$/i.test(file.name))throw new Error('Choose a CSV or XLSX file up to 2 MiB.');
  const buffer=await file.arrayBuffer();
  const xlsx=/\.xlsx$/i.test(file.name);
  if(xlsx)await checkZip(buffer);
  const XLSX=await import('xlsx');
  const book=XLSX.read(xlsx?buffer:new TextDecoder().decode(buffer),{type:xlsx?'array':'string',raw:true,sheetRows:202,sheets:0});
  const sheet=book.Sheets[book.SheetNames[0]];
  if(!sheet||!sheet['!ref'])throw new Error('The workbook has no product rows.');
  if(XLSX.utils.decode_range(sheet['!ref']).e.c>=60)throw new Error('Use at most 60 columns.');
  const [headings,...rows]=XLSX.utils.sheet_to_json<Cell[]>(sheet,{header:1,raw:true,defval:null,blankrows:false});
  if(!headings||!rows.length||rows.length>200)throw new Error('Use 1 to 200 product rows under a header.');
  return {headings:headings.map(v=>String(v??'').trim()),rows};
}

export function mapImportRows(sheet:ParsedSheet,mapping:ImportMapping) {
  if(required.some(field=>mapping[field]===undefined))throw new Error('Map SKU, product name, category and selling price.');
  const assigned=Object.values(mapping).filter(index=>index!==undefined);
  if(new Set(assigned).size!==assigned.length)throw new Error('Map each spreadsheet column to one field.');
  return sheet.rows.map((row,index)=>{
    const product:Record<string,string|number>= {};
    let quantity:number|undefined;
    const errors:string[]=[];
    for(const [key,col] of Object.entries(mapping) as [SheetKey,number|undefined][]){
      if(col===undefined)continue;
      const cell=row[col];
      if(cell===null||cell===undefined||cell==='')continue;
      if(integerFields.has(key)){
        const source=String(cell).trim();
        const parsed=/^\d+$/.test(source)?Number(source):NaN;
        if(!Number.isSafeInteger(parsed))errors.push(sheetFields[key]+' must be a nonnegative whole number.');
        else if(key==='quantity')quantity=parsed;
        else product[key]=parsed;
      }else product[key]=String(cell).trim();
    }
    return {row:index+1,product,quantity,errors};
  });
}

export function autoMap(headings:string[]):ImportMapping {
  const aliases:Record<string,SheetKey>={sellingprice:'sellingPrice',price:'sellingPrice',purchaseprice:'estimatedUnitCost',
    minimumquantity:'reorderThreshold',family:'familyId',supplier:'supplierLabel'};
  const normalize=(s:string)=>s.toLowerCase().replaceAll(/[^a-z]/g,'');
  const mapping:ImportMapping={};
  headings.forEach((heading,index)=>{
    const normalized=normalize(heading);
    const key=aliases[normalized]??(Object.keys(sheetFields) as SheetKey[]).find(k=>normalize(k)===normalized);
    if(key && mapping[key]===undefined)mapping[key]=index;
  });
  return mapping;
}
