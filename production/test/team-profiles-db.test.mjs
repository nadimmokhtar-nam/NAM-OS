import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,asUser,ids} from './database.mjs';
import {withVerifiedFactor} from './optional-mfa.mjs';

let sequence=0;
async function rpc(db,user,name,args,options={}){return asUser(db,user,async()=>{const values=args.map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value);return (await db.query(`select to_jsonb(public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')})) as value`,values)).rows[0].value;},options);}
const own=(db,user=ids.sales,options={})=>rpc(db,user,'nam_team_profile',[ids.w],options);
const save=(db,user,operation,target,version,payload,key='team-request-'+(++sequence),options={})=>rpc(db,user,'nam_save_team_metadata',[ids.w,operation,target,version,payload,key],options);
const createDepartment=(db,name='Production')=>save(db,ids.founder,'department',null,0,{name,archived:false});

test('professional metadata remains caller scoped and does not grant access to work',async t=>{
 const db=await database();t.after(()=>db.close());
 await db.query('delete from nam_section_grants where workspace_id=$1 and user_id=$2',[ids.w,ids.sales]);
 assert.deepEqual((await rpc(db,ids.sales,'nam_effective_access',[ids.w])).sections,[]);
 let profile=await own(db);assert.equal(profile.revision,0);assert.equal(profile.job_title,'');assert.deepEqual(profile.notifications,{assignment:true,due:true,overdue:true});
 profile=await save(db,ids.sales,'profile',ids.sales,0,{name:'Sales colleague',job_title:'Business development'});assert.equal(profile.name,'Sales colleague');assert.equal(profile.revision,1);
 assert.deepEqual((await rpc(db,ids.sales,'nam_effective_access',[ids.w])).sections,[]);
 assert.equal((await db.query('select role from nam_memberships where workspace_id=$1 and user_id=$2',[ids.w,ids.sales])).rows[0].role,'sales');
 await assert.rejects(save(db,ids.sales,'profile',ids.founder,0,{name:'Forged',job_title:''}),e=>e.code==='42501');
 await assert.rejects(save(db,ids.sales,'profile',ids.sales,1,{name:'Forged',job_title:'',role:'founder'}),e=>e.code==='22023');
 await assert.rejects(save(db,ids.sales,'notifications',ids.sales,1,{assignment:true,due:true,overdue:true,comment:true}),e=>e.code==='22023');
 for(const name of ['nam_team_directory','nam_team_departments'])await assert.rejects(rpc(db,ids.sales,name,[ids.w]),e=>e.code==='42501');
 await assert.rejects(asUser(db,ids.sales,()=>db.query("update nam_member_profiles set department_id=null")),e=>e.code==='42501');
 assert.equal((await asUser(db,ids.outsider,()=>db.query('select * from nam_member_profiles where workspace_id=$1',[ids.w]))).rows.length,0);
 await assert.rejects(rpc(db,ids.sales,'nam_team_profile_value',[ids.w,ids.founder]),e=>e.code==='42501');
 for(const name of ['nam_team_profile','nam_team_directory','nam_team_departments','nam_team_history'])await assert.rejects(rpc(db,null,name,[ids.w],{role:'service_role'}),e=>e.code==='42501');
});

test('Founder departments preserve assigned-only privacy, CAS, exact retry and history',async t=>{
 const db=await database();t.after(()=>db.close());const before=await rpc(db,ids.sales,'nam_effective_access',[ids.w]);
 const department=await createDepartment(db);assert.equal(department.revision,1);
 const assigned=await save(db,ids.founder,'member_department',ids.sales,0,{department_id:department.id},'stable-department-assignment');assert.equal(assigned.department.id,department.id);assert.equal(assigned.revision,1);
 const retry=await save(db,ids.founder,'member_department',ids.sales,0,{department_id:department.id},'stable-department-assignment');assert.deepEqual(retry,assigned);
 await assert.rejects(save(db,ids.founder,'member_department',ids.sales,0,{department_id:null},'stable-department-assignment'),e=>e.code==='40001');
 await assert.rejects(save(db,ids.sales,'profile',ids.sales,0,{name:'Stale profile',job_title:''}),e=>e.code==='40001');
 assert.deepEqual((await rpc(db,ids.sales,'nam_effective_access',[ids.w])).sections,before.sections);
 const task=await rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'Other member private work',section:'projects',owner_id:ids.artist},null]);
 await save(db,ids.founder,'member_department',ids.artist,0,{department_id:department.id});
 assert.equal(await rpc(db,ids.sales,'nam_task_access',[task.id,false]),false);
 const directory=await rpc(db,ids.founder,'nam_team_directory',[ids.w,1,'Sales',department.id]);assert.equal(directory.items.length,1);assert.equal(directory.items[0].department.name,'Production');assert(!('notifications' in directory.items[0]));
 assert.equal((await own(db)).department.name,'Production');
 const archived=await save(db,ids.founder,'department',department.id,department.revision,{name:'Production',archived:true});assert.equal(archived.revision,2);assert.equal((await own(db)).department.archived,true);
 await save(db,ids.founder,'member_department',ids.artist,1,{department_id:null});
 await assert.rejects(save(db,ids.founder,'member_department',ids.artist,2,{department_id:department.id}),e=>e.code==='22023');
 await assert.rejects(save(db,ids.founder,'department',department.id,1,{name:'Stale name',archived:false}),e=>e.code==='40001');
 await assert.rejects(createDepartment(db,' production '),e=>e.code==='23505');
 const other=await rpc(db,ids.outsider,'nam_team_profile',[ids.otherW]);assert.equal(other.department,null);
 await assert.rejects(save(db,ids.founder,'member_department',ids.outsider,0,{department_id:department.id}),e=>e.code==='P0002');
 const history=await rpc(db,ids.sales,'nam_team_history',[ids.w]);assert(history.items.every(event=>event.target_user===ids.sales));assert.equal(history.items.filter(event=>event.kind==='member_department').length,1);assert.equal(history.items[0].actor_id,ids.founder);
 const full=await rpc(db,ids.founder,'nam_team_history',[ids.w]);assert(full.items.some(event=>event.kind==='department'));assert(full.items.some(event=>event.target_user===ids.artist));
});

test('actual assignment and scheduled reminder INSERTs honor each supported preference',async t=>{
 const db=await database();t.after(()=>db.close());
 await save(db,ids.sales,'notifications',ids.sales,0,{assignment:false,due:true,overdue:false});
 const date=(await db.query("select (now() at time zone 'Europe/Paris')::date::text as today,((now() at time zone 'Europe/Paris')::date-1)::text as yesterday")).rows[0];
 const due=await rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'Due preference fixture',section:'sales',owner_id:ids.sales,due_date:date.today},null]);
 const overdue=await rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'Overdue preference fixture',section:'sales',owner_id:ids.sales,due_date:date.yesterday},null]);
 assert.equal((await db.query('select id from nam_notifications')).rows.length,0);
 assert.equal(await rpc(db,null,'nam_process_reminders',[ids.w],{role:'service_role'}),1);
 let notifications=(await asUser(db,ids.sales,()=>db.query('select task_id,kind from nam_notifications order by created_at'))).rows;
 assert.deepEqual(notifications,[{task_id:due.id,kind:'due'}]);assert.equal(await rpc(db,null,'nam_process_reminders',[ids.w],{role:'service_role'}),0);
 const preference=await save(db,ids.sales,'notifications',ids.sales,1,{assignment:true,due:false,overdue:true});assert.equal(preference.revision,2);
 // A preference save itself sends nothing and preserves historical inbox items.
 assert.equal((await db.query('select id from nam_notifications')).rows.length,1);
 const assignment=await rpc(db,ids.founder,'nam_create_task',[ids.w,{title:'Assignment enabled',section:'sales',owner_id:ids.sales},null]);
 assert.equal(await rpc(db,null,'nam_process_reminders',[ids.w],{role:'service_role'}),1);
 notifications=(await asUser(db,ids.sales,()=>db.query('select task_id,kind from nam_notifications'))).rows;
 assert(notifications.some(row=>row.task_id===assignment.id&&row.kind==='assignment'));assert(notifications.some(row=>row.task_id===overdue.id&&row.kind==='overdue'));assert(notifications.some(row=>row.task_id===due.id&&row.kind==='due'));
 await db.query('delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section=$3',[ids.w,ids.sales,'sales']);
 assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_notifications'))).rows.length,0);
 const hidden=await db.query("insert into nam_notifications(workspace_id,recipient_id,task_id,body,kind,dedupe_key) values($1,$2,$3,'Revoked recipient','assignment','new-revoked-notification') returning id",[ids.w,ids.sales,assignment.id]);assert.equal(hidden.rows.length,0);
});

test('metadata rechecks current session, MFA and suspension even for a saved retry',async t=>{
 const db=await database();t.after(()=>db.close());const payload={name:'Saved colleague',job_title:'Artist'};
 await save(db,ids.sales,'profile',ids.sales,0,payload,'session-bound-retry');
 await db.query('delete from auth.sessions where id=$1',[ids.sales]);
 await assert.rejects(save(db,ids.sales,'profile',ids.sales,0,payload,'session-bound-retry'),e=>e.code==='42501');
 await assert.rejects(own(db),e=>e.code==='42501');
 await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.sales]);
 await withVerifiedFactor(db,ids.sales,async()=>{await assert.rejects(own(db,ids.sales,{aal:'aal1'}),e=>e.code==='42501');assert.equal((await asUser(db,ids.sales,()=>db.query('select * from nam_member_profiles'),{aal:'aal1'})).rows.length,0);});
 await save(db,ids.founder,'profile',ids.founder,0,{name:'Founder',job_title:'Studio lead'});
 assert.equal((await own(db,ids.founder,{aal:'aal1'})).id,ids.founder);
 await withVerifiedFactor(db,ids.founder,async()=>{await assert.rejects(own(db,ids.founder,{aal:'aal1'}),e=>e.code==='42501');assert.equal((await asUser(db,ids.founder,()=>db.query('select * from nam_member_profiles'),{aal:'aal1'})).rows.length,0);await assert.rejects(rpc(db,ids.founder,'nam_team_directory',[ids.w],{aal:'aal1'}),e=>e.code==='42501');});
 await db.query('update nam_memberships set active=false where workspace_id=$1 and user_id=$2',[ids.w,ids.sales]);
 await assert.rejects(own(db),e=>e.code==='42501');
 assert.equal((await db.query("select count(*)::int as n from nam_team_events where kind='profile' and target_user=$1",[ids.sales])).rows[0].n,1);
});

test('directory, department and history pages are bounded and reject malformed bounds',async t=>{
 const db=await database();t.after(()=>db.close());
 await db.query("insert into auth.users(id,email,email_confirmed_at) select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'member-'||n||'@synthetic.invalid',now() from generate_series(1,55) n");
 await db.query("insert into nam_memberships(workspace_id,user_id,name,role) select $1,('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic '||lpad(n::text,2,'0'),'sales' from generate_series(1,55) n",[ids.w]);
 const first=await rpc(db,ids.founder,'nam_team_directory',[ids.w,1]),second=await rpc(db,ids.founder,'nam_team_directory',[ids.w,2]);assert.equal(first.items.length,50);assert(first.hasMore);assert.equal(second.items.length,8);assert(!second.hasMore);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,58);
 for(const name of ['nam_team_directory','nam_team_departments','nam_team_history'])for(const page of [0,-1,100001])await assert.rejects(rpc(db,ids.founder,name,[ids.w,page]),e=>e.code==='22023');
});
