import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { migrations } from '../backend/database/business-schema.ts';

// This is a synthetic rehearsal. It does not accept a path to business data.
const actor = 'm8-owner';
const at = '2026-01-12T08:00:00Z';
const after = '2026-01-12T12:00:00Z';
const later = '2026-01-13T08:00:00Z';
const saleAt = '2026-01-13T10:00:00Z';
const returnAt = '2026-01-14T10:00:00Z';
const key = value => createHash('sha256').update(value).digest('hex');
const ids = {
  opening: 'd904a4ff-f831-4b05-8bd4-9c3340374f00', receipt: 'd904a4ff-f831-4b05-8bd4-9c3340374f01',
  sale: 'd904a4ff-f831-4b05-8bd4-9c3340374f02', returned: 'd904a4ff-f831-4b05-8bd4-9c3340374f03',
  count: 'd904a4ff-f831-4b05-8bd4-9c3340374f04',
};
const bcryptHash = '$2b$12$C5K7uDtsM.ovTogOEoh.ouUrtW3w50n3a3UFY5UbuGUwise98vdbe';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0a0AAAAASUVORK5CYII=', 'base64');

function seed(path) {
  const db = new DatabaseSync(path);
  function put(table, row) {
    const fields = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...Object.values(row));
  }
  try {
    db.exec('PRAGMA foreign_keys=ON');
    for(const migration of migrations) {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version=${migration.version}`);
    }
    put('users',{ id:actor,name:'Rehearsal owner',email:'rehearsal@example.test',password_hash:bcryptHash,role:'admin',created_at:at });
    put('product_families',{ id:'rings',name:'Rings' });
    put('products',{ id:'ring',sku:'RING-7',name:'Silver ring',category:'Jewelry',purchase_price:100,selling_price:300,
      quantity:3,minimum_quantity:1,supplier:'Fixture supplier',created_at:at,stock_value:315,family_id:'rings',variant_size:'7' });
    put('product_images',{ product_id:'ring',content_type:'image/png',contents:png });
    for(const [id,kind,name] of [['vendor','Supplier','Fixture supplier'],['agent','Agent','Courier'],['buyer','Customer','Fixture customer']]) {
      put('contacts',{ id,kind,name,phone:'',email:'',location:'' });
    }
    put('purchases',{ id:'purchase',supplier_name:'Fixture supplier',total_amount:400,purchase_date:at,created_at:at,actor_id:actor,
      currency:'RWF',supplier_id:'vendor',invoice_reference:'INV-1' });
    put('purchase_items',{ id:'purchase-line',purchase_id:'purchase',product_id:'ring',quantity:4,unit_cost:100,subtotal:400,original_unit_minor:100 });
    put('shipments',{ id:'shipment',reference:'TRACK-1',agent:'Courier',status:'Received',created_at:at,actor_id:actor });
    put('shipment_manifests',{ shipment_id:'shipment',origin:'Origin',destination:'Kigali',expected_date:after,notes:'Fixture',expected_expenses:40,allocation:'quantity' });
    put('shipment_manifest_lines',{ shipment_id:'shipment',purchase_item_id:'purchase-line',expected:4 });
    put('shipment_expenses',{ shipment_id:'shipment',kind:'shipping',amount:40 });
    put('sales',{ id:'sale',customer_name:'Fixture customer',total_amount:600,payment_method:'Cash',sale_date:saleAt,created_at:saleAt,actor_id:actor,
      channel:'Online',customer_id:'buyer',request_key:'sale-key' });
    put('sale_items',{ id:'sale-line',sale_id:'sale',product_id:'ring',quantity:2,selling_price:300,subtotal:600,cost:210 });
    put('online_orders',{ id:'order',customer_name:'Fixture customer',contact:'Fixture number',source:'Online',status:'Confirmed',
      delivery_status:'Delivered',sale_id:'sale',actor_id:actor,created_at:later,customer_id:'buyer' });
    put('online_order_items',{ order_id:'order',product_id:'ring',quantity:2,price:300 });
    const movement=(id,type,quantity,remaining_stock,movement_date,reason,purchase_item_id=null,sale_item_id=null)=>
      put('stock_movements',{ id,product_id:'ring',product_name:'Silver ring',type,quantity,remaining_stock,movement_date,reason,
        actor_id:actor,purchase_item_id,sale_item_id });
    movement(ids.opening,'Stock In',2,2,at,'Opening');
    movement(ids.receipt,'Stock In',2,4,after,'Shipment','purchase-line');
    movement(ids.sale,'Stock Out',2,2,saleAt,'Completed sale',null,'sale-line');
    movement(ids.returned,'Stock In',1,3,returnAt,'Returned',null,'sale-line');
    put('stock_counts',{ id:ids.count,product_id:'ring',expected:3,counted:3,reason:'Checked',actor_id:actor,recorded_at:returnAt });
    put('shipment_receiving_events',{ id:'receipt',shipment_id:'shipment',reference:'RCPT-1',payload:'{}',recorded_at:after,actor_id:actor });
    put('shipment_receiving_lines',{ event_id:'receipt',shipment_id:'shipment',purchase_item_id:'purchase-line',usable:2,damaged:1,missing:1,
      explanation:'Inspected',supplier_cost:200,damaged_supplier_cost:100,allocated_expense:40,capitalized_expense:20,movement_id:ids.receipt });
    put('shipment_claims',{id:'claim',event_id:'receipt',purchase_item_id:'purchase-line',kind:'damage',reference:'CLAIM-1',claimant:'Fixture supplier',
      notes:'Damage acknowledged',currency:'RWF',claimed:35,rate_micros:1000000,claimed_rwf:35,accepted_rwf:25,
      actor_id:actor,created_at:later,decision_actor:actor,decided_at:returnAt});
    put('shipment_resolutions',{id:'credit',event_id:'receipt',purchase_item_id:'purchase-line',kind:'damage',action:'credit',reference:'CREDIT-1',
      notes:'Applied to purchase',amount:25,quantity:0,payable_minor:25,claim_id:'claim',actor_id:actor,recorded_at:returnAt});
    put('payments',{ id:'payment',sale_id:'sale',reference_number:'PAY-1',amount:400,method:'Cash',status:'Paid',payment_date:saleAt,actor_id:actor });
    put('sale_returns',{ id:'return',sale_item_id:'sale-line',quantity:1,reason:'Usable',recorded_at:returnAt,revenue_credit:300,cost_credit:105,
      refund:100,refund_account:'Cash',movement_id:ids.returned,actor_id:actor,reference:'RETURN-1' });
    const money=(id,kind,amount,from_account,to_account, extras={})=>put('money_transactions',{
      id,kind,amount,from_account,to_account,reference:`ref-${id}`,actor_id:actor,recorded_at:saleAt,...extras });
    money('opening-cash','opening',800,null,'Cash');
    money('customer-cash','customer_payment',400,null,'Cash',{payment_id:'payment'});
    money('supplier-cash','supplier_payment',100,'Cash',null,{purchase_id:'purchase',payable_amount:100,payable_minor:100});
    money('shipping-cash','expense',30,'Cash',null,{shipment_id:'shipment',category:'shipping'});
    money('rent','expense',50,'Cash',null,{category:'Rent'});
    money('transfer','transfer',120,'Cash','Bank Transfer');
    put('accounts',{id:'usd-fixture',name:'Dollar reserve',kind:'Bank Transfer',currency:'USD'});
    put('accounts',{id:'cny-fixture',name:'Yuan reserve',kind:'Bank Transfer',currency:'CNY'});
    money('opening-usd','opening',1500,null,'usd-fixture',{destination_minor:1000,settlement_currency:'USD',settlement_rate:150000000});
    money('exchange','transfer',300,'usd-fixture','cny-fixture',{source_minor:200,destination_minor:1400,settlement_currency:'USD',
      settlement_rate:150000000,exchange_fee_minor:25,exchange_fee_rwf:38});
    put('money_reversals',{ id:'reversal',transaction_id:'transfer',reason:'Reversed',actor_id:actor,recorded_at:returnAt });
    put('audit_log',{ id:'legacy-audit',actor_id:actor,action:'sale.completed',entity_id:'sale',recorded_at:saleAt });
    db.exec("UPDATE business_settings SET receipt_footer='Synthetic fixture' WHERE id=1");
    if(db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Synthetic SQLite fixture has broken links.');
  } finally { db.close(); }
}

const cashKind = new Map([['Cash','CASH'],['Bank Transfer','BANK'],['Mobile Money','MOBILE_MONEY']]);
const kigaliDate = instant => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kigali',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));

async function rehearse(db, dest, keepFixture) {
  const query = (sql, values=[]) => dest.query(sql,values);
  const rows = table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const put = async (table,row) => {
    const fields=Object.keys(row);
    await query(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
  };
  const now = (await query('SELECT current_database() AS name')).rows[0].name;
  if(!/^bizflow_foundation_test_[a-z0-9]+$/.test(now)) throw new Error('Use an empty disposable test database.');
  const checked=[];
  const mismatches=[];
  const measures={};
  const check = async (metric, source, sql) => {
    const destination=(await query(sql)).rows[0].value;
    checked.push(metric);
    measures[metric]={source,destination};
    if(JSON.stringify(destination)!==JSON.stringify(source)) mismatches.push({metric,source,destination});
  };
  await query('BEGIN');
  try {
    await query('SET LOCAL search_path TO bizflow_foundation,pg_catalog');
    if((await query("SELECT EXISTS(SELECT 1 FROM owner_accounts UNION ALL SELECT 1 FROM catalog_products UNION ALL SELECT 1 FROM financial_postings) AS occupied")).rows[0].occupied) {
      throw new Error('Destination must have Flyway migrations and no business records.');
    }
    for(const u of rows('users')) await put('owner_accounts',{ id:u.id,email:u.email,display_name:u.name,password_hash:u.password_hash,created_at:u.created_at });
    for(const f of rows('product_families')) await put('catalog_families',{id:f.id,name:f.name,created_at:at});
    for(const p of rows('products')) await put('catalog_products',{id:p.id,sku:p.sku,name:p.name,category:p.category,family_id:p.family_id,
      variant_size:p.variant_size,variant_color:p.variant_color,variant_material:p.variant_material,variant_design:p.variant_design,
      selling_price:p.selling_price,estimated_unit_cost:p.purchase_price,reorder_threshold:p.minimum_quantity,created_at:p.created_at});
    for(const image of rows('product_images')) await put('catalog_images',{ ...image,contents:Buffer.from(image.contents) });
    for(const c of rows('contacts')) {
      const {id,name,phone,email}=c;
      if(c.kind==='Customer') await put('customers',{id,name,phone,email,actor_id:actor});
      else await put('procurement_contacts',{id,name,phone,email,location:c.location,kind:c.kind.toUpperCase(),actor_id:actor});
    }
    for(const p of rows('purchases')) await put('procurement_orders',{id:p.id,supplier_id:p.supplier_id,supplier_name:p.supplier_name,
      reference:p.invoice_reference,invoice_reference:p.invoice_reference,purchase_date:kigaliDate(p.purchase_date),currency:p.currency,
      rate_micros:p.rate_micros,total_rwf:p.total_amount,actor_id:p.actor_id,created_at:p.created_at});
    for(const p of rows('purchase_items')) await put('procurement_lines',{id:p.id,order_id:p.purchase_id,product_id:p.product_id,
      ordered:p.quantity,unit_minor:p.original_unit_minor,subtotal_rwf:p.subtotal});
    for(const p of rows('shipments')) await put('procurement_shipments',{id:p.id,tracking:p.reference,agent_id:'agent',agent_name:p.agent,
      planned_date:kigaliDate(p.created_at),status:p.status.toUpperCase(),allocation:'QUANTITY',actor_id:p.actor_id,created_at:p.created_at});
    for(const p of rows('shipment_manifest_lines')) await put('procurement_manifest_lines',{shipment_id:p.shipment_id,line_id:p.purchase_item_id,planned:p.expected});
    for(const p of rows('shipment_expenses')) await put('procurement_charges',{shipment_id:p.shipment_id,kind:p.kind.toUpperCase(),amount_rwf:p.amount});
    for(const p of rows('products')) await put('inventory_balances',{product_id:p.id,quantity:p.quantity,value_rwf:p.stock_value,version:4});
    // The synthetic event evidence supplies the opening value. Legacy movement rows alone do not contain historical value deltas.
    const valueDeltas=[200,220,-210,105];
    let beforeValue=0;
    for(const [index,m] of rows('stock_movements').entries()) {
      const delta=m.type==='Stock In'?m.quantity:-m.quantity;
      const value=valueDeltas[index];
      await put('inventory_movements',{id:m.id,product_id:m.product_id,kind:['OPENING','PURCHASE_RECEIPT','SALE','SALE_RETURN'][index],
        reference:m.id,reason:m.reason,actor_id:m.actor_id,delta,before_quantity:m.remaining_stock-delta,after_quantity:m.remaining_stock,
        value_delta_rwf:value,before_value_rwf:beforeValue,after_value_rwf:beforeValue+value,balance_version:index+1,recorded_at:m.movement_date});
      beforeValue+=value;
    }
    for(const c of rows('stock_counts')) await put('inventory_counts',{id:c.id,product_id:c.product_id,reference:c.id,expected_quantity:c.expected,
      observed_quantity:c.counted,expected_version:4,reason:c.reason,counted_by:c.actor_id,counted_at:c.recorded_at,
      confirmed_by:c.actor_id,confirmed_at:c.recorded_at});
    for(const r of rows('shipment_receiving_events')) await put('procurement_receipts',{id:r.id,shipment_id:r.shipment_id,
      reference:r.reference,receipt_date:kigaliDate(r.recorded_at),request_hash:key(r.payload),actor_id:r.actor_id,recorded_at:r.recorded_at});
    for(const r of rows('shipment_receiving_lines')) await put('procurement_receipt_lines',{receipt_id:r.event_id,shipment_id:r.shipment_id,line_id:r.purchase_item_id,
      usable:r.usable,damaged:r.damaged,missing:r.missing,explanation:r.explanation,usable_cost_rwf:r.supplier_cost,damage_cost_rwf:r.damaged_supplier_cost,
      allocated_rwf:r.allocated_expense,capitalized_rwf:r.capitalized_expense,movement_id:r.movement_id});
    for(const s of rows('sales')) await put('retail_sales',{id:s.id,reference:s.request_key,request_hash:key(s.request_key),customer_id:s.customer_id,
      customer_name:s.customer_name,sale_date:kigaliDate(s.sale_date),channel:s.channel,gross_rwf:s.total_amount,discount_rwf:0,total_rwf:s.total_amount,
      actor_id:s.actor_id,created_at:s.created_at});
    for(const i of rows('sale_items')) await put('sale_items',{id:i.id,sale_id:i.sale_id,product_id:i.product_id,product_name:'Silver ring',
      sku:'RING-7',quantity:i.quantity,unit_price_rwf:i.selling_price,unit_discount_rwf:0,revenue_rwf:i.subtotal,cost_rwf:i.cost,
      movement_id:ids.sale,created_at:saleAt,category_snapshot:'Jewelry'});
    for(const o of rows('online_orders')) await put('online_orders',{id:o.id,reference:o.id,customer_id:o.customer_id,customer_name:o.customer_name,
      contact:o.contact,source:o.source,status:o.status.toUpperCase(),fulfillment:o.delivery_status.toUpperCase(),sale_id:o.sale_id,
      confirmation_hash:key(o.id),actor_id:o.actor_id,created_at:o.created_at});
    for(const i of rows('online_order_items')) await put('online_order_items',{order_id:i.order_id,product_id:i.product_id,product_name:'Silver ring',quantity:i.quantity,quote_rwf:i.price});
    for(const a of rows('accounts')) await put('financial_accounts',{id:a.id,name:a.name,kind:cashKind.get(a.kind),currency:a.currency,active:!!a.active,actor_id:actor});
    const kinds={opening:'OPENING',customer_payment:'CUSTOMER_PAYMENT',supplier_payment:'SUPPLIER_PAYMENT',expense:'OPERATING_EXPENSE',transfer:'TRANSFER'};
    for(const p of rows('money_transactions')) {
      await put('financial_postings',{id:p.id,reference:p.reference,kind:p.shipment_id?'SHIPMENT_PAYMENT':kinds[p.kind],
        from_account:p.from_account,to_account:p.to_account,amount_rwf:p.amount,actor_id:p.actor_id,recorded_at:p.recorded_at,
        ...nativeTerms(p,rows('accounts'))});
      if(p.purchase_id) await put('supplier_payment_allocations',{posting_id:p.id,purchase_id:p.purchase_id,cash_rwf:p.amount,
        released_rwf:p.payable_amount,payable_minor:p.payable_minor});
      if(p.shipment_id) await put('shipment_payment_allocations',{posting_id:p.id,shipment_id:p.shipment_id,charge_kind:p.category.toUpperCase()});
      if(p.kind==='expense'&&!p.shipment_id) await put('operating_expenses',{posting_id:p.id,category_id:'rent',category_name:p.category,
        description:'',payee:'',receipt_reference:'',related_reference:''});
    }
    for(const p of rows('payments')) await put('sale_payments',{id:p.id,sale_id:p.sale_id,reference:p.reference_number,
      method:cashKind.get(p.method),posting_id:rows('money_transactions').find(entry=>entry.payment_id===p.id).id});
    for(const r of rows('sale_returns')) {
      const posting=r.id+'-refund';
      await put('financial_postings',{id:posting,reference:posting,kind:'CUSTOMER_REFUND',from_account:r.refund_account,amount_rwf:r.refund,
        actor_id:r.actor_id,recorded_at:r.recorded_at});
      await put('sale_returns',{id:r.id,sale_id:'sale',item_id:r.sale_item_id,reference:r.reference,request_hash:key(r.reference),
        quantity:r.quantity,reason:r.reason,condition:'USABLE',revenue_credit_rwf:r.revenue_credit,restored_cost_rwf:r.cost_credit,
        refund_posting_id:posting,movement_id:r.movement_id,actor_id:r.actor_id,recorded_at:r.recorded_at});
    }
    for(const r of rows('money_reversals')) {
      const original=rows('money_transactions').find(post=>post.id===r.transaction_id);
      await put('financial_postings',{id:r.id,reference:r.id,kind:'REVERSAL',from_account:original.to_account,to_account:original.from_account,
        amount_rwf:original.amount,reverses_id:original.id,reason:r.reason,actor_id:r.actor_id,recorded_at:r.recorded_at});
    }
    for(const c of rows('shipment_claims')) {
      if(c.currency!=='RWF')throw new Error('Claim currency lacks a verified target mapping.');
      await put('discrepancy_claims',{id:c.id,receipt_id:c.event_id,line_id:c.purchase_item_id,kind:c.kind.toUpperCase(),reference:c.reference,
        claimant:c.claimant,notes:c.notes,claimed_rwf:c.claimed_rwf,accepted_rwf:c.accepted_rwf,actor_id:c.actor_id,recorded_at:c.created_at,
        decided_by:c.decision_actor,decided_at:c.decided_at});
    }
    for(const r of rows('shipment_resolutions')) {
      if(r.action!=='credit'||r.quantity!==0||r.movement_id||r.reverses_id)throw new Error('Unsupported synthetic discrepancy disposition.');
      await put('discrepancy_resolutions',{id:r.id,receipt_id:r.event_id,line_id:r.purchase_item_id,kind:r.kind.toUpperCase(),
        action:'CREDIT',reference:r.reference,claim_id:r.claim_id,amount_rwf:r.amount,payable_minor:r.payable_minor,
        business_date:kigaliDate(r.recorded_at),notes:r.notes,actor_id:r.actor_id,recorded_at:r.recorded_at});
    }
    for(const a of rows('audit_log')) await put('legacy_audit_events',{source_id:a.id,actor_id:a.actor_id,action:a.action,
      entity_id:a.entity_id,recorded_at:a.recorded_at});
    const profile=rows('business_settings')[0];
    await query('UPDATE business_profile SET name=$1,address=$2,phone=$3,receipt_footer=$4,updated_by=$5 WHERE singleton',
      [profile.name,profile.address,profile.phone,profile.receipt_footer,actor]);
    await query('CREATE TEMP TABLE rehearsal_evidence(kind text,id text,payload jsonb) ON COMMIT DROP');
    for(const table of ['audit_log','business_settings','shipment_manifests']) for(const row of rows(table)) {
      await put('rehearsal_evidence',{kind:table,id:String(row.id??row.shipment_id),payload:JSON.stringify(row)});
    }
    for(const [source,target] of Object.entries({users:'owner_accounts',products:'catalog_products',product_families:'catalog_families',
      product_images:'catalog_images',purchases:'procurement_orders',purchase_items:'procurement_lines',stock_movements:'inventory_movements',
      stock_counts:'inventory_counts',shipments:'procurement_shipments',shipment_manifest_lines:'procurement_manifest_lines',
      shipment_expenses:'procurement_charges',shipment_receiving_events:'procurement_receipts',shipment_receiving_lines:'procurement_receipt_lines',
      sales:'retail_sales',sale_items:'sale_items',payments:'sale_payments',sale_returns:'sale_returns',online_orders:'online_orders',
      online_order_items:'online_order_items',accounts:'financial_accounts',shipment_claims:'discrepancy_claims',
      shipment_resolutions:'discrepancy_resolutions',audit_log:'legacy_audit_events'})) await check(source,rows(source).length,`SELECT count(*)::int AS value FROM ${target}`);
    await check('owner identity',[actor,'rehearsal@example.test'],'SELECT json_build_array(id,email) AS value FROM owner_accounts');
    await check('no sessions',0,'SELECT count(*)::int AS value FROM owner_sessions');
    await check('stock per SKU',['RING-7','rings',3,315],`SELECT json_build_array(p.sku,p.family_id,b.quantity,b.value_rwf) AS value
      FROM catalog_products p JOIN inventory_balances b ON b.product_id=p.id`);
    await check('receipt measures',[2,1,1,40,20],`SELECT json_build_array(usable,damaged,missing,allocated_rwf,capitalized_rwf) AS value FROM procurement_receipt_lines`);
    await check('supplier payable after credit',275,'SELECT outstanding_rwf::int AS value FROM supplier_obligations');
    await check('sale net, COGS, refunds and receivable',[300,105,100,0],`SELECT json_build_array(total_rwf-credit_rwf,cost_rwf-restored_rwf,refunded_rwf,outstanding_rwf) AS value FROM sale_balances`);
    await check('Cash balance',920,"SELECT balance_minor::int AS value FROM financial_account_balances WHERE id='Cash'");
    await check('Bank balance',0,"SELECT balance_minor::int AS value FROM financial_account_balances WHERE id='Bank Transfer'");
    await check('posting IDs and reversal',10,'SELECT count(*)::int AS value FROM financial_postings');
    await check('native USD closing',775,"SELECT balance_minor::int AS value FROM financial_account_balances WHERE id='usd-fixture'");
    await check('native CNY closing',1400,"SELECT balance_minor::int AS value FROM financial_account_balances WHERE id='cny-fixture'");
    await check('exchange native terms',[200,1400,25,38,7000000],"SELECT json_build_array(source_minor,destination_minor,fee_minor,fee_rwf,exchange_rate_micros) AS value FROM financial_postings WHERE id='exchange'");
    await check('original audit reference','sale',"SELECT entity_id AS value FROM legacy_audit_events WHERE source_id='legacy-audit'");
    await check('settings footer','Synthetic fixture','SELECT receipt_footer AS value FROM business_profile WHERE singleton');
    await check('supplier credit link',[25,'claim'],"SELECT json_build_array(amount_rwf,claim_id) AS value FROM discrepancy_resolutions WHERE id='credit'");
    await check('movement history and balance',[3,315],'SELECT json_build_array(sum(delta),sum(value_delta_rwf)) AS value FROM inventory_movements');
    // Keep the fixture balance consistent with the independent movement evidence.
    await check('source vs movement value',rows('products')[0].stock_value,'SELECT sum(value_delta_rwf)::int AS value FROM inventory_movements');
    await query(keepFixture&&mismatches.length===0?'COMMIT':'ROLLBACK');
  } catch(error) {
    await query('ROLLBACK');
    throw error;
  }
  return {source:'synthetic SQLite',destination:now,retainedForRestore:keepFixture&&mismatches.length===0,checks:checked,measures,discrepancies:mismatches};
}

function nativeTerms(transaction,accounts){
  const source=accounts.find(a=>a.id===transaction.from_account);
  const target=accounts.find(a=>a.id===transaction.to_account);
  const different=source&&target&&source.currency!==target.currency;
  if(!different&&!transaction.source_minor&&!transaction.destination_minor)return {};
  const terms={source_minor:transaction.source_minor,destination_minor:transaction.destination_minor,
    source_currency:transaction.source_minor?source?.currency:null,destination_currency:transaction.destination_minor?target?.currency:null,
    rwf_rate_micros:transaction.settlement_rate,fee_minor:transaction.exchange_fee_minor,fee_rwf:transaction.exchange_fee_rwf};
  if(different){
    const scale=c=>c==='RWF'?1n:100n;
    const numerator=BigInt(transaction.destination_minor)*scale(source.currency)*1000000n;
    const denominator=BigInt(transaction.source_minor)*scale(target.currency);
    if(numerator%denominator!==0n)throw new Error('The currency exchange needs an independently captured rate.');
    terms.exchange_rate_micros=Number(numerator/denominator);
    terms.kind='EXCHANGE';
  }
  return terms;
}

const database = process.env.BIZFLOW_FOUNDATION_DATABASE ?? '';
const jdbc = process.env.BIZFLOW_FOUNDATION_JDBC_URL ?? '';
if(!/^bizflow_foundation_test_[a-z0-9]+$/.test(database)||!/^jdbc:postgresql:\/\/127\.0\.0\.1:\d+\//.test(jdbc)) {
  throw new Error('Set a loopback disposable BIZFLOW_FOUNDATION_TEST database connection.');
}
const location = new URL(jdbc.slice(5));
if(location.pathname!==`/${database}`) throw new Error('The database name and JDBC URL must match.');
const folder=await mkdtemp(join(tmpdir(),'bizflow-m8-fixture-'));
const path=join(folder,'synthetic.sqlite');
const dest=new pg.Client({host:location.hostname,port:Number(location.port),database,
  user:process.env.BIZFLOW_FOUNDATION_DB_USER,password:process.env.BIZFLOW_FOUNDATION_DB_PASSWORD});
let source;
try {
  seed(path);
  source=new DatabaseSync(path,{readOnly:true});
  await dest.connect();
  const result=await rehearse(source,dest,process.argv.includes('--retain-disposable-fixture'));
  console.log(JSON.stringify(result,null,2));
  if(result.discrepancies.length) process.exitCode=1;
} finally {
  source?.close();
  await dest.end();
  await rm(path,{force:true});
  await rm(folder,{force:true,recursive:true});
}
