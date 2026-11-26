import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {database,ids,asUser} from './database.mjs';
import {context,loadServerModule} from './support/runtime.mjs';
let db,dispatch,dispatchTasks,pid;
before(async()=>{db=await database();({dispatchDeliverables:dispatch}=await loadServerModule('lib/api/deliverables.ts'));({dispatchTasks}=await loadServerModule('lib/api/tasks.ts'));const ctx=await context(db);const result=await ctx.supabase.rpc('nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'API camera project',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:null});if(result.error)throw result.error;pid=result.data;});
after(async()=>{await db?.close();});
async function call(user,path,method='GET',body,headers={}){const ctx=await context(db,user),request=new Request('https://nam.invalid/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await dispatch(ctx,path.split('?')[0].split('/'),request);assert(result);return {status:result.status,body:await result.json()};}
let code=0;const create=(changes={},headers={})=>call(ids.founder,'projects/'+pid+'/deliverables','POST',{code:'API-'+(++code),title:'Living room API',artist_id:ids.artist,...changes},headers);

test('the real API creates and edits a typed deliverable through PostgreSQL and returns safe metadata',async()=>{
 const result=await create({code:' api-camera ',kind:'panorama',stage:'Camera approval',camera_notes:'The approved eye level.',due_date:'2030-12-01'});assert.equal(result.status,201);assert.equal(result.body.code,'API-CAMERA');assert.equal(result.body.kind,'panorama');assert.equal(result.body.stage,'Camera approval');assert.equal(result.body.request_key,undefined);assert.equal(result.body.create_payload,undefined);
 const saved=await call(ids.artist,'deliverables/'+result.body.id,'PATCH',{expectedVersion:1,changes:{stage:'Materials and lighting',camera_notes:'Retain the camera framing.'}});assert.equal(saved.body.version,2);assert.equal(saved.body.history.length,2);
});

test('identical create retries return the same camera and changed retry payloads conflict',async()=>{
 const body={code:'RETRY-API',title:'A repeatable camera request',artist_id:ids.artist};const headers={'Idempotency-Key':'deliverable-api-retry-01'};
 const a=await call(ids.founder,'projects/'+pid+'/deliverables','POST',body,headers),b=await call(ids.founder,'projects/'+pid+'/deliverables','POST',body,headers);assert.equal(a.body.id,b.body.id);
 await assert.rejects(call(ids.founder,'projects/'+pid+'/deliverables','POST',{...body,title:'Changed payload'},headers),error=>error.status===409&&error.code==='DELIVERABLE_CONFLICT');
 await assert.rejects(call(ids.founder,'projects/'+pid+'/deliverables','POST',body),error=>error.status===409&&error.code==='DELIVERABLE_DUPLICATE');
});

test('artist and sales endpoints cannot create or self-assign deliverables',async()=>{
 for(const user of [ids.artist,ids.sales])await assert.rejects(call(user,'projects/'+pid+'/deliverables','POST',{code:'NO',title:'No self grant'}),error=>error.status===403);
 const item=(await create()).body;await assert.rejects(call(ids.artist,'deliverables/'+item.id,'PATCH',{expectedVersion:1,changes:{artist_id:ids.founder}}),error=>error.status===403);
 await assert.rejects(call(ids.sales,'deliverables/'+item.id),error=>error.status===404);
});

test('validation rejects bad dates, unsupported stages, embedded fields and invalid paging before writes',async()=>{
 for(const changes of [{code:'<img>'},{kind:'photo'},{stage:'Approved'},{stage:123},{due_date:'2026-02-31'},{camera_notes:'a'.repeat(5001)},{project_id:ids.otherW},{artist_id:'someone'},{archived:'true'}])await assert.rejects(create(changes),error=>error.status===400);
 for(const query of ['page_size=101','archived=true','sort=secret','stage=Approved','owner=secret','search='+encodeURIComponent('a'.repeat(201))])await assert.rejects(call(ids.founder,'projects/'+pid+'/deliverables?'+query),error=>error.status===400);
 await assert.rejects(create({}, {'Idempotency-Key':'bad'}),error=>error.status===400);
});

test('API conflicts retain the accepted version and a separate explicit reload returns it',async()=>{
 const item=(await create()).body;await call(ids.founder,'deliverables/'+item.id,'PATCH',{expectedVersion:1,changes:{title:'Accepted founder direction'}});
 await assert.rejects(call(ids.artist,'deliverables/'+item.id,'PATCH',{expectedVersion:1,changes:{camera_notes:'Older draft'}}),error=>error.status===409);
 const reload=await call(ids.artist,'deliverables/'+item.id);assert.equal(reload.body.title,'Accepted founder direction');assert.equal(reload.body.camera_notes,'');assert.equal(reload.body.version,2);
});

test('task detail and central task pages retain one actual deliverable association',async()=>{
 const item=(await create()).body,ctx=await context(db),post=new Request('https://nam.invalid/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Linked API task',section:'projects',owner_id:ids.artist,project_id:pid,deliverable_id:item.id,production_stage:'Draft production'})});
 const response=await dispatchTasks(ctx,['tasks'],post);assert.equal(response.status,201);const task=await response.json();assert.equal(task.deliverable_id,item.id);assert.equal(task.deliverable.code,item.code);
 const actor=await context(db,ids.artist),page=await dispatchTasks(actor,['tasks'],new Request('https://nam.invalid/api/tasks?page=1&deliverable_id='+item.id));const tasks=await page.json();assert.equal(tasks.total,1);assert.equal(tasks.items[0].id,task.id);assert.equal(tasks.items[0].deliverable_code,item.code);
 const record=(await call(ids.artist,'deliverables/'+item.id)).body;assert.equal(record.tasks[0].id,task.id);
 await asUser(db,ids.founder,()=>db.query("select nam_save_project($1,$2,1,$3,null)",[ids.w,pid,JSON.stringify({member_ids:[]})]));
 const retained=await dispatchTasks(actor,['tasks',task.id],new Request('https://nam.invalid/api/tasks/'+task.id));const hidden=await retained.json();assert.equal(hidden.deliverable,null);assert.equal(hidden.deliverable_id,item.id);assert.equal(hidden.project,null);
 await asUser(db,ids.founder,()=>db.query("select nam_save_project($1,$2,2,$3,null)",[ids.w,pid,JSON.stringify({member_ids:[ids.artist]})]));
});

test('archive and restore use captured versions and preserve the real record identity',async()=>{
 const item=(await create()).body;const archived=await call(ids.founder,'deliverables/'+item.id,'PATCH',{expectedVersion:1,changes:{archived:true}});assert.equal(archived.body.archived,true);
 assert((await call(ids.founder,'projects/'+pid+'/deliverables?archived=1')).body.items.some(record=>record.id===item.id));
 const restored=await call(ids.founder,'deliverables/'+item.id,'PATCH',{expectedVersion:2,changes:{archived:false}});assert.equal(restored.body.id,item.id);assert.equal(restored.body.version,3);
});

test('the deliverable dispatcher leaves unrelated project and task routes to their existing owners',async()=>{
 const ctx=await context(db);for(const path of [['projects'],['projects',pid],['tasks'],['deliverables']])assert.equal(await dispatch(ctx,path,new Request('https://nam.invalid/api/'+path.join('/'))),null);
});
