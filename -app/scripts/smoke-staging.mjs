import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import XLSX from 'xlsx';
import pg from 'pg';

const folder=await mkdtemp(join(tmpdir(),'bizflow-m8-smoke-'));
const url='http://127.0.0.1:13188';
const email='smoke-owner@example.test';
const password='milestone-eight-fixture-password';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let backend;
let backendUrl;
const launchSpring=()=>spawn('java',['-jar','backend/spring/target/bizflow-backend-0.1.0-SNAPSHOT.jar'],{windowsHide:true,stdio:'ignore',
  env:{...process.env,BIZFLOW_AUTH_APP_URL:url,BIZFLOW_AUTH_RESET_PATH:'/staging/reset-password',BIZFLOW_FOUNDATION_PORT:'18081'}});
if(process.env.BIZFLOW_SMOKE_START_SPRING==='1') {
  const database=process.env.BIZFLOW_FOUNDATION_DATABASE??'';
  const jdbc=process.env.BIZFLOW_FOUNDATION_JDBC_URL??'';
  if(!/^bizflow_foundation_test_[a-z0-9]+$/.test(database)||!/^jdbc:postgresql:\/\/127\.0\.0\.1:\d+\//.test(jdbc)) {
    throw Error('Use a fresh loopback test database for the staging smoke.');
  }
  const settings=new URL(jdbc.slice(5));
  assert.equal(settings.pathname,'/'+database);
  backendUrl='http://127.0.0.1:18081';
  backend=launchSpring();
  try {
    let springReady=false;
    for(let i=0;i<75;i++){
      try {springReady=(await fetch(backendUrl+'/api/health/ready')).ok;}catch{}
      if(springReady)break;
      if(backend.exitCode!==null)break;
      await wait(400);
    }
    assert.ok(springReady,'Spring readiness failed');
    const db=new pg.Client({host:settings.hostname,port:Number(settings.port),database,
      user:process.env.BIZFLOW_FOUNDATION_DB_USER,password:process.env.BIZFLOW_FOUNDATION_DB_PASSWORD});
    await db.connect();
    try {
      if(process.env.BIZFLOW_SMOKE_USE_RESTORED==='1'){
        const state=await db.query("SELECT id FROM bizflow_foundation.owner_accounts WHERE email='rehearsal@example.test'");
        assert.equal(state.rows[0]?.id,'m8-owner','Expected the migrated owner in the restored fixture');
      }else await db.query('INSERT INTO bizflow_foundation.owner_accounts(id,email,display_name,password_hash) VALUES ($1,$2,$3,$4)',
        ['m8-browser-owner','rehearsal@example.test','Staging fixture','$2b$12$C5K7uDtsM.ovTogOEoh.ouUrtW3w50n3a3UFY5UbuGUwise98vdbe']);
    } finally {await db.end();}
  } catch(error) {backend.kill();throw error;}
}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','13188','-H','127.0.0.1'],{windowsHide:true,stdio:'ignore',
  env:{...process.env,NEXTAUTH_URL:url,NEXTAUTH_SECRET:'disposable-m8-owner-signing-fixture-not-production',BIZFLOW_DATABASE:'sqlite',BIZFLOW_DB_PATH:join(folder,'legacy.sqlite'),
    BIZFLOW_OWNER_EMAIL:email,BIZFLOW_OWNER_PASSWORD:password,BIZFLOW_STAGING_ENABLED:backendUrl?'1':'0',
    BIZFLOW_STAGING_SPRING_URL:backendUrl??''}});
const jar=new Map();
const cookies=response=>response.headers.getSetCookie().forEach(value=>{
  const pair=value.split(';')[0];const index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));
});
async function legacy(path, body, raw=false) {
  const r=await fetch(url+path,{headers:{Origin:url,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body&&{'Content-Type':'application/json'})},
    ...(body&&{method:'POST',body:JSON.stringify(body)})});
  assert.ok(r.ok,path+' returned '+r.status);
  return raw?r:r.json();
}
async function ready(path) {
  for(let i=0;i<75;i++){try{if((await fetch(url+path)).ok)return;}catch{} await wait(400);}
  throw Error(path+' was unavailable');
}
try {
  await ready('/api/health/live');
  assert.ok([401,403].includes((await fetch(url+'/api/products',{headers:{Origin:url}})).status));
  const csrfResponse=await fetch(url+'/api/auth/csrf');cookies(csrfResponse);
  const {csrfToken}=await csrfResponse.json();
  const signed=await fetch(url+'/api/auth/callback/credentials',{method:'POST',redirect:'manual',
    headers:{Origin:url,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({csrfToken,email,password,json:'true',callbackUrl:url+'/dashboard'})});
  assert.ok(signed.ok);cookies(signed);
  await ready('/api/health/ready');
  const item=await legacy('/api/products',{sku:'M8-SMOKE',name:'Fixture ring',category:'Jewelry',purchase_price:51,selling_price:101,quantity:2,minimum_quantity:0,supplier:''});
  const saleInput={request_key:randomUUID(),payment_method:'Cash',items:[{product_id:item.id,quantity:1,unit_discount:1}]};
  const sale=await legacy('/api/sales',saleInput);
  assert.equal(sale.total_amount,100);
  assert.equal((await legacy('/api/sales',saleInput)).id,sale.id);
  const savedSale=(await legacy('/api/sales')).find(record=>record.id===sale.id);
  assert.equal(savedSale.items[0].cost,51);
  const receipt=await legacy('/api/sales/receipt?id='+sale.id,undefined,true);
  assert.equal(receipt.headers.get('content-type'),'application/pdf');
  const purchase=await legacy('/api/purchases',{supplier_name:'Fixture supplier',items:[{product_id:item.id,quantity:1,unit_cost:80}]});
  assert.ok(purchase.id);
  const stocked=await legacy('/api/stock');assert.ok(stocked.products.some(p=>p.id===item.id&&p.quantity===1));
  await legacy('/api/dashboard');
  const xlsx=await legacy('/api/reports/export?format=excel',undefined,true);
  assert.match(xlsx.headers.get('content-type'),/sheet/);
  const workbook=XLSX.read(new Uint8Array(await xlsx.arrayBuffer()));
  assert.ok(workbook.SheetNames.length);
  console.log('SQLite production smoke passed: owner guard, login, product, sale retry, stock, purchase, dashboard, receipt and Excel.');

  if(backendUrl) {
    await ready('/staging');
    const spring=async(path,body,authorization)=>{
      const response=await fetch(url+'/spring/api/v1/'+path,{headers:{Origin:url,...(authorization&&{Authorization:'Bearer '+authorization}),
        ...(body&&{'Content-Type':'application/json'})},...(body&&{method:'POST',body:JSON.stringify(body)})});
      assert.ok(response.ok,path+' returned '+response.status);
      return response;
    };
    const signed=await spring('auth/browser-login',{email:'rehearsal@example.test',password:'migration-fixture-password'});
    const token=(await signed.json()).accessToken;
    const business=await spring('settings',undefined,token).then(r=>r.json());
    const profileResponse=await fetch(url+'/spring/api/v1/settings',{method:'PUT',
      headers:{Origin:url,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({...business,name:'Disposable BizFlow Fixture'})});
    assert.ok(profileResponse.ok);
    assert.equal((await profileResponse.json()).name,'Disposable BizFlow Fixture');
    const p=await spring('products',{sku:'M8-PG-RING',name:'Fixture ring',category:'Jewelry',sellingPrice:101,estimatedUnitCost:51,reorderThreshold:0},token).then(r=>r.json());
    await spring('inventory/products/'+p.id+'/opening',{quantity:2,valueRwf:102,reference:'m8-fixture-opening',reason:'Fixture'},token);
    const customer=await spring('customers',{name:'Smoke buyer'},token).then(r=>r.json());
    const account=await spring('financial-accounts',{kind:'CASH',name:'Smoke till'},token).then(r=>r.json());
    const mobile=await spring('financial-accounts',{kind:'MOBILE_MONEY',name:'Smoke mobile'},token).then(r=>r.json());
    const mixedProduct=await spring('products',{sku:'M9-MIXED',name:'Mixed payment ring',category:'Jewelry',sellingPrice:200000,
      estimatedUnitCost:51000,reorderThreshold:0},token).then(r=>r.json());
    await spring('inventory/products/'+mixedProduct.id+'/opening',{quantity:2,valueRwf:102000,reference:'m9-fixture-opening',reason:'Fixture'},token);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kigali',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const order=await spring('sales',{reference:'m8-stage-sale',channel:'Physical shop',date,customerId:customer.id,
      items:[{productId:p.id,quantity:1,unitDiscountRwf:1}],payments:[{reference:'m8-stage-payment',accountId:account.id,method:'CASH',amountRwf:100}]},token).then(r=>r.json());
    assert.equal(order.sale.totalRwf,sale.total_amount);
    assert.equal(order.sale.costRwf,savedSale.items[0].cost);
    const timeline=await spring('reports/dashboard?from='+date+'&to='+date,undefined,token).then(r=>r.json());
    assert.equal(timeline[0].revenue_rwf,100);assert.equal(timeline[0].gross_profit_rwf,49);
    const book=await spring('reports/sales/export?format=xlsx&from='+date+'&to='+date,undefined,token);
    const document=XLSX.read(new Uint8Array(await book.arrayBuffer()));
    assert.equal(document.Sheets.Report.C5.v,100);
    assert.match(document.Sheets.Report.A1.v,/Disposable BizFlow Fixture/);
    console.log('Same-origin staging smoke passed: owner login, inventory, sale, trend and Excel. Shared fixtures matched RWF 100 revenue and RWF 51 COGS.');
    const supplier=await spring('procurement-contacts',{kind:'SUPPLIER',name:'Smoke supplier'},token).then(r=>r.json());
    const agent=await spring('procurement-contacts',{kind:'AGENT',name:'Smoke carrier'},token).then(r=>r.json());
    const cargo=await spring('products',{sku:'M9-CARGO',name:'Smoke cargo',category:'Jewelry',sellingPrice:400,estimatedUnitCost:80,reorderThreshold:0},token).then(r=>r.json());
    const purchaseOrder=await spring('purchases',{reference:'m9-purchase',supplierId:supplier.id,date,currency:'RWF',rateMicros:1000000,
      lines:[{productId:cargo.id,quantity:3,unitMinor:80}]},token).then(r=>r.json());
    const lineId=purchaseOrder.lines[0].id;
    const shipment=await spring('shipments',{tracking:'M9-CARGO-TEST',agentId:agent.id,plannedDate:date,lines:[{lineId,quantity:3}]},token).then(r=>r.json());
    const shipmentId=shipment.shipment.id;
    const shipmentPath='shipments/'+shipmentId;
    const update=await fetch(url+'/spring/api/v1/'+shipmentPath+'/charges',{method:'PUT',
      headers:{Origin:url,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({allocation:'QUANTITY',shipping:30,customs:0,clearing:0,other:0})});
    assert.ok(update.ok,await update.text());
    const received=await spring(shipmentPath+'/receipts',{reference:'m9-receiving',date,
      lines:[{lineId,usable:1,damaged:1,missing:1,explanation:'Disposable reception fixture'}]},token).then(r=>r.json());
    const funding=await spring('financial-accounts',{kind:'BANK',name:'Smoke funding',openingRwf:1000},token).then(r=>r.json());
    await spring('suppliers/'+supplier.id+'/payments',{reference:'m9-supplier-payment',accountId:funding.id,
      allocations:[{purchaseId:purchaseOrder.order.id,amountRwf:40}]},token);
    const bank=await spring('financial-accounts',{kind:'BANK',name:'Smoke transfer destination'},token).then(r=>r.json());
    await spring('finance/transfers',{reference:'m9-rwf-transfer',fromAccount:funding.id,toAccount:bank.id,amountRwf:75},token);
    const dollar=await spring('financial-accounts/native',{kind:'BANK',name:'Smoke USD',currency:'USD',openingMinor:1000,rwfRateMicros:150000000},token).then(r=>r.json());
    const yuan=await spring('financial-accounts/native',{kind:'BANK',name:'Smoke CNY',currency:'CNY'},token).then(r=>r.json());
    await spring('finance/exchanges',{reference:'m9-exchange',fromAccount:dollar.id,toAccount:yuan.id,sourceMinor:200,
      destinationMinor:1400,feeMinor:25,rwfRateMicros:150000000,exchangeRateMicros:7000000},token);
    const hold=await spring(shipmentPath+'/claims',{receiptId:received.receipt.id,lineId,kind:'DAMAGE',reference:'m9-damage-claim',
      claimant:'Smoke supplier',amountRwf:50,notes:'Report damage'},token).then(r=>r.json());
    await spring(shipmentPath+'/claims/'+hold.id+'/decision',{acceptedRwf:30,notes:'Commit to partial compensation'},token);
    const blocked=await fetch(url+'/spring/api/v1/'+shipmentPath+'/receipts/'+received.receipt.id+'/correction',{
      method:'POST',headers:{Origin:url,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({reference:'m9-blocked-correction',reason:'Linked claim prevents correction'})});
    assert.equal(blocked.status,409);
    assert.equal((await spring('inventory/products/'+cargo.id+'/balance',undefined,token).then(r=>r.json())).valueRwf,90);
    console.log('Procurement, damage and shortage, claim decision, correction guard, supplier payment, RWF transfer and FX passed over staging HTTP.');
    const chrome=process.env.BIZFLOW_SMOKE_BROWSER??'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const profile=join(folder,'browser');
    const browser=spawn(chrome,['--headless','--disable-gpu','--no-first-run','--remote-debugging-port=19388','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let acceptedSaleId;
    let stagingPassword='migration-fixture-password';
    try {
      let debug;
      for(let i=0;i<50;i++){try{debug=await fetch('http://127.0.0.1:19388/json/list').then(r=>r.json());if(debug.length)break;}catch{}await wait(200);}
      assert.ok(debug?.length);
      const socket=new WebSocket(debug[0].webSocketDebuggerUrl);
      await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
      let id=0;
      const callbacks=new Map();
      socket.addEventListener('message',e=>{
        const response=JSON.parse(e.data);const done=callbacks.get(response.id);
        if(done){callbacks.delete(response.id);done(response);}
      });
      const cdp=(method,params={})=>new Promise((resolve,reject)=>{
        const n=++id;callbacks.set(n,message=>message.error?reject(Error(message.error.message)):resolve(message.result));
        socket.send(JSON.stringify({id:n,method,params}));
      });
      const evaluate=async expression=>(await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
      const until=async expression=>{
        for(let i=0;i<75;i++){if(await evaluate(expression))return;await wait(200);}
        const status=await evaluate('Array.from(document.querySelectorAll("[role=alert],[role=status]")).map(e=>e.textContent.trim()).join(" | ")');
        throw Error('Browser state did not become ready. '+status);
      };
      await cdp('Page.navigate',{url:url+'/staging'});
      await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
      await until('Boolean(document.querySelector("input[type=email]"))');
      await evaluate('document.querySelector("input[type=email]").value="rehearsal@example.test";document.querySelector("input[type=password]").value="migration-fixture-password";document.querySelector("form").requestSubmit();true');
      await until('Boolean(document.querySelector(".recharts-surface"))');
      await cdp('Page.reload');
      await until('Boolean(document.querySelector(".recharts-surface"))');
      const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&b.textContent.trim()===${JSON.stringify(label)})?.click();true`);
      const labeled=(label,value,index=0)=>evaluate(`(()=>{
        const el=Array.from(document.querySelectorAll('label')).filter(l=>l.getClientRects().length&&l.textContent.trim().startsWith(${JSON.stringify(label)}))
          [${index}]?.querySelector('input,select,textarea');
        if(!el)return false;
        const prototype=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});
        el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
        return true;
      })()`);
      const option=async value=>{
        await until(`Array.from(document.querySelectorAll("option")).some(o=>o.value===${JSON.stringify(value)})`);
      };
      const set=async (label,value)=>assert.equal(await labeled(label,String(value)),true,label);
      const openAction=async (section,label)=>{
        await click(section);
        const name=JSON.stringify(label);
        await until(`Array.from(document.querySelectorAll('option')).some(o=>o.textContent.trim()===${name})`);
        const value=await evaluate(`Array.from(document.querySelectorAll('option')).find(o=>o.textContent.trim()===${name}).value`);
        await set('Action',value);
      };
      const save=async()=>{
        await click('Save');
        await until('Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent==="Saved.")');
      };
      const upload=async (filename,mime,encoded)=>evaluate(`(()=>{
        const input=document.querySelector('input[type=file]');const files=new DataTransfer();
        files.items.add(new File([Uint8Array.from(atob(${JSON.stringify(encoded)}),b=>b.charCodeAt(0))],${JSON.stringify(filename)},{type:${JSON.stringify(mime)}}));
        input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;
      })()`);

      await openAction('Products','Add product family');
      await set('Family name','M10 fixture family');
      await save();
      const families=await spring('product-families?size=100',undefined,token).then(r=>r.json());
      const family=families.items.find(row=>row.name==='M10 fixture family');
      assert.ok(family);
      await openAction('Products','Register product');
      await set('SKU','M10-BROWSER-RING');await set('Product name','M10 browser ring');await set('Category','Jewelry');
      await option(family.id);await set('Family',family.id);
      await set('Size','7');await set('Color','Gold');await set('Material','Silver');await set('Price (RWF)',300);
      await save();
      const registered=await spring('products?q=M10-BROWSER-RING',undefined,token).then(r=>r.json());
      assert.equal(registered.total,1);
      const browserProduct=registered.items[0];
      assert.deepEqual([browserProduct.familyId,browserProduct.variantSize,browserProduct.variantColor],[family.id,'7','Gold']);
      await openAction('Products','Upload product image');
      await option(browserProduct.id);await set('Product',browserProduct.id);
      await until('Boolean(document.querySelector("input[type=file]"))');
      await upload('fixture.png','image/png','iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN3sAAAAASUVORK5CYII=');
      await save();
      assert.equal((await spring('products/'+browserProduct.id+'/image',undefined,token)).headers.get('content-type'),'image/png');
      await openAction('Inventory','Record opening stock');
      await option(browserProduct.id);await set('Product',browserProduct.id);await set('Quantity',4);
      await set('Total value (RWF)',400);await set('Reason','Opening fixture');await save();
      const balancePath='inventory/products/'+browserProduct.id+'/balance';
      const opened=await spring(balancePath,undefined,token).then(r=>r.json());
      assert.deepEqual([opened.quantity,opened.valueRwf],[4,400]);
      await openAction('Inventory','Draft stock count');
      await option(browserProduct.id);await set('Product',browserProduct.id);await set('Observed quantity',3);
      await set('Version shown in stock list',opened.version);await set('Reason','Count fixture');await save();
      const counts=await spring('inventory/counts?size=100',undefined,token).then(r=>r.json());
      const count=counts.items.find(row=>row.productId===browserProduct.id);
      assert.ok(count);
      await openAction('Inventory','Confirm stock count');
      await option(count.id);await set('Count',count.id);await save();
      const counted=await spring(balancePath,undefined,token).then(r=>r.json());
      assert.deepEqual([counted.quantity,counted.valueRwf],[3,300]);
      console.log('Desktop browser product registration, variants, image, opening balance and confirmed count passed.');

      await openAction('Purchases','Add supplier or agent');
      await set('Name','M10 browser supplier');await save();
      const contacts=await spring('procurement-contacts?kind=SUPPLIER&size=100',undefined,token).then(r=>r.json());
      const browserSupplier=contacts.items.find(row=>row.name==='M10 browser supplier');
      assert.ok(browserSupplier);
      await openAction('Purchases','Quick purchase');
      await option(browserSupplier.id);await set('Saved supplier',browserSupplier.id);
      await option(browserProduct.id);await set('Product',browserProduct.id);await set('Quantity',2);await set('Unit price',80);await save();
      const orders=await spring('purchases?size=100',undefined,token).then(r=>r.json());
      const browserOrder=orders.items.find(row=>row.supplierId===browserSupplier.id);
      assert.ok(browserOrder);
      const browserPurchase=await spring('purchases/'+browserOrder.id,undefined,token).then(r=>r.json());
      const browserLine=browserPurchase.lines[0].id;
      await openAction('Shipments','Plan shipment');
      await set('Tracking reference','M10-BROWSER-SHIPMENT');await option(agent.id);await set('Agent',agent.id);
      await option(browserLine);await set('Purchase line',browserLine);await set('Planned quantity',2);await save();
      const shipPage=await spring('shipments?size=100',undefined,token).then(r=>r.json());
      const browserShipment=shipPage.items.find(row=>row.tracking==='M10-BROWSER-SHIPMENT');
      assert.ok(browserShipment);
      await openAction('Shipments','Record shipment charges');
      await option(browserShipment.id);await set('Shipment',browserShipment.id);await set('shipping',20);await save();
      await openAction('Shipments','Receive shipment');
      await option(browserShipment.id);await set('Shipment',browserShipment.id);await option(browserLine);
      await set('Manifest purchase line',browserLine);await set('Usable',1);await save();
      const receiptBalance=await spring(balancePath,undefined,token).then(r=>r.json());
      assert.deepEqual([receiptBalance.quantity,receiptBalance.valueRwf],[4,390]);
      const manifest=await spring('shipments/'+browserShipment.id,undefined,token).then(r=>r.json());
      assert.equal(manifest.lines[0].outstanding,1);
      console.log('Desktop browser supplier, purchase, manifest, charges and partial landed-cost receipt passed.');

      await openAction('Purchases','Pay supplier');
      await option(browserSupplier.id);await set('Saved supplier',browserSupplier.id);
      await option(funding.id);await set('Account',funding.id);await option(browserOrder.id);await set('Purchase',browserOrder.id);
      await set('Payment (RWF)',10);await save();
      const obligations=await spring('suppliers/'+browserSupplier.id+'/obligations',undefined,token).then(r=>r.json());
      assert.equal(obligations.find(row=>row.purchaseId===browserOrder.id).outstandingRwf,150);
      await openAction('Accounts','Transfer RWF');
      await option(funding.id);await set('From account',funding.id);await option(bank.id);await set('To account',bank.id);
      await set('Amount (RWF)',25);await save();
      assert.equal((await spring('financial-accounts/'+bank.id,undefined,token).then(r=>r.json())).balanceRwf,100);
      await openAction('Accounts','Exchange or transfer native currency');
      await option(dollar.id);await set('From account',dollar.id);await option(yuan.id);await set('To account',yuan.id);
      await set('Sent in source minor units',100);await set('Received in destination minor units',700);
      await set('RWF reporting rate in millionths',150000000);await set('Destination per source rate in millionths',7000000);
      await save();
      assert.equal((await spring('financial-accounts/'+dollar.id,undefined,token).then(r=>r.json())).balanceMinor,675);
      assert.equal((await spring('financial-accounts/'+yuan.id,undefined,token).then(r=>r.json())).balanceMinor,2100);
      console.log('Desktop browser supplier settlement, RWF transfer and USD/CNY exchange reconciled.');

      await click('Sales');
      await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Mixed payment ring"))');
      await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Mixed payment ring")).click();true');
      await until('Array.from(document.querySelectorAll("option")).some(o=>o.textContent.includes("Smoke buyer"))');
      assert.equal(await labeled('Saved customer',customer.id),true);
      await click('Add payment');
      await click('Add payment');
      assert.equal(await labeled('Receiving account',account.id),true);
      assert.equal(await labeled('Amount (RWF)','50000'),true);
      assert.equal(await labeled('Method','MOBILE_MONEY',1),true);
      assert.equal(await labeled('Receiving account',mobile.id,1),true);
      assert.equal(await labeled('Amount (RWF)','100000',1),true);
      await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Confirm checkout"&&!b.disabled)');
      await evaluate('const pay=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Confirm checkout");pay.click();pay.click();true');
      await until('document.body.textContent.includes("Sale confirmed")');
      const sales=await spring('sales?size=10',undefined,token).then(r=>r.json());
      const mixedSales=sales.items.filter(s=>s.totalRwf===200000);
      assert.equal(mixedSales.length,1);
      acceptedSaleId=mixedSales[0].id;
      assert.equal(mixedSales[0].paidRwf,150000);
      assert.equal(mixedSales[0].outstandingRwf,50000);
      assert.equal((await spring('financial-accounts/'+account.id,undefined,token).then(r=>r.json())).balanceRwf,50100);
      assert.equal((await spring('financial-accounts/'+mobile.id,undefined,token).then(r=>r.json())).balanceRwf,100000);
      await click('Receipt PDF');
      await openAction('Sales','Record customer payment');
      await option(acceptedSaleId);await set('Sale',acceptedSaleId);await option(account.id);await set('Account',account.id);
      await set('Amount (RWF)',15000);await save();
      const mixedDetail=await spring('sales/'+mixedSales[0].id,undefined,token).then(r=>r.json());
      assert.equal(mixedDetail.sale.outstandingRwf,35000);
      const refundReserve=await spring('financial-accounts',{kind:'BANK',name:'Smoke refund reserve',openingRwf:200000},token).then(r=>r.json());
      await openAction('Sales','Return item');
      await option(acceptedSaleId);await set('Sale',acceptedSaleId);await option(mixedDetail.items[0].id);
      await set('Original sale item',mixedDetail.items[0].id);await set('Reason','Disposable browser return');
      await option(refundReserve.id);await set('Refund account',refundReserve.id);await save();
      assert.equal((await spring('financial-accounts/'+refundReserve.id,undefined,token).then(r=>r.json())).balanceRwf,35000);
      console.log('Desktop 1440px mixed checkout passed, including duplicate click, account postings, receivable, and receipt action.');

      await openAction('Orders','Create online order');
      await option(customer.id);await set('Saved customer',customer.id);await set('Contact','Fixture number');
      await set('Source','Online');await option(browserProduct.id);await set('Product',browserProduct.id);await save();
      const online=await spring('online-orders?size=100',undefined,token).then(r=>r.json());
      const browserOnline=online.items.find(row=>row.status==='PENDING'&&row.customerId===customer.id);
      assert.ok(browserOnline);
      await openAction('Orders','Confirm order');
      await option(browserOnline.id);await set('Order',browserOnline.id);await save();
      const confirmed=await spring('online-orders/'+browserOnline.id,undefined,token).then(r=>r.json());
      assert.ok(confirmed.order.saleId);
      const onlineBalance=await spring(balancePath,undefined,token).then(r=>r.json());
      assert.deepEqual([onlineBalance.quantity,onlineBalance.valueRwf],[3,292]);
      console.log('Desktop browser online order confirmation posted one sale and reduced stock.');

      await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await click('Products');
      await until('Array.from(document.querySelectorAll("option")).some(o=>o.textContent==="Import products")');
      assert.equal(await labeled('Action','2'),true);
      await until('Boolean(document.querySelector("input[type=file]"))');
      await evaluate(`(()=>{
        const input=document.querySelector('input[type=file]');const files=new DataTransfer();
        files.items.add(new File(['sku,name,category,selling_price,quantity\\nM9-BROWSER-CSV,Imported bracelet,Jewelry,1250,6'],'fixture.csv',{type:'text/csv'}));
        input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;
      })()`);
      await until('document.body.textContent.includes("1 rows found")');
      await click('Preview import');
      await until('document.body.textContent.includes("Sheet quantity will not change stock")');
      await click('Confirm import');
      await until('document.body.textContent.includes("1 created")');
      const imported=await spring('products?q=M9-BROWSER-CSV',undefined,token).then(r=>r.json());
      assert.equal(imported.total,1);
      assert.equal((await spring('inventory/products/'+imported.items[0].id+'/balance',undefined,token).then(r=>r.json())).quantity,0);
      const xlsxBook=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(xlsxBook,XLSX.utils.aoa_to_sheet([['sku','name','category','selling_price'],['M9-BROWSER-XLSX','Imported pendant','Jewelry',1400]]),'Products');
      const encoded=XLSX.write(xlsxBook,{type:'base64',bookType:'xlsx',compression:true});
      await evaluate(`(()=>{
        const input=document.querySelector('input[type=file]');const files=new DataTransfer();
        const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),b=>b.charCodeAt(0));
        files.items.add(new File([bytes],'fixture.xlsx'));
        input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;
      })()`);
      await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Preview import"&&!b.disabled)');
      await click('Preview import');
      await until('document.body.textContent.includes("M9-BROWSER-XLSX")');
      await click('Confirm import');
      await until('document.body.textContent.includes("1 created")');
      assert.equal((await spring('products?q=M9-BROWSER-XLSX',undefined,token).then(r=>r.json())).total,1);
      await click('Expenses');
      await until('Array.from(document.querySelectorAll("option")).some(o=>o.value==="rent")');
      assert.equal(await labeled('Amount (RWF)','500'),true);
      assert.equal(await labeled('Category','rent'),true);
      assert.equal(await labeled('Account',account.id),true);
      await click('Save');
      await until('Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent==="Saved.")');
      const expenses=await spring('expenses?size=10',undefined,token).then(r=>r.json());
      assert.ok(expenses.items.some(e=>e.amountRwf===500&&e.receiptCount===0));
      console.log('Mobile 390px guided CSV and XLSX imports and receipt-free expense submission passed.');
      await click('Shipments');
      await until('Array.from(document.querySelectorAll("option")).some(o=>o.textContent==="Review shipment and discrepancies")');
      assert.equal(await labeled('Action','3'),true);
      await until('Array.from(document.querySelectorAll("option")).some(o=>o.textContent.includes("M9-CARGO-TEST"))');
      assert.equal(await labeled('Shipment',shipmentId),true);
      await until('document.body.textContent.includes("DAMAGE")');
      await evaluate('Array.from(document.querySelectorAll("summary")).find(e=>e.textContent.startsWith("DAMAGE")).click();true');
      assert.equal(await labeled('Amount (RWF)','10'),true);
      assert.equal(await labeled('Receiving account',funding.id),true);
      assert.equal(await labeled('Resolution notes','Partial cash received'),true);
      await click('Review post resolution');
      await until('document.body.textContent.includes("receiving account will gain")');
      await click('Confirm post resolution');
      await until('Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent==="Saved.")');
      const issues=await spring(shipmentPath+'/claims',undefined,token).then(r=>r.json());
      assert.ok(issues.some(issue=>issue.resolutions.some(entry=>entry.action==='CASH'&&entry.amountRwf===10)));
      await evaluate('Array.from(document.querySelectorAll("summary")).find(e=>e.textContent.startsWith("SHORTAGE")).click();true');
      await set('Supplier or carrier','Chrome fixture carrier');await set('Requested RWF',8);
      await click('Review submit claim');await click('Confirm submit claim');
      await until('document.body.textContent.includes("Claim SUBMITTED")');
      await set('Accepted RWF',5);await set('Decision notes','Chrome claim decision');
      await click('Review decide claim');await click('Confirm decide claim');
      await until('document.body.textContent.includes("Claim ACCEPTED")');
      const updatedIssues=await spring(shipmentPath+'/claims',undefined,token).then(r=>r.json());
      assert.equal(updatedIssues.find(issue=>issue.kind==='SHORTAGE').claim.acceptedRwf,5);
      assert.equal((await spring('finance/reconciliation',undefined,token).then(r=>r.json())).matches,true);
      console.log('Mobile 390px shipment review and partial cash compensation posted and reconciled.');
      await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Sign out").click();true');
      await until('Boolean(document.querySelector("input[type=email]"))');
      const jdbc=new URL(process.env.BIZFLOW_FOUNDATION_JDBC_URL.slice(5));
      const recoveryDb=new pg.Client({host:jdbc.hostname,port:Number(jdbc.port),database:process.env.BIZFLOW_FOUNDATION_DATABASE,
        user:process.env.BIZFLOW_FOUNDATION_DB_USER,password:process.env.BIZFLOW_FOUNDATION_DB_PASSWORD});
      const recoveryToken=randomBytes(32).toString('base64url');
      const recoveryHash=createHash('sha256').update(recoveryToken).digest('hex');
      await recoveryDb.connect();
      try {
        const ownerId=(await recoveryDb.query("UPDATE bizflow_foundation.owner_accounts SET recovery_verified_at=CURRENT_TIMESTAMP WHERE email='rehearsal@example.test' RETURNING id")).rows[0].id;
        await recoveryDb.query('INSERT INTO bizflow_foundation.owner_password_resets(owner_id,token_hash,expires_at) VALUES ($1,$2,CURRENT_TIMESTAMP+INTERVAL \'30 minutes\')',[ownerId,recoveryHash]);
      } finally { await recoveryDb.end(); }
      stagingPassword='m10-recovery-fixture-new-password';
      await cdp('Page.navigate',{url:url+'/staging/reset-password#'+recoveryToken});
      await until('Object.keys(document.querySelector("[name=confirmation]") ?? {}).some(key=>key.startsWith("__reactProps$"))');
      await set('New password',stagingPassword);await set('Confirm password',stagingPassword);
      await click('Reset password');
      await until('document.body.textContent.includes("Password changed")');
      assert.equal(await evaluate('location.hash'),'');
      const revoked=await fetch(url+'/spring/api/v1/auth/me',{headers:{Authorization:'Bearer '+token}});
      assert.equal(revoked.status,401);
      const replay=await fetch(url+'/spring/api/v1/auth/reset-password',{method:'POST',
        headers:{Origin:url,'Content-Type':'application/json'},
        body:JSON.stringify({token:recoveryToken,password:stagingPassword,confirmation:stagingPassword})});
      assert.equal(replay.status,400);
      console.log('Browser synthetic password reset consumed its token and revoked a prior bearer.');
      socket.close();
    console.log('Headless Chrome passed: staging sign in, chart render, session refresh on reload and sign out.');
    } finally { browser.kill(); }
    if(backend){
      const restartStarted=performance.now();
      const stopped=once(backend,'exit');
      backend.kill();
      await stopped;
      backend=launchSpring();
      let restarted=false;
      for(let i=0;i<75;i++){
        try {restarted=(await fetch(backendUrl+'/api/health/ready')).ok;}catch{}
        if(restarted)break;
        await wait(400);
      }
      assert.ok(restarted,'Spring did not restart');
      const afterRestart=await spring('auth/browser-login',{email:'rehearsal@example.test',password:stagingPassword}).then(r=>r.json());
      const saved=await spring('sales/'+acceptedSaleId,undefined,afterRestart.accessToken).then(r=>r.json());
      assert.equal(saved.sale.totalRwf,200000);
      assert.equal(saved.sale.refundedRwf,165000);
      assert.equal((await spring(shipmentPath+'/claims',undefined,afterRestart.accessToken).then(r=>r.json()))[0].claim.compensatedRwf,10);
      console.log(`Spring restart and verification took ${Math.round(performance.now()-restartStarted)} ms; sale, refund and compensation history persisted.`);
    }
  }
} finally {
  child.kill();
  backend?.kill();
  await wait(1500);
  for(const suffix of ['','-wal','-shm','-journal']) await rm(join(folder,'legacy.sqlite'+suffix),{force:true}).catch(()=>{});
}
