import {test} from 'node:test';
import {withVerifiedFactor} from './optional-mfa.mjs';
import assert from 'node:assert/strict';
import {database,asUser,ids} from './database.mjs';

async function rpc(db,name,args){return (await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})) as result`,args)).rows[0].result;}
const FP='a'.repeat(64),NEW_FP='b'.repeat(64);
const payload={type:'Meeting held',context:'Test company',outcome:'Follow-up agreed',note:'',occurred_on:'2026-11-24'};
const providerRows=[
 {source:'justcall',kind:'call',external_id:'call1',external_owner_id:'14',title:'Mapped call',notes:'First notes'},
 {source:'justcall',kind:'call',external_id:'call2',external_owner_id:'15',title:'Unmapped call'},
];
test('PostgreSQL Sales policies, durable sync and failure workflows',async t=>{
 const db=await database();t.after(()=>db.close());let own,report,token;
 await t.test('manual accountability is owner-scoped, versioned and idempotent',async()=>{
  own=await asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,payload,'same-request']));assert.equal(own.owner_id,ids.sales);
  const retry=await asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,payload,'same-request']));assert.equal(retry.id,own.id);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,{...payload,outcome:'Different content'},'same-request'])),e=>e.code==='40001');
  await asUser(db,ids.founder,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,{...payload,context:'Founder private'},'founder-request']));
  assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_sales_activities'))).rows.length,1);
  assert.equal((await asUser(db,ids.artist,()=>db.query('select id from nam_sales_activities'))).rows.length,0);
  assert.equal((await asUser(db,ids.outsider,()=>db.query('select id from nam_sales_activities'))).rows.length,0);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.otherW,null,null,payload,'cross-workspace'])),e=>e.code==='42501');
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,{...payload,owner_id:ids.founder},'forged-owner'])),e=>e.code==='P0001');
  const edited=await asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,own.id,1,{note:'Updated'},null]));assert.equal(edited.version,2);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,own.id,1,{note:'Stale'},null])),e=>e.code==='40001');
  const counts=await asUser(db,ids.sales,()=>rpc(db,'nam_sales_activity_counts',[ids.w]));assert.equal(counts.total,1);assert.equal(counts.by_month[0].n,1);
  report=await asUser(db,ids.sales,()=>rpc(db,'nam_submit_sales_report',[ids.w,{week_start:'2026-11-23',outcomes:'Results',blockers:'',next_week:'Priorities'}]));
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_review_sales_report',[ids.w,report.id])),e=>e.code==='42501');
  await asUser(db,ids.founder,()=>rpc(db,'nam_review_sales_report',[ids.w,report.id]));
  const revised=await asUser(db,ids.sales,()=>rpc(db,'nam_submit_sales_report',[ids.w,{week_start:'2026-11-23',outcomes:'Revised',blockers:'',next_week:'New priorities'}]));assert.equal(revised.reviewed_at,null);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_set_sales_target',[ids.w,{owner_id:ids.sales,metric:'Meetings held',period:'2026-11',target:5}])),e=>e.code==='42501');
  await asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{owner_id:ids.sales,metric:'Meetings held',period:'2026-11',target:5}]));
  await assert.rejects(asUser(db,ids.sales,()=>db.query("update nam_sales_activities set outcome='Direct update'")),e=>e.code==='42501');
 });
 await t.test('provider snapshots require founder assurance and durable matching leases',async()=>{
  await withVerifiedFactor(db,ids.founder,()=>assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',FP]),{aal:'aal1'}),e=>e.code==='42501'));
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',FP])),e=>e.code==='42501');
  token=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',FP]));
  await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',FP])),e=>e.code==='55000');
  await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall','99999999-9999-4999-8999-999999999999',providerRows,{},[]])),e=>e.code==='55000');
  await asUser(db,ids.founder,()=>rpc(db,'nam_renew_integration_lease',[ids.w,'justcall',token]));
  const count=await asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall',token,[...providerRows,providerRows[0]],{period:'Last 30 days'},[]]));assert.equal(count,2);
  await assert.rejects(asUser(db,ids.sales,()=>db.query('select lease_token from nam_integration_state')),e=>e.code==='42501');
  await assert.rejects(asUser(db,ids.sales,()=>db.query('select credential_fingerprint from nam_integration_records')),e=>e.code==='42501');
 });
 await t.test('explicit provider ownership and aggregate pagination respect database policies',async()=>{
  assert.equal((await asUser(db,ids.sales,()=>db.query('select payload from nam_integration_records'))).rows.length,0);
  await asUser(db,ids.founder,()=>rpc(db,'nam_map_integration_owner',[ids.w,'justcall','14',ids.sales]));
  const visible=await asUser(db,ids.sales,()=>db.query('select payload from nam_integration_records'));assert.equal(visible.rows.length,1);assert.equal(visible.rows[0].payload.external_id,'call1');
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_map_integration_owner',[ids.w,'justcall','15',ids.sales])),e=>e.code==='42501');
  assert.equal((await asUser(db,ids.artist,()=>db.query('select payload from nam_integration_records'))).rows.length,0);
  assert.equal((await asUser(db,ids.outsider,()=>db.query('select payload from nam_integration_records'))).rows.length,0);
  const page=await asUser(db,ids.founder,()=>rpc(db,'nam_connected_sales_data',[ids.w,{justcall:FP},1,0,{}]));assert.equal(page.records_total,2);assert.equal(page.records.length,1);assert.equal(page.counts[0].n,2);
  const ownPage=await asUser(db,ids.sales,()=>rpc(db,'nam_connected_sales_data',[ids.w,{justcall:FP},20,0,{}]));assert.equal(ownPage.records_total,1);assert.equal(ownPage.external_owners.length,0);
  const filtered=await asUser(db,ids.founder,()=>rpc(db,'nam_connected_sales_data',[ids.w,{justcall:FP},20,0,{q:'Mapped call'}]));assert.equal(filtered.records_total,2); // "Unmapped call" also contains the search text.
  const attacker=await asUser(db,ids.outsider,()=>db.query('select payload from nam_integration_records where workspace_id=$1',[ids.w]));assert.equal(attacker.rows.length,0);
 });
 await t.test('failed and expired jobs retain the previous snapshot and cannot overwrite a successor',async()=>{
  token=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',FP]));
  await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall',token,null,{},[]])),e=>e.code==='P0001');
  await asUser(db,ids.founder,()=>rpc(db,'nam_fail_integration_sync',[ids.w,'justcall',token,'unavailable','Provider unavailable',null]));
  const state=await asUser(db,ids.founder,()=>rpc(db,'nam_integration_connection_state',[ids.w,{justcall:FP}]));assert.equal(state[0].status,'error');assert(state[0].last_success_at);assert(state[0].snapshot_current);
  assert.equal((await asUser(db,ids.sales,()=>db.query('select payload from nam_integration_records'))).rows.length,1);
  token=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',FP]));await db.query("update nam_integration_state set lease_until=now()-interval '1 second' where workspace_id=$1 and source='justcall'",[ids.w]);
  const successor=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',FP]));assert.notEqual(token,successor);
  await asUser(db,ids.founder,()=>rpc(db,'nam_fail_integration_sync',[ids.w,'justcall',token,'sync_failed','Late old job',null]));
  await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall',token,[],{},[]])),e=>e.code==='55000');
  await asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall',successor,providerRows,{},[]]));
 });
 await t.test('credential changes revoke old grants and separate currency/stage pipeline totals',async()=>{
  token=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',NEW_FP]));assert.equal((await asUser(db,ids.sales,()=>db.query('select payload from nam_integration_records'))).rows.length,0);
  assert.equal((await asUser(db,ids.founder,()=>db.query('select member_id from nam_integration_owner_map'))).rows.length,0);
  await asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall',token,providerRows,{},[]]));assert.equal((await asUser(db,ids.sales,()=>db.query('select payload from nam_integration_records'))).rows.length,0);
  const attioToken=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'attio',FP]));const deals=[{source:'attio',kind:'deal',external_id:'d1',external_owner_id:'owner1',title:'Deal EUR',currency:'EUR',stage:'Qualified',amount:12000},{source:'attio',kind:'deal',external_id:'d2',external_owner_id:'owner1',title:'Deal USD',currency:'USD',stage:'Qualified',amount:8000}];await asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'attio',attioToken,deals,{},[]]));
  const data=await asUser(db,ids.founder,()=>rpc(db,'nam_connected_sales_data',[ids.w,{attio:FP,justcall:NEW_FP},20,0,{}]));assert.deepEqual(data.pipeline.map(p=>[p.currency,Number(p.amount)]).sort(),[['EUR',12000],['USD',8000]]);
 });
 await t.test('verified-factor sales users need AAL2 for direct reads and RPC writes',async()=>{
  await db.query('insert into auth.mfa_factors(id,user_id,status) values($1,$2,$3)',['66666666-6666-4666-8666-666666666666',ids.sales,'verified']);
  assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_sales_activities'),{aal:'aal1'})).rows.length,0);
  assert.equal((await asUser(db,ids.sales,()=>db.query('select source from nam_integration_state'),{aal:'aal1'})).rows.length,0);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,payload,'low-assurance']),{aal:'aal1'}),e=>e.code==='42501');
  assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_sales_activities'),{aal:'aal2'})).rows.length,1);
 });
 await t.test('null job tokens never commit a snapshot after a completed job',async()=>{
  await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall',null,[],{},[]])),e=>e.code==='55000');
 });
 await t.test('null pagination limits cannot bypass the database record bound',async()=>{
  await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_connected_sales_data',[ids.w,{attio:FP,justcall:NEW_FP},null,0,{}])),e=>e.code==='P0001');
 });
 await t.test('unrenderable PostgreSQL special dates are rejected in direct activity RPCs',async()=>{
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,{...payload,occurred_on:'infinity'},'infinity-date'])),e=>e.code==='23514');
 });
 await t.test('connected reports aggregate 10000 provider records while returning only a bounded page',async()=>{
  const many=Array.from({length:10000},(_,n)=>({source:'justcall',kind:'call',external_id:`load-${n}`,external_owner_id:n%2?'14':'15',title:`Call ${n}`,occurred_at:'2026-11-24T12:00:00Z'}));
  const lease=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,'justcall',NEW_FP]));await asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,'justcall',lease,many,{},[]]));await asUser(db,ids.founder,()=>rpc(db,'nam_map_integration_owner',[ids.w,'justcall','14',ids.sales]));
  const samples=[];for(let n=0;n<5;n++){const start=performance.now();const page=await asUser(db,ids.founder,()=>rpc(db,'nam_connected_sales_data',[ids.w,{attio:FP,justcall:NEW_FP},20,n*20,{source:'justcall'}]));samples.push(performance.now()-start);assert.equal(page.records_total,10000);assert.equal(page.records.length,20);assert.equal(page.counts.find(c=>c.source==='justcall').n,10000);}
  const own=await asUser(db,ids.sales,()=>rpc(db,'nam_connected_sales_data',[ids.w,{justcall:NEW_FP},20,0,{}]));assert.equal(own.records_total,5000);assert(own.records.every(r=>r.external_owner_id==='14'));
  await assert.rejects(asUser(db,ids.outsider,()=>rpc(db,'nam_connected_sales_data',[ids.w,{justcall:NEW_FP},20,0,{}])),e=>e.code==='42501');
  const p95=samples.sort((a,b)=>a-b).at(-1);t.diagnostic(`Local PostgreSQL/WASM provider-page p95: ${p95.toFixed(1)} ms for10000 records (5 reads; not hosted HTTP/load).`);assert(p95<1000,'Provider page target: local SQL p95 under1000 ms');
 });
});
