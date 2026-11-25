import test from 'node:test';
import assert from 'node:assert/strict';
import {database,asUser,ids} from './database.mjs';
import {withVerifiedFactor} from './optional-mfa.mjs';
import {context,loadServerModule} from './support/runtime.mjs';

const rpc=async(db,name,args)=>(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as value`,args.map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value))).rows[0].value;
const call=(db,user,name,args,options)=>asUser(db,user,()=>rpc(db,name,args),options);

test('Home announcements are dated, role-addressed NAM records with live authority and exact audit/retry semantics',async t=>{
 const db=await database();t.after(()=>db.close());const dates=(await db.query("select (now() at time zone 'Europe/Paris')::date::text as today,((now() at time zone 'Europe/Paris')::date+1)::text as tomorrow,((now() at time zone 'Europe/Paris')::date-1)::text as yesterday")).rows[0];let all;
 const input=values=>({title:'Studio update',body:'A real operational update.',audience_roles:[],starts_on:dates.today,ends_on:null,...values});
 const save=(aid,version,changes,key)=>call(db,ids.founder,'nam_save_home_announcement',[ids.w,aid,version,changes,key]);
 await t.test('inclusive date windows and exact role audiences apply to both RPC and direct RLS reads',async()=>{
  all=await save(null,0,input({title:'All-member update',ends_on:dates.today}),'home-create-all');
  await save(null,0,input({title:'Sales-only update',audience_roles:['sales']}),'home-create-sales');
  await save(null,0,input({title:'Freelancer-only update',audience_roles:['freelancer']}),'home-create-freelancer');
  await save(null,0,input({title:'Tomorrow update',starts_on:dates.tomorrow}),'home-create-future');
  await save(null,0,input({title:'Expired update',starts_on:dates.yesterday,ends_on:dates.yesterday}),'home-create-expired');
  await save(null,0,input({title:'Archived update',archived:true}),'home-create-archived');
  await db.query("insert into nam_home_announcements(workspace_id,title,body,audience_roles,starts_on,created_by,updated_by) values($1,$2,$3,'{}',$4,$5,$5)",[ids.otherW,'Foreign update','Must remain in its own tenant.',dates.today,ids.outsider]);
  const sales=await call(db,ids.sales,'nam_home_announcements_page',[ids.w,{}]);assert.equal(sales.total,2);assert(sales.items.some(row=>row.title==='All-member update'));assert(sales.items.some(row=>row.title==='Sales-only update'));assert(!sales.items.some(row=>row.title.includes('Freelancer')||row.title.includes('Foreign')));
  const artist=await call(db,ids.artist,'nam_home_announcements_page',[ids.w,{}]);assert.equal(artist.total,2);assert(artist.items.some(row=>row.title==='Freelancer-only update'));
  assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_home_announcements'))).rows.length,2);
  const founder=await call(db,ids.founder,'nam_home_announcements_page',[ids.w,{}]);assert.equal(founder.total,1,'Founder Home obeys the audience filter; management is explicit');
  assert.equal((await call(db,ids.founder,'nam_home_announcements_page',[ids.w,{mode:'manage'}])).total,6);
 });
 await t.test('announcements do not require unrelated section grants or turn role audiences into permissions',async()=>{
  await db.query('delete from nam_section_grants where workspace_id=$1 and user_id=$2',[ids.w,ids.sales]);
  assert.equal((await call(db,ids.sales,'nam_home_announcements_page',[ids.w,{}])).total,2);
  assert.equal((await call(db,ids.sales,'nam_home_work_context',[ids.w,'mine'])).images,null);
  await assert.rejects(call(db,ids.sales,'nam_home_announcements_page',[ids.w,{mode:'manage'}]),e=>e.code==='42501');
  await assert.rejects(call(db,ids.sales,'nam_save_home_announcement',[ids.w,null,0,input({title:'Unauthorized'}),'home-illegal-create']),e=>e.code==='42501');
  assert.equal((await db.query('select count(*)::int as n from nam_section_grants where workspace_id=$1 and user_id=$2',[ids.w,ids.sales])).rows[0].n,0);
 });
 await t.test('CAS and exact retries never duplicate announcements/events or replay a different body',async()=>{
  const changed=await save(all.id,1,{body:'Updated operational message.'},'home-edit-original');assert.equal(changed.version,2);
  assert.deepEqual(await save(all.id,1,{body:'Updated operational message.'},'home-edit-original'),changed);
  await assert.rejects(save(all.id,1,{body:'Changed retry body.'},'home-edit-original'),e=>e.code==='40001');
  await assert.rejects(save(all.id,1,{body:'Stale overwrite.'},'home-edit-stale'),e=>e.code==='40001');
  const archived=await save(all.id,2,{archived:true},'home-archive-original');assert.equal(archived.version,3);
  assert.deepEqual(await save(all.id,1,{body:'Updated operational message.'},'home-edit-original'),changed,'an exact retry returns the original saved result after later changes');
  assert(!(await call(db,ids.sales,'nam_home_announcements_page',[ids.w,{}])).items.some(row=>row.id===all.id));
  const restored=await save(all.id,3,{archived:false},'home-restore-original');assert.equal(restored.version,4);
  const history=await call(db,ids.founder,'nam_home_announcement_history',[ids.w,all.id,0]);assert.equal(history.total,4);assert.deepEqual(history.items.map(e=>e.kind),['restored','archived','edited','created']);assert.equal(history.items[2].before_state.body,all.body);assert.equal(history.items[2].after_state.body,changed.body);
  await assert.rejects(call(db,ids.sales,'nam_home_announcement_history',[ids.w,all.id,0]),e=>e.code==='42501');
  await assert.rejects(asUser(db,ids.sales,()=>db.query('select fingerprint,result from nam_home_announcement_requests')),e=>e.code==='42501');
  await assert.rejects(asUser(db,ids.founder,()=>db.query("update nam_home_announcements set body='Direct edit' where id=$1",[all.id])),e=>e.code==='42501');
 });
 await t.test('tenant, membership, session and elected MFA denial are fail-closed',async()=>{
  for(const user of [ids.outsider,ids.suspended]){assert.equal(await call(db,user,'nam_home_member',[ids.w]),false);await assert.rejects(call(db,user,'nam_home_announcements_page',[ids.w,{}]),e=>e.code==='42501');}
  await assert.rejects(call(db,ids.sales,'nam_home_announcements_page',[ids.w,{}],{sessionId:null}),e=>e.code==='42501');
  await withVerifiedFactor(db,ids.sales,()=>assert.rejects(call(db,ids.sales,'nam_home_announcements_page',[ids.w,{}],{aal:'aal1'}),e=>e.code==='42501'));
  await withVerifiedFactor(db,ids.founder,()=>assert.rejects(call(db,ids.founder,'nam_save_home_announcement',[ids.w,null,0,input({}),'home-mfa-bypass'],{aal:'aal1'}),e=>e.code==='42501'));
  await assert.rejects(call(db,ids.founder,'nam_save_home_announcement',[ids.otherW,null,0,input({}),'home-cross-tenant']),e=>e.code==='42501');
  assert.equal((await call(db,ids.outsider,'nam_home_announcements_page',[ids.otherW,{}])).total,1);
 });
 await t.test('invalid date windows, roles, bounds and forged fields cannot leave partial records',async()=>{
  const before=(await db.query('select count(*)::int as n from nam_home_announcements')).rows[0].n;let counter=0;
  for(const value of [{audience_roles:['sales','sales']},{audience_roles:['client']},{audience_roles:[null]},{starts_on:'infinity'},{starts_on:'2026-02-30'},{starts_on:dates.tomorrow,ends_on:dates.today},{body:''},{title:'Line\nbreak'},{created_by:ids.sales}])await assert.rejects(save(null,0,input(value),'home-invalid-'+(++counter)),e=>e.code?.startsWith('22')||e.code?.startsWith('23'));
  assert.equal((await db.query('select count(*)::int as n from nam_home_announcements')).rows[0].n,before);
  for(const filters of [{mode:'invented'},{limit:0},{limit:51},{offset:-1},{state:'deleted'},{q:'x'.repeat(201)},{mode:null}])await assert.rejects(call(db,ids.founder,'nam_home_announcements_page',[ids.w,filters]),e=>e.code==='22023');
  const page=await call(db,ids.founder,'nam_home_announcements_page',[ids.w,{mode:'manage',limit:1,offset:0}]);assert.equal(page.total,6);assert.equal(page.items.length,1);assert.equal(page.hasMore,true);
 });
 await t.test('image/client pointers count real permitted records and keep personal/studio scopes distinct',async()=>{
  const pid=await call(db,ids.founder,'nam_save_project',[ids.w,null,null,{title:'Home context project',lead_id:ids.artist,member_ids:[ids.artist]},'home-context-project']);
  await call(db,ids.founder,'nam_save_deliverable',[ids.w,null,null,{project_id:pid,code:'A',title:'Assigned image',stage:'Internal review',artist_id:ids.artist},'home-context-image-a']);
  await call(db,ids.founder,'nam_save_deliverable',[ids.w,null,null,{project_id:pid,code:'B',title:'Founder image',stage:'Revisions',artist_id:ids.founder},'home-context-image-b']);
  await db.query("insert into nam_client_review_requests(workspace_id,project_id,number,title,created_by,request_key,create_payload,purpose,status) values($1,$2,1,'Issued client review',$3,'home-context-review','{}','review','issued'),($1,$2,2,'Final delivery',$3,'home-context-delivery','{}','delivery','issued'),($1,$2,3,'Closed review',$3,'home-context-closed','{}','review','closed')",[ids.w,pid,ids.founder]);
  const own=await call(db,ids.artist,'nam_home_work_context',[ids.w,'mine']);assert.equal(own.images.total,1);assert.equal(own.images.review_stage,1);assert.equal(own.images.revisions,0);assert.equal(own.images.items[0].title,'Assigned image');assert.equal(own.client_reviews,null);
  const studio=await call(db,ids.founder,'nam_home_work_context',[ids.w,'studio']);assert.equal(studio.images.total,2);assert.equal(studio.client_reviews.issued,1);assert.equal(studio.client_reviews.items[0].title,'Issued client review');
  const mine=await call(db,ids.founder,'nam_home_work_context',[ids.w,'mine']);assert.equal(mine.images.total,1);assert.equal(mine.images.revisions,1);assert.equal(mine.client_reviews,null);
  await assert.rejects(call(db,ids.artist,'nam_home_work_context',[ids.w,'studio']),e=>e.code==='42501');
  await db.query('delete from nam_project_members where workspace_id=$1 and project_id=$2 and user_id=$3',[ids.w,pid,ids.artist]);await db.query('update nam_projects set lead_id=$1 where id=$2',[ids.founder,pid]);
  assert.equal((await call(db,ids.artist,'nam_home_work_context',[ids.w,'mine'])).images.total,0);
 });
});

test('Home handlers recheck real PostgreSQL session, MFA and current role after successful source reads',async t=>{
 const db=await database();t.after(()=>db.close());const {dispatchHomeAnnouncements}=await loadServerModule('lib/api/home-announcements.ts'),today=(await db.query("select (now() at time zone 'Europe/Paris')::date::text as value")).rows[0].value;
 const announcement=await call(db,ids.founder,'nam_save_home_announcement',[ids.w,null,0,{title:'Private sales update',body:'This body must not escape a revoked final read.',audience_roles:['sales'],starts_on:today,ends_on:null},'home-final-read-fixture']);
 const read=ctx=>dispatchHomeAnnouncements(ctx,['home','announcements'],new Request('https://nam.example/api/home/announcements'));
 await t.test('session revoked after combined source reads prevents the response',async()=>{
  const ctx=await context(db,ids.sales,{aal:'aal1'}),original=ctx.supabase.rpc;ctx.supabase.rpc=async(name,args)=>{const result=await original(name,args);if(name==='nam_home_work_context'&&!result.error)await db.query('delete from auth.sessions where id=$1',[ids.sales]);return result;};
  await assert.rejects(read(ctx),e=>e.status===403);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.sales]);
 });
 await t.test('elected MFA after a history read prevents the AAL1 response',async()=>{
  const ctx=await context(db,ids.founder,{aal:'aal1'}),original=ctx.supabase.rpc;ctx.supabase.rpc=async(name,args)=>{const result=await original(name,args);if(name==='nam_home_announcement_history'&&!result.error)await db.query("insert into auth.mfa_factors(id,user_id,status) values('90000000-0000-4000-8000-000000000036',$1,'verified')",[ids.founder]);return result;};
  try{await assert.rejects(dispatchHomeAnnouncements(ctx,['home','announcements',announcement.id,'history'],new Request('https://nam.example/api/home/announcements/'+announcement.id+'/history')),e=>e.status===403);}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
 });
 await t.test('role audience changes after the page read cannot return the former role body',async()=>{
  const ctx=await context(db,ids.sales,{aal:'aal1'}),original=ctx.supabase.rpc;ctx.supabase.rpc=async(name,args)=>{const result=await original(name,args);if(name==='nam_home_work_context'&&!result.error)await db.query("update nam_memberships set role='artist' where workspace_id=$1 and user_id=$2",[ids.w,ids.sales]);return result;};
  try{await assert.rejects(read(ctx),e=>e.status===403);}finally{await db.query("update nam_memberships set role='sales' where workspace_id=$1 and user_id=$2",[ids.w,ids.sales]);}
 });
});
