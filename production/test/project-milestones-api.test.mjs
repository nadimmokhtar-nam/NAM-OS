import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';
import {context,loadServerModule} from './support/runtime.mjs';
import {withVerifiedFactor} from './optional-mfa.mjs';

// The actual dispatcher executes against PostgreSQL/RLS in a disposable DB.
// Managed-provider HTTP and real project dates/records are never contacted.
let db,dispatch;
before(async()=>{db=await database();({dispatchProjectMilestones:dispatch}=await loadServerModule('lib/api/project-milestones.ts'));});
after(async()=>{await db?.close();});
const code=value=>error=>error.code===value;
async function rpc(user,name,args,options={}){return asUser(db,user,async()=>{const keys=Object.keys(args);return (await db.query(`select to_jsonb(public.${name}(${keys.map((key,i)=>key+' => $'+(i+1)).join(',')})) as data`,keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]))).rows[0].data;},options);}
async function project(){return rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Synthetic checkpoint project',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:randomUUID()});}
async function call(user,pid,rest='',method='GET',body,options={},headers={}){const route=['projects',pid,'milestones',...(rest.split('?')[0]?[rest.split('?')[0]]:[])],request=new Request('https://nam.invalid/api/projects/'+pid+'/milestones'+(rest?(rest.startsWith('?')?'':'/')+rest:''),{method,headers:{'content-type':'application/json','Idempotency-Key':randomUUID(),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const response=await dispatch(await context(db,user,options),route,request);assert(response);return {status:response.status,body:await response.json()};}
const create=(pid,changes={},headers={})=>call(ids.founder,pid,'','POST',{changes:{title:'Agreed camera checkpoint',target_date:'2027-01-15',note:'Synthetic shared note',...changes}},{},headers);
const edit=(pid,m,changes,headers={})=>call(ids.founder,pid,m.id,'PATCH',{expectedVersion:m.version,changes},{},headers);

test('project participants read real dated checkpoints; unrelated members and direct writes stay denied',async()=>{
 const pid=await project(),created=await create(pid);assert.equal(created.status,201);assert.equal(created.body.status,'pending');assert.equal(created.body.target_date,'2027-01-15');
 const artist=(await call(ids.artist,pid)).body;assert.equal(artist.items[0].id,created.body.id);assert.equal(artist.can_manage,false);assert(!('command_payload'in artist.items[0]));
 for(const user of [ids.sales,ids.suspended]){if(user===ids.suspended){await assert.rejects(rpc(user,'nam_project_milestones_page',{w:ids.w,pid}),code('P0002'));}else await assert.rejects(call(user,pid),error=>error.status===404);}
 await assert.rejects(call(ids.artist,pid,'','POST',{changes:{title:'Cannot self grant',target_date:'2027-01-01'}}),error=>error.status===403);
 assert.equal((await asUser(db,ids.sales,()=>db.query('select * from nam_project_milestones where project_id=$1',[pid]))).rows.length,0);
 await assert.rejects(asUser(db,ids.artist,()=>db.query("update nam_project_milestones set status='complete' where id=$1",[created.body.id])),code('42501'));
 await assert.rejects(asUser(db,ids.artist,()=>db.query('select request_key from nam_project_milestone_events')),code('42501'));
});

test('completion, cancellation and reopening retain audit state without changing tasks, images or the project version',async()=>{
 const pid=await project(),task=await rpc(ids.founder,'nam_create_task',{w:ids.w,changes:{title:'Independent task',section:'projects',owner_id:ids.artist,project_id:pid,status:'Todo'},retry_key:randomUUID()});let m=(await create(pid)).body;
 const before=(await db.query('select (select count(*) from nam_client_review_decisions) as decisions,(select count(*) from nam_render_versions) as renders,(select version from nam_projects where id=$1) as project_version',[pid])).rows[0];
 m=(await edit(pid,m,{status:'complete'})).body;assert.equal(m.completed_by,ids.founder);assert(m.completed_at);assert.equal(m.cancelled_at,null);
 m=(await edit(pid,m,{status:'pending'})).body;assert.equal(m.completed_at,null);assert.equal(m.completed_by,null);
 m=(await edit(pid,m,{status:'cancelled',note:'This checkpoint was explicitly cancelled.'})).body;assert(m.cancelled_at);assert.equal(m.cancelled_by,ids.founder);
 m=(await edit(pid,m,{status:'pending'})).body;assert.equal(m.cancelled_at,null);assert.equal(m.cancelled_by,null);assert.equal(m.target_date,'2027-01-15');assert.equal(m.version,5);
 const detail=(await call(ids.founder,pid,m.id)).body;assert.equal(detail.event_total,5);assert.equal(detail.events[0].before_state.status,'cancelled');assert.equal(detail.events[0].after_state.status,'pending');assert(detail.events.some(e=>e.after_state.status==='complete'));
 const artist=(await call(ids.artist,pid,m.id)).body;assert.deepEqual(artist.events,[]);assert.equal(artist.note,m.note);
 const after=(await db.query('select (select count(*) from nam_client_review_decisions) as decisions,(select count(*) from nam_render_versions) as renders,(select version from nam_projects where id=$1) as project_version',[pid])).rows[0];assert.deepEqual(after,before);
 assert.equal((await db.query('select status from nam_tasks where id=$1',[task.id])).rows[0].status,'Todo');
});

test('stable create/update retries produce one event and stale or changed payloads cannot overwrite accepted checkpoints',async()=>{
 const pid=await project(),headers={'Idempotency-Key':randomUUID()},created=(await create(pid,{},headers)).body,repeated=(await create(pid,{},headers)).body;assert.deepEqual(repeated,created);
 await assert.rejects(create(pid,{title:'A different request'},headers),error=>error.status===409);
 const edits={'Idempotency-Key':randomUUID()},first=(await edit(pid,created,{target_date:'2027-02-01'},edits)).body,repeat=(await edit(pid,created,{target_date:'2027-02-01'},edits)).body;assert.deepEqual(first,repeat);assert.equal(first.version,2);
 await assert.rejects(edit(pid,created,{note:'Stale note'}),error=>error.status===409);assert.equal((await call(ids.artist,pid,created.id)).body.target_date,'2027-02-01');assert.equal((await call(ids.founder,pid,created.id)).body.event_total,2);
});

test('date/status/search paging is bounded and uses actual ordered records',async()=>{
 const pid=await project();await create(pid,{title:'Third checkpoint',target_date:'2027-03-01'});await create(pid,{title:'First checkpoint',target_date:'2027-01-01'});await create(pid,{title:'Second checkpoint',target_date:'2027-02-01',status:'cancelled'});
 const a=(await call(ids.artist,pid,'?page_size=1')).body,b=(await call(ids.artist,pid,'?page_size=1&offset=1')).body;assert.equal(a.items[0].title,'First checkpoint');assert.equal(a.total,3);assert.equal(a.next_offset,1);assert.equal(b.items[0].title,'Second checkpoint');
 const range=(await call(ids.artist,pid,'?from=2027-02-01&to=2027-02-28&status=cancelled&search=second')).body;assert.equal(range.total,1);assert.equal(range.items[0].status,'cancelled');
 for(const query of ['page_size=101','page_size=1&page_size=2','offset=-1','status=approved','from=2027-02-30','from=2027-03-01&to=2027-01-01','owner='+ids.artist,'search='+encodeURIComponent('x'.repeat(201))])await assert.rejects(call(ids.founder,pid,'?'+query),error=>error.status===400);
 await assert.rejects(rpc(ids.artist,'nam_project_milestones_page',{w:ids.w,pid,filters:{page_size:1000}}),code('22023'));
});

test('malformed fields, missing versions, forged project relations and invalid dates leave the checkpoint unchanged',async()=>{
 const pid=await project(),other=await project(),m=(await create(pid)).body;
 for(const changes of [{target_date:null},{target_date:'2027-02-30'},{target_date:'0000-01-01'},{status:'approved'},{status:null},{title:''},{note:'x'.repeat(5001)},{project_id:other},{completed_by:ids.artist},{version:100}])await assert.rejects(edit(pid,m,changes),error=>error.status===400);
 await assert.rejects(call(ids.founder,pid,m.id,'PATCH',{changes:{title:'Missing saved version'}}),error=>error.status===400);
 await assert.rejects(call(ids.founder,other,m.id,'PATCH',{expectedVersion:1,changes:{note:'Wrong project'}}),error=>error.status===404);
 await assert.rejects(create(pid,{}, {'Idempotency-Key':'bad'}),error=>error.status===400);
 const actual=(await call(ids.artist,pid,m.id)).body;assert.equal(actual.version,1);assert.equal(actual.note,'Synthetic shared note');
});

test('archived projects retain readable checkpoints and reject mutation until the project is restored',async()=>{
 const pid=await project(),m=(await create(pid)).body;await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{archived:true},retry_key:null});
 const page=(await call(ids.artist,pid)).body;assert.equal(page.project_archived,true);assert.equal(page.items[0].id,m.id);assert.equal(page.can_manage,false);await assert.rejects(edit(pid,m,{status:'cancelled'}),error=>error.status===400);
 await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:2,changes:{archived:false},retry_key:null});assert.equal((await edit(pid,m,{status:'cancelled'})).body.status,'cancelled');
});

test('current membership/grants, opted-in MFA and managed sessions protect list/detail and the identity-pinned writer',async()=>{
 const pid=await project(),m=(await create(pid)).body;
 await withVerifiedFactor(db,ids.founder,async()=>{await assert.rejects(create(pid),error=>error.status===403);const ctx=await context(db,ids.founder,{aal:'aal2'});assert.equal(await ctx.supabase.rpc('nam_founder',{w:ids.w}).then(result=>result.data),true);});
 await assert.rejects(rpc(ids.founder,'nam_save_project_milestone',{w:ids.w,pid,mid:m.id,expected_version:1,changes:{status:'complete'},retry_key:randomUUID()},{sessionId:null}),code('42501'));
 await assert.rejects(rpc(ids.outsider,'nam_project_milestones_page',{w:ids.w,pid}),code('P0002'));
 await db.query("delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section='projects'",[ids.w,ids.artist]);try{await assert.rejects(call(ids.artist,pid),error=>error.status===404);}finally{await db.query("insert into nam_section_grants(workspace_id,user_id,section,can_create) values($1,$2,'projects',true)",[ids.w,ids.artist]);}
 await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{member_ids:[]},retry_key:null});await assert.rejects(call(ids.artist,pid,m.id),error=>error.status===404);
});

test('the dispatcher preserves unrelated project routes and reports unavailable transport without leaking its cause',async()=>{
 const pid=await project(),ctx=await context(db);for(const route of [['projects'],['projects',pid],['projects',pid,'plan'],['tasks']])assert.equal(await dispatch(ctx,route,new Request('https://nam.invalid/api/'+route.join('/'))),null);
 ctx.supabase.rpc=async()=>({data:null,error:{code:'ECONNRESET',message:'private database hostname'}});await assert.rejects(dispatch(ctx,['projects',pid,'milestones'],new Request('https://nam.invalid/api/projects/'+pid+'/milestones')),error=>error.status===503&&!error.message.includes('hostname'));
});
