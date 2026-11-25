import { expect,test } from 'vitest';
import * as XLSX from 'xlsx';
import { autoMap,mapImportRows,parseProductSheet } from './import-sheet';

test('maps legacy CSV headers and does not coerce fractional stock',async()=>{
  const parsed=await parseProductSheet(new File(['SKU,name,category,selling_price,quantity\nA001,Ring,Jewelry,200,2.5'],'products.csv'));
  const result=mapImportRows(parsed,autoMap(parsed.headings));
  expect(result[0].product).toMatchObject({sku:'A001',name:'Ring',sellingPrice:200});
  expect(result[0].errors).toEqual(['Sheet quantity must be a nonnegative whole number.']);
});

test('accepts XLSX and supports explicit mapping when columns have custom names',async()=>{
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Code','Item','Section','Retail'],['B-2','Earring','Jewelry',900]]),'Products');
  const bytes=XLSX.write(book,{type:'array',bookType:'xlsx',compression:true}) as ArrayBuffer;
  const parsed=await parseProductSheet(new File([bytes],'products.xlsx'));
  expect(mapImportRows(parsed,{sku:0,name:1,category:2,sellingPrice:3})[0]).toMatchObject({
    errors:[],product:{sku:'B-2',name:'Earring',category:'Jewelry',sellingPrice:900},
  });
});

test('rejects an invalid workbook and duplicate assignments',async()=>{
  await expect(parseProductSheet(new File(['not a workbook'],'invalid.xlsx'))).rejects.toThrow('valid XLSX');
  expect(()=>mapImportRows({headings:['Code'],rows:[['C']]},{sku:0,name:0,category:0,sellingPrice:0})).toThrow('one field');
});
