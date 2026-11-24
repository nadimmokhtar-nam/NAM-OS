import {test} from 'node:test';
import {withVerifiedFactor} from './optional-mfa.mjs';
import assert from 'node:assert/strict';
import {database,asUser,ids} from './database.mjs';
const grant=(section,can_create=true)=>({section,can_create});
const baseline=()=>['sales','academy','operations'].map(section=>grant(section));
async function rpc(db,user,name,args,{aal='aal2',role='authenticated'}={}){return asUser(db,user,async()=>{const result=await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as value`,args);return result.rows[0].value;},{aal,role});}
const get=(db,target=ids.sales)=>rpc(db,ids.founder,'nam_access_member',[ids.w,target]);
const save=async(db,grants,{target=ids.sales,role='sales',revision,actor=ids.founder,aal='aal2'}={})=>rpc(db,actor,'nam_save_member_access',[ids.w,target,revision??(await get(db,target)).revision,role,grants],{aal});

test('P0 access administration uses explicit grants, fixed ceilings, live policies and audited CAS',async t=>{
 const db=await database();t.after(()=>db.close());let task,course;
 await t.test('synthetic baseline is explicit and a new direct membership has no default grants',async()=>{
  assert.deepEqual((await get(db)).grants.map(g=>g.section),['academy','operations','sales']);
  const user='50000000-0000-4000-8000-000000000001';await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,'ungranted@synthetic.invalid']);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[user]);await db.query("insert into nam_memberships(workspace_id,user_id,name,role) values($1,$2,'Ungrant test','sales')",[ids.w,user]);
  const access=await rpc(db,user,'nam_effective_access',[ids.w]);assert.deepEqual(access.sections,[]);assert.deepEqual(access.create_sections,[]);await assert.rejects(rpc(db,user,'nam_create_task',[ids.w,{title:'Must fail',section:'sales'},null]),e=>e.code==='42501');
 });
 await t.test('only a live founder meeting opted-in MFA can administer this workspace',async()=>{
  await withVerifiedFactor(db,ids.founder,async()=>{
  for(const [actor,aal] of [[ids.sales,'aal2'],[ids.founder,'aal1']]){await assert.rejects(rpc(db,actor,'nam_access_member',[ids.w,ids.sales],{aal}),e=>e.code==='42501');await assert.rejects(save(db,baseline(),{actor,aal}),e=>e.code==='42501');}});
  await assert.rejects(get(db,ids.outsider),e=>e.code==='P0002');await assert.rejects(save(db,baseline(),{target:ids.founder,role:'sales'}),e=>e.code==='42501');await assert.rejects(save(db,baseline(),{role:'founder'}),e=>e.code==='42501');
  await assert.rejects(asUser(db,ids.sales,()=>db.query("update nam_section_grants set can_create=false where user_id=$1",[ids.sales])),e=>e.code==='42501');await assert.rejects(asUser(db,ids.sales,()=>db.query("select public.nam_member_section($1,$2,'sales')",[ids.w,ids.founder])),e=>e.code==='42501');
 });
 await t.test('revoking a section immediately removes direct task, optimized page, count, detail and notification access with the same claims',async()=>{
  task=await rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'Scoped sales work',section:'sales',owner_id:ids.sales},null]);assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_tasks'))).rows.length,1);
  await save(db,[grant('academy'),grant('operations')]);assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_tasks'))).rows.length,0);assert.equal((await rpc(db,ids.sales,'nam_task_page',[ids.w,{}])).total,0);assert.equal((await rpc(db,ids.sales,'nam_task_stats',[ids.w])).total,0);assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_notifications'))).rows.length,0);assert.equal(await rpc(db,ids.sales,'nam_task_access',[task.id,false]),false);await assert.rejects(rpc(db,ids.sales,'nam_task_action',[ids.w,task.id,'comment',{body:'Denied'}]),e=>e.code==='P0002');
  const effective=await rpc(db,ids.sales,'nam_effective_access',[ids.w]);assert(!effective.sections.includes('sales'));assert(!effective.member_sections[ids.sales].includes('sales'));await save(db,baseline());
 });
 await t.test('create capability is separate from assigned-task reading and status updates',async()=>{
  await save(db,[grant('sales',false),grant('academy'),grant('operations')]);assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_tasks'))).rows.length,1);assert.equal((await rpc(db,ids.sales,'nam_save_task',[ids.w,task.id,1,{status:'In progress'}])).status,'In progress');await assert.rejects(rpc(db,ids.sales,'nam_create_task',[ids.w,{title:'Denied creation',section:'sales'},null]),e=>e.code==='42501');await rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'Founder can assign read-only member',section:'sales',owner_id:ids.sales},null]);
  await save(db,[grant('academy')]);await assert.rejects(rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'Owner lost access',section:'sales',owner_id:ids.sales},null]),e=>e.code==='22023');await save(db,baseline());
 });
 await t.test('Academy enrollment does not bypass a revoked Academy section grant',async()=>{
  course=await rpc(db,ids.founder,'nam_academy_admin',[ids.w,'create',null,null,{title:'Grant-bound learning',area:'sales',summary:''}]);course=await rpc(db,ids.founder,'nam_academy_admin',[ids.w,'lesson',course.id,course.revision,{title:'Read the standard',body:'A written grant fixture.'}]);course=await rpc(db,ids.founder,'nam_academy_admin',[ids.w,'publish',course.id,course.revision,{}]);course=await rpc(db,ids.founder,'nam_academy_admin',[ids.w,'enroll',course.id,course.revision,{member_id:ids.sales,mandatory:false}]);const learned=await rpc(db,ids.sales,'nam_academy_course',[ids.w,course.id]);assert.equal(learned.lessons.length,1);
  await save(db,[grant('sales'),grant('operations')]);assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_lessons'))).rows.length,0);await assert.rejects(rpc(db,ids.sales,'nam_academy_list',[ids.w]),e=>e.code==='42501');await assert.rejects(rpc(db,ids.sales,'nam_academy_progress',[ids.w,learned.lessons[0].id,true]));await save(db,baseline());assert.equal((await rpc(db,ids.sales,'nam_academy_course',[ids.w,course.id])).lessons.length,1);
 });
 await t.test('role changes do not create new grants; invalid scopes and manager labels cannot widen access',async()=>{
  await save(db,[grant('academy')],{role:'artist'});let access=await rpc(db,ids.sales,'nam_effective_access',[ids.w]);assert.deepEqual(access.sections,['academy']);assert(!access.sections.includes('projects'));const before=await get(db);
  for(const grants of [[grant('sales')],[{section:'academy',can_create:true,can_manage:true}],[{section:'academy',can_create:'true'}],[grant('academy'),grant('academy')]])await assert.rejects(save(db,grants,{role:'artist'}),e=>e.code==='22023');assert.equal((await get(db)).revision,before.revision);
  await save(db,[],{role:'sales_manager'});access=await rpc(db,ids.sales,'nam_effective_access',[ids.w]);assert.deepEqual(access.sections,[]);await save(db,baseline(),{role:'sales'});
 });
 await t.test('stale editors and membership changes cannot overwrite current grants; audit contains trusted attribution',async()=>{
  const prior=await get(db),next=await save(db,[grant('sales',false)]);assert.equal(next.revision,prior.revision+1);await assert.rejects(save(db,baseline(),{revision:prior.revision}),e=>e.code==='40001');const events=(await asUser(db,ids.founder,()=>db.query("select * from nam_access_events where target_id=$1 and kind='access_updated' order by id desc",[ids.sales]))).rows;assert.equal(events[0].actor_id,ids.founder);assert.deepEqual(events[0].new_grants,[grant('sales',false)]);assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_access_events'))).rows.length,0);
  const stale=(await get(db)).revision;await rpc(db,ids.founder,'nam_set_member_active',[ids.w,ids.sales,false]);await assert.rejects(save(db,baseline(),{revision:stale}),e=>e.code==='40001');await rpc(db,ids.founder,'nam_set_member_active',[ids.w,ids.sales,true]);await save(db,baseline());
 });
 await t.test('removing the founder session revokes administration without JWT renewal',async()=>{await db.query('delete from auth.sessions where id=$1',[ids.founder]);await assert.rejects(get(db),e=>e.code==='42501');await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.founder]);});
});

test('one-time migration backfill preserves prior assigned-only memberships without a permissive new-member trigger',async t=>{
 const w='60000000-0000-4000-8000-000000000001',u='60000000-0000-4000-8000-000000000002';
 const db=await database({beforeMigration:async(file,db)=>{if(!file.endsWith('013_access_administration.sql'))return;await db.query("insert into nam_workspaces(id,name) values($1,'Pre-migration')",[w]);await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[u,'before-access@synthetic.invalid']);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[u]);await db.query("insert into nam_memberships(workspace_id,user_id,name,role) values($1,$2,'Pre-migration sales','sales')",[w,u]);}});t.after(()=>db.close());const effective=await rpc(db,u,'nam_effective_access',[w]);assert.deepEqual(effective.sections,['sales','academy','operations']);assert.deepEqual(effective.create_sections,['sales','academy','operations']);
});

test('trusted attachment attestation cannot finalize an upload after section access was revoked',async t=>{
 const db=await database();t.after(()=>db.close());const task=await rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'In-flight grant revocation',section:'sales',owner_id:ids.sales},null]);
 const file=await rpc(db,ids.sales,'nam_reserve_attachment',[ids.w,task.id,'scope.txt','text/plain',12,'a'.repeat(64)]);
 await asUser(db,ids.sales,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('nam-task-attachments',$1,$2,$3)",[file.storage_path,ids.sales,JSON.stringify({size:12,mimetype:'text/plain'})]));
 await save(db,[grant('academy')]);
 await assert.rejects(rpc(db,null,'nam_attest_attachment',[ids.w,file.id,ids.sales,ids.sales,true],{role:'service_role'}),e=>e.code==='42501');
 assert.equal((await db.query('select status,attested_at from nam_task_attachments where id=$1',[file.id])).rows[0].status,'pending');assert.equal((await db.query('select attested_at from nam_task_attachments where id=$1',[file.id])).rows[0].attested_at,null);
 assert.equal((await asUser(db,ids.sales,()=>db.query('select id from storage.objects where name=$1',[file.storage_path]))).rows.length,0);
 await assert.rejects(rpc(db,null,'nam_attest_attachment_identity_only',[ids.w,file.id,ids.sales,ids.sales,true],{role:'service_role'}),e=>e.code==='42501');
 await save(db,baseline());assert.equal((await rpc(db,null,'nam_attest_attachment',[ids.w,file.id,ids.sales,ids.sales,true],{role:'service_role'})).status,'ready');
});
