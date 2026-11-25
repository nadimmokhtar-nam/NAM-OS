import test from 'node:test';
import assert from 'node:assert/strict';
import {database,asUser,ids} from './database.mjs';
import {withVerifiedFactor} from './optional-mfa.mjs';

const FP='c'.repeat(64),NEW_FP='d'.repeat(64),month='2026-11';
const rpc=async(db,name,args)=>(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as result`,args)).rows[0].result;
const row=(kind,external_id,values={})=>({source:'attio',kind,external_id,external_owner_id:'14',title:external_id,occurred_at:'2026-11-20T12:00:00Z',...values});
const records=[
 row('lead','person-a',{title:'Mapped contact',company_ids:['company-a','company-private'],lead_status:'Qualified',is_qualified:true}),
 row('lead','person-private',{external_owner_id:'99',title:'Private contact'}),
 row('company','company-a',{title:'Permitted company'}),row('company','company-private',{external_owner_id:'99',title:'Private company'}),
 row('deal','eur-open',{stage:'Proposal',stage_category:'open',currency:'EUR',amount:1000,probability:.25,projected_close_on:'2026-11-30'}),
 row('deal','eur-incomplete',{stage:'Proposal',stage_category:'open',currency:'EUR',amount:null,probability:null,projected_close_on:'2026-11-30'}),
 row('deal','gbp-open',{stage:'Negotiation',stage_category:'open',currency:'GBP',amount:500,probability:.5,projected_close_on:'2026-11-30'}),
 row('deal','eur-won',{stage:'Client',stage_category:'won',currency:'EUR',amount:600,closed_on:'2026-11-21'}),
 row('deal','eur-lost',{stage:'Stopped',stage_category:'lost',currency:'EUR',amount:200,closed_on:'2026-11-22'}),
 row('deal','undated',{stage:'Proposal',stage_category:'open',currency:'EUR',amount:200,projected_close_on:null}),
 row('deal','unclassified',{stage:'Custom stage',stage_category:null,currency:'EUR',amount:900}),
];
async function sync(db,source,fingerprint,rows){const token=await asUser(db,ids.founder,()=>rpc(db,'nam_begin_integration_sync',[ids.w,source,fingerprint]));await asUser(db,ids.founder,()=>rpc(db,'nam_finish_integration_sync',[ids.w,source,token,rows,{period:'Test snapshot'},[]]));}
const workspace=(db,user,filters={},fingerprints={attio:FP})=>asUser(db,user,()=>rpc(db,'nam_sales_workspace_data',[ids.w,fingerprints,{period:month,...filters}]));

test('Sales workspace uses actual CRM snapshots and central tasks with complete owner-scoped aggregates',async t=>{
 const db=await database();t.after(()=>db.close());let followup;
 await sync(db,'attio',FP,records);await asUser(db,ids.founder,()=>rpc(db,'nam_map_integration_owner',[ids.w,'attio','14',ids.sales]));
 await t.test('contacts and relationship labels never widen provider ownership',async()=>{
  const own=await workspace(db,ids.sales,{view:'contacts',limit:1});assert.equal(own.records_total,1);assert.equal(own.records.length,1);assert.equal(own.records[0].title,'Mapped contact');assert.deepEqual(own.records[0].companies,[{external_id:'company-a',title:'Permitted company'}]);
  const all=await workspace(db,ids.founder,{view:'contacts',limit:1});assert.equal(all.records_total,2);assert.equal(all.records.length,1);
  const leads=await workspace(db,ids.sales,{view:'leads'});assert.equal(leads.records_total,1);assert.equal(leads.records[0].is_qualified,true);
  const searched=await workspace(db,ids.sales,{view:'opportunities',q:'gbp-open'});assert.equal(searched.records_total,1);assert.equal(searched.pipeline.reduce((n,p)=>n+Number(p.deals),0),7,'pipeline aggregate is independent of the search page');
 });
 await t.test('forecast separates currencies and refuses an incomplete weighted total',async()=>{
  const report=await workspace(db,ids.sales,{view:'revenue'}),eur=report.forecast.find(f=>f.currency==='EUR'),gbp=report.forecast.find(f=>f.currency==='GBP');
  assert.equal(Number(eur.known_amount),1000);assert.equal(eur.deals,2);assert.equal(eur.weighted_amount,null);assert.equal(eur.missing_value,1);assert.equal(eur.missing_probability,1);assert.equal(Number(gbp.weighted_amount),250);
  assert.equal(report.forecast_limits.undated_open_deals,1);assert.equal(report.forecast_limits.unclassified_deals,1);assert.equal(report.conversion.won,1);assert.equal(report.conversion.lost,1);
 });
 await t.test('new follow-up is one idempotent central task, linked with an audited revision',async()=>{
  const changes={title:'Discuss the next proposal',priority:'High',due_date:'2026-11-30',description:''};
  followup=await asUser(db,ids.sales,()=>rpc(db,'nam_create_sales_followup',[ids.w,'attio','lead','person-a',changes,'sales-followup-key',FP]));assert.equal(followup.section,'sales');assert.equal(followup.owner_id,ids.sales);assert.equal(followup.version,2);
  const retry=await asUser(db,ids.sales,()=>rpc(db,'nam_create_sales_followup',[ids.w,'attio','lead','person-a',changes,'sales-followup-key',FP]));assert.equal(retry.id,followup.id);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_create_sales_followup',[ids.w,'attio','lead','person-private',changes,'sales-followup-key',FP])),e=>e.code==='40001');
  const task=(await asUser(db,ids.sales,()=>db.query('select id,title,version from public.nam_tasks where id=$1',[followup.id]))).rows[0];assert.equal(task.title,changes.title);assert.equal(task.version,2);
  const contact=await workspace(db,ids.sales,{view:'contacts'});assert.equal(contact.records[0].followups[0].id,followup.id);
  assert.equal((await asUser(db,ids.sales,()=>db.query('select task_id from nam_sales_followup_links'))).rows.length,1);
  await assert.rejects(asUser(db,ids.sales,()=>db.query('select credential_fingerprint from nam_sales_followup_links')),e=>e.code==='42501');
 });
 await t.test('inaccessible or mismatched source links roll back task creation entirely',async()=>{
  const before=Number((await db.query('select count(*) as n from public.nam_tasks')).rows[0].n);
  for(const [ref,fp] of [['person-private',FP],['person-a',NEW_FP],['absent',FP]])await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_create_sales_followup',[ids.w,'attio','lead',ref,{title:'Must roll back'},'invalid-'+ref+fp.slice(0,1),fp])),e=>e.code==='P0002');
  assert.equal(Number((await db.query('select count(*) as n from public.nam_tasks')).rows[0].n),before);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_link_sales_followup',[ids.w,followup.id,'attio','deal','eur-open',1,FP])),e=>e.code==='40001');
 });
 await t.test('revenue objectives are founder-only, versioned and independently audited',async()=>{
  const value={owner_id:ids.sales,period:month,currency:'EUR',amount:'10000.00',note:'Agreed objective'};
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_set_sales_revenue_target',[ids.w,value])),e=>e.code==='42501');
  const first=await asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_revenue_target',[ids.w,value]));assert.equal(first.version,1);
  await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_revenue_target',[ids.w,{...value,amount:'12000.00'}])),e=>e.code==='40001');
  const next=await asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_revenue_target',[ids.w,{...value,amount:'12000.00',expectedVersion:1}]));assert.equal(next.version,2);
  const report=await workspace(db,ids.sales,{view:'revenue'});assert.equal(report.targets.length,1);assert.equal(Number(report.targets[0].known_won_value),600);assert.equal(report.targets[0].missing_won_data,0);
  assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_sales_revenue_target_events'))).rows.length,2);
  await assert.rejects(asUser(db,ids.sales,()=>db.query('update nam_sales_revenue_targets set amount=1')),e=>e.code==='42501');
 });
 await t.test('individual indicators retain source periods and never attribute shared campaign totals',async()=>{
  const lemlist=[{source:'lemlist',kind:'outreach',external_id:'reply',external_owner_id:'sender-a',title:'Email reply',activity_type:'emailsReplied'},{source:'lemlist',kind:'outreach',external_id:'open',external_owner_id:'sender-a',title:'Email opened',activity_type:'emailsOpened'},{source:'lemlist',kind:'campaign_report',external_id:'report',external_owner_id:null,title:'Team report',emails_sent:999,emails_replied:50}];
  await sync(db,'lemlist',FP,lemlist);await asUser(db,ids.founder,()=>rpc(db,'nam_map_integration_owner',[ids.w,'lemlist','sender-a',ids.sales]));
  const data=await workspace(db,ids.sales,{view:'performance'},{attio:FP,lemlist:FP});const person=data.performance.find(p=>p.owner_id===ids.sales);assert.equal(person.outreach_events,2);assert.equal(person.reply_events,1);assert.equal(person.open_followups,1);
  const campaigns=await workspace(db,ids.sales,{view:'campaigns'},{attio:FP,lemlist:FP});assert.equal(campaigns.records_total,0);
 });
 await t.test('section, tenant, owner, managed-session and elected MFA checks remain enforced',async()=>{
  for(const user of [ids.artist,ids.outsider,ids.suspended])await assert.rejects(workspace(db,user,{view:'contacts'}),e=>e.code==='42501');
  await assert.rejects(workspace(db,ids.sales,{owner:ids.founder}),e=>e.code==='42501');
  await withVerifiedFactor(db,ids.sales,()=>assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_sales_workspace_data',[ids.w,{attio:FP},{}]),{aal:'aal1'}),e=>e.code==='42501'));
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_sales_workspace_data',[ids.w,{attio:FP},{}]),{sessionId:null}),e=>e.code==='42501');
  for(const filters of [{limit:0},{limit:101},{offset:-1},{period:'2026-13'},{view:'invented'},{q:'x'.repeat(201)}])await assert.rejects(workspace(db,ids.sales,filters),e=>e.code==='22023');
 });
 await t.test('credential rotation redacts source context while preserving the real task',async()=>{
  await sync(db,'attio',NEW_FP,records);
  const report=await workspace(db,ids.sales,{view:'followups'},{attio:NEW_FP});assert.equal(report.records_total,1);assert.equal(report.records[0].title,followup.title);assert.equal(report.records[0].record_title,null);assert.equal(report.records[0].external_id,null);assert.equal(report.records[0].has_source_link,true);
  assert.equal((await asUser(db,ids.sales,()=>db.query('select task_id from nam_sales_followup_links'))).rows.length,0);
  await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_unlink_sales_followup',[ids.w,followup.id,1])),e=>e.code==='40001');
  await asUser(db,ids.sales,()=>rpc(db,'nam_unlink_sales_followup',[ids.w,followup.id,followup.version]));
  const task=(await db.query('select version from nam_tasks where id=$1',[followup.id])).rows[0];assert.equal(task.version,3);assert.equal((await db.query('select * from nam_sales_followup_links')).rows.length,0);
 });
});
