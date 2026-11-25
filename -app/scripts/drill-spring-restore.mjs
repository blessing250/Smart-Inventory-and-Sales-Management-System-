import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';

const source=process.env.BIZFLOW_FOUNDATION_DATABASE??'';
const target=process.env.BIZFLOW_RESTORE_DATABASE??'';
const jdbc=process.env.BIZFLOW_FOUNDATION_JDBC_URL??'';
if(![source,target].every(name=>/^bizflow_foundation_test_[a-z0-9]+$/.test(name))||source===target||
   !/^jdbc:postgresql:\/\/127\.0\.0\.1:\d+\//.test(jdbc))throw Error('Choose two different loopback disposable test databases.');
const location=new URL(jdbc.slice(5));
assert.equal(location.pathname,'/'+source);
const user=process.env.BIZFLOW_FOUNDATION_DB_USER;
const password=process.env.BIZFLOW_FOUNDATION_DB_PASSWORD;
const bins=process.env.BIZFLOW_PG_BIN;
const pgOptions={host:location.hostname,port:Number(location.port),user,password};
const args=['-h',location.hostname,'-p',location.port,'-U',user,'-w'];
const key=randomBytes(32);
const nonce=randomBytes(12);
const header=Buffer.from('BIZFLOW-RESTORE-v1');

function decrypt(data){
  assert.ok(data.subarray(0,header.length).equals(header),'Invalid backup header');
  const start=header.length;
  const reader=createDecipheriv('aes-256-gcm',key,data.subarray(start,start+12));
  reader.setAAD(header);
  reader.setAuthTag(data.subarray(start+12,start+28));
  return Buffer.concat([reader.update(data.subarray(start+28)),reader.final()]);
}

function command(program,flags,input){
  const exe=bins?join(bins,program+(process.platform==='win32'?'.exe':'')):program;
  const run=spawnSync(exe,flags,{input,maxBuffer:64*1024*1024,windowsHide:true,
    env:{...process.env,PGPASSWORD:password}});
  if(run.error||run.status!==0)throw Error(program+' failed for the disposable database.');
  return run.stdout;
}

async function read(database,run){
  const connection=new pg.Client({...pgOptions,database});
  await connection.connect();
  try{return await run(connection);}
  finally{await connection.end();}
}

async function snapshot(database){
  return await read(database,async connection=>{
    const response=await connection.query(`
      SELECT
        (SELECT jsonb_agg(jsonb_build_array(sku,quantity,value_rwf,version) ORDER BY sku)
          FROM bizflow_foundation.inventory_balances b JOIN bizflow_foundation.catalog_products p ON p.id=b.product_id) AS inventory,
        (SELECT jsonb_agg(jsonb_build_array(id,currency,balance_minor) ORDER BY id)
          FROM bizflow_foundation.financial_account_balances) AS accounts,
        (SELECT jsonb_agg(jsonb_build_array(id,reference,kind,amount_rwf) ORDER BY id)
          FROM bizflow_foundation.financial_postings) AS postings,
        (SELECT jsonb_agg(jsonb_build_array(id,total_rwf,cost_rwf,outstanding_rwf) ORDER BY id)
          FROM bizflow_foundation.sale_balances) AS sales,
        (SELECT count(*) FROM bizflow_foundation.owner_accounts) AS owners,
        (SELECT count(*) FROM bizflow_foundation.owner_sessions) AS sessions,
        (SELECT count(*) FROM bizflow_foundation.owner_password_resets) AS reset_tokens
    `);
    return response.rows[0];
  });
}

const folder=await mkdtemp(join(tmpdir(),'bizflow-restore-fixture-'));
const file=join(folder,'synthetic.pgdump.enc');
try{
  const empty=await read(target,connection=>connection.query("SELECT to_regnamespace('bizflow_foundation') IS NULL AS empty"));
  assert.equal(empty.rows[0].empty,true,'Restore target must be empty');
  const expected=await snapshot(source);
  assert.ok(expected.inventory?.length&&expected.postings?.length);
  const backupStarted=performance.now();
  const dump=command('pg_dump',[...args,'-d',source,'--format=custom','--no-owner','--no-privileges',
    '--exclude-table-data=bizflow_foundation.owner_sessions','--exclude-table-data=bizflow_foundation.owner_password_resets']);
  const writer=createCipheriv('aes-256-gcm',key,nonce);
  writer.setAAD(header);
  const payload=Buffer.concat([writer.update(dump),writer.final()]);
  await writeFile(file,Buffer.concat([header,nonce,writer.getAuthTag(),payload]),{flag:'wx',mode:0o600});
  const encrypted=await readFile(file);
  const localBackupMs=Math.round(performance.now()-backupStarted);
  const corrupt=Buffer.from(encrypted);
  corrupt[corrupt.length-1]^=1;
  assert.throws(()=>decrypt(corrupt));
  const restoreStarted=performance.now();
  command('pg_restore',[...args,'-d',target,'--no-owner','--no-privileges','--exit-on-error','--single-transaction'],decrypt(encrypted));
  const restored=await snapshot(target);
  assert.deepEqual(restored,{...expected,sessions:'0',reset_tokens:'0'});
  console.log(JSON.stringify({check:'local encrypted synthetic restore',status:'PASS',encryption:'AES-256-GCM',
    tamperRejected:true,localBackupMs,localRestoreAndReconcileMs:Math.round(performance.now()-restoreStarted),archiveBytes:encrypted.length,
    accounts:restored.accounts,inventory:restored.inventory,postings:restored.postings.length}));
}finally{
  key.fill(0);
  await rm(file,{force:true});
  await rm(folder,{recursive:true,force:true});
}
