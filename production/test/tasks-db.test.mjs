import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const W='20000000-0000-0000-0000-000000000001',OTHER='20000000-0000-0000-0000-000000000002';
const F='10000000-0000-0000-0000-000000000001',S='10000000-0000-0000-0000-000000000002',A='10000000-0000-0000-0000-000000000003';
async function database(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);grant usage on schema auth to authenticated,anon,service_role;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;`);
 for(const file of ['202611240001_foundation.sql','202611240002_tasks.sql','202611240009_task_dates.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',[F,'founder@invalid.test',S,'sales@invalid.test',A,'artist@invalid.test']);
 await db.query('insert into nam_workspaces(id,name) values($1,$2),($3,$4)',[W,'Test',OTHER,'Other']);
 for(const [id,role]of[[F,'founder'],[S,'sales'],[A,'freelancer']])await db.query('insert into nam_memberships(workspace_id,user_id,name,role) values($1,$2,$3,$4)',[W,id,role,role]);
 return db;}
async function as(db,id,run,aal=id===F?'aal2':'aal1'){await db.exec('begin;set local role authenticated;');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',aal})]);try{const result=await run();await db.exec('commit');return result;}catch(error){await db.exec('rollback');throw error;}}
async function rpc(db,name,args){return(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})) as result`,args)).rows[0].result;}

test('PostgreSQL task policies and RPC workflows with actual role identities',async()=>{const db=await database();try{
 const day=(await db.query("select to_char(now() at time zone 'Europe/Paris','YYYY-MM-DD') as today")).rows[0].today;
 const input={title:'Assigned follow-up',section:'sales',owner_id:S,due_date:day};
 const task=await as(db,F,()=>rpc(db,'nam_create_task',[W,input,'same-create-key']));assert(task.id);assert.equal(task.version,1);
 const retry=await as(db,F,()=>rpc(db,'nam_create_task',[W,input,'same-create-key']));assert.equal(retry.id,task.id);
 await assert.rejects(as(db,F,()=>rpc(db,'nam_create_task',[W,{...input,title:'Changed'},'same-create-key'])),e=>e.code==='40001');
 await assert.rejects(as(db,F,()=>rpc(db,'nam_create_task',[OTHER,input,null])),e=>e.code==='42501');
 assert.equal((await as(db,A,()=>db.query('select * from nam_tasks'))).rows.length,0);
 await assert.rejects(as(db,A,()=>rpc(db,'nam_create_task',[W,{title:'Sales',section:'sales'},null])),e=>e.code==='42501');
 const own=await as(db,S,()=>db.query('select * from nam_tasks'));assert.equal(own.rows.length,1);
 const notification=await as(db,S,()=>db.query('select * from nam_notifications'));assert.equal(notification.rows[0].recipient_id,S);
 await as(db,S,()=>rpc(db,'nam_task_action',[W,task.id,'comment',{body:'Progress recorded'}]));
 const comments=await as(db,S,()=>db.query('select * from nam_task_comments'));assert.equal(comments.rows[0].author_id,S);
 await as(db,S,()=>rpc(db,'nam_task_action',[W,task.id,'subtask',{title:'Check the quotation'}]));
 await assert.rejects(as(db,S,()=>rpc(db,'nam_save_task',[W,task.id,1,{status:'Done'}])),e=>e.code==='40001');
 const done=await as(db,S,()=>rpc(db,'nam_save_task',[W,task.id,1,{status:'Done',confirmOpenSubtasks:true}]));assert.equal(done.status,'Done');assert.equal(done.version,2);assert(done.completed_at);
 await assert.rejects(as(db,S,()=>rpc(db,'nam_save_task',[W,task.id,1,{status:'Todo'}])),e=>e.code==='40001');
 await assert.rejects(as(db,S,()=>rpc(db,'nam_save_task',[W,task.id,2,{owner_id:F}])),e=>e.code==='42501');
 await assert.rejects(as(db,S,()=>db.query("update nam_memberships set role='founder'")),e=>e.code==='42501');
 await assert.rejects(as(db,S,()=>db.query("update nam_tasks set status='Todo'")),e=>e.code==='42501');
 const page=await as(db,F,()=>rpc(db,'nam_task_page',[W,{page:1,pageSize:1,search:'follow-up'}]));assert.equal(page.total,1);assert.equal(page.items[0].description,'');
 const stats=await as(db,F,()=>rpc(db,'nam_task_stats',[W]));assert.equal(stats.open,0);
 assert.equal((await as(db,F,()=>db.query('select * from nam_tasks'),'aal1')).rows.length,0);
 await as(db,F,()=>rpc(db,'nam_task_action',[W,task.id,'delete',{expectedVersion:2}]));assert.equal((await as(db,S,()=>db.query('select * from nam_tasks'))).rows.length,0);
 await as(db,F,()=>rpc(db,'nam_task_action',[W,task.id,'restore',{}]));assert.equal((await as(db,S,()=>db.query('select * from nam_tasks'))).rows.length,1);
 const reopened=await as(db,S,()=>rpc(db,'nam_save_task',[W,task.id,4,{status:'Todo'}]));assert.equal(reopened.completed_at,null);
 const first=await as(db,F,()=>rpc(db,'nam_process_reminders',[W]));const second=await as(db,F,()=>rpc(db,'nam_process_reminders',[W]));assert.equal(first,1);assert.equal(second,0);
 await as(db,S,()=>rpc(db,'nam_read_notifications',[W]));assert((await as(db,S,()=>db.query('select * from nam_notifications'))).rows.every(n=>n.read_at));
 await db.query('update nam_memberships set active=false where user_id=$1',[S]);assert.equal((await as(db,S,()=>db.query('select * from nam_tasks'))).rows.length,0);
 }finally{await db.close();}});

test('PostgreSQL rejects non-serializable task dates even through direct RPC',async()=>{const db=await database();try{
 const create=(due)=>as(db,F,()=>rpc(db,'nam_create_task',[W,{title:'Date boundary',section:'operations',due_date:due},null]));
 for(const date of ['infinity','-infinity','10000-01-01','0001-12-31 BC'])await assert.rejects(create(date),e=>e.code==='23514',`Rejected ${date}`);
 for(const date of ['0001-01-01','9999-12-31',null]){const task=await create(date);assert.equal(task.due_date,date);}
 const task=await create(null);
 for(const date of ['infinity','-infinity','10000-01-01','0001-12-31 BC'])await assert.rejects(as(db,F,()=>rpc(db,'nam_save_task',[W,task.id,1,{due_date:date}])),e=>e.code==='23514',`Update rejected ${date}`);
 const unchanged=(await db.query('select due_date,version from nam_tasks where id=$1',[task.id])).rows[0];assert.equal(unchanged.due_date,null);assert.equal(unchanged.version,1);
 }finally{await db.close();}});
