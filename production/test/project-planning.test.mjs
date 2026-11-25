import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';
import {client,context,loadServerModule} from './support/runtime.mjs';

let db,dispatch;
const bytes=Buffer.from('Verified project-cover derivative fixture'),digest=createHash('sha256').update(bytes).digest('hex');
before(async()=>{db=await database();({dispatchProjectPlanning:dispatch}=await loadServerModule('lib/api/project-planning.ts'));});
after(async()=>{await db?.close();});
async function rpc(user,name,args,options={}){const response=await client(db,user,options).rpc(name,args);if(response.error)throw response.error;return response.data;}
const denied=e=>['42501','P0002'].includes(e.code);
async function project(changes={}){return rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Planning / courtyard',lead_id:ids.founder,member_ids:[ids.artist],start_date:'2026-11-23',due_date:'2026-12-10',client_name:'QA Architecture',project_type:'Residential',location:'Paris',...changes},retry_key:randomUUID()});}
const detail=pid=>rpc(ids.founder,'nam_project_detail',{w:ids.w,pid});
const plan=(pid,user=ids.founder,include_archived=false)=>rpc(user,'nam_project_plan',{w:ids.w,pid,include_archived});
const save=(pid,payload,{id=null,version=null,key=randomUUID(),user=ids.founder}={})=>rpc(user,'nam_save_project_phase',{w:ids.w,pid,phase_id:id,expected_version:version,payload,retry_key:key});
async function render(pid,{owner=ids.founder}={}){
 const did=await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did:null,expected_version:null,changes:{project_id:pid,title:'PRIVATE IMAGE TITLE',code:'INT-01',artist_id:owner},retry_key:randomUUID()}),rid=randomUUID();
 await db.query(`insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,storage_path,created_by,request_key,create_payload,verified_at)
 values($1,$2,$3,$4,1,'cover.png','image/png',$5::bigint,$6,$6,20,10,$5::integer,$6,$5::integer,$6,'PRIVATE RENDER NOTE','Briefing','ready',$7,$8,$9,'{}',now())`,[rid,ids.w,pid,did,bytes.length,digest,pid+'/'+rid,owner,randomUUID()]);return {rid,did};
}
const setCover=async(pid,rid)=>rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:(await detail(pid)).version,changes:{cover_render_id:rid},retry_key:null});

test('shared project context preserves creation retries, validates date ranges and records edits in existing history',async()=>{
 const key=randomUUID(),changes={title:'Dated brief',client_name:'Studio client',project_type:'Interior',location:'Paris',start_date:'2026-11-23',due_date:'2026-12-10'};
 const args={w:ids.w,pid:null,expected_version:null,changes,retry_key:key},pid=await rpc(ids.founder,'nam_save_project',args);assert.equal(await rpc(ids.founder,'nam_save_project',args),pid);
 await assert.rejects(rpc(ids.founder,'nam_save_project',{...args,changes:{...changes,client_name:'Different client'}}),e=>e.code==='40001');
 assert.equal((await detail(pid)).client_name,'Studio client');
 await assert.rejects(rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{start_date:'2027-01-01'},retry_key:null}),e=>e.code==='23514');
 assert.equal((await detail(pid)).version,1);assert.equal((await detail(pid)).start_date,'2026-11-23');
 await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{location:'Lyon'},retry_key:null});assert.equal((await detail(pid)).location,'Lyon');
 assert.equal((await db.query('select count(*)::int n from nam_project_events where project_id=$1',[pid])).rows[0].n,2);
});

test('project phases share the plan while counts retain individual task visibility and no automatic task or image completion',async()=>{
 const pid=await project(),phase=await save(pid,{title:'Materials',production_stage:'Materials and lighting',start_date:'2026-11-24',end_date:'2026-11-27',status:'complete'});
 for(const owner of [ids.founder,ids.artist])await rpc(ids.founder,'nam_create_task',{w:ids.w,changes:{title:owner===ids.founder?'PRIVATE FOUNDER TASK':'Artist lighting',section:'projects',project_id:pid,production_stage:'Materials and lighting',owner_id:owner,status:'Todo'},retry_key:randomUUID()});
 const all=await plan(pid),own=await plan(pid,ids.artist);assert.equal(all.phases[0].tasks,2);assert.equal(own.phases[0].tasks,1);assert.equal(own.phases[0].completed,0);assert.equal(own.phases[0].status,'complete');assert.equal(own.task_scope,'assigned');
 assert(!JSON.stringify(own).includes('PRIVATE FOUNDER TASK'));assert.equal((await detail(pid)).overview.open_tasks,2);
 assert.equal((await rpc(ids.artist,'nam_project_detail',{w:ids.w,pid})).overview.open_tasks,1);
 await assert.rejects(plan(pid,ids.sales),denied);await assert.rejects(save(pid,{title:'Self-edit'},{id:phase,version:1,user:ids.artist}),denied);
 await assert.rejects(asUser(db,ids.artist,()=>db.query("update nam_project_phases set status='complete' where id=$1",[phase])),denied);
});

test('phase retries preserve one change event; stale changes and reused request identities cannot overwrite the saved plan',async()=>{
 const pid=await project(),key=randomUUID(),payload={title:'Camera sign-off',production_stage:'Camera approval',end_date:'2026-11-26'},id=await save(pid,payload,{key});
 assert.equal(await save(pid,payload,{key}),id);assert.equal((await plan(pid)).phases.length,1);
 await assert.rejects(save(pid,{...payload,title:'Different'},{key}),e=>e.code==='40001');
 const editKey=randomUUID(),change={note:'Camera dates agreed',status:'in_progress'};await save(pid,change,{id,version:1,key:editKey});await save(pid,change,{id,version:1,key:editKey});
 assert.equal((await plan(pid)).phases[0].version,2);assert.equal((await db.query('select count(*)::int n from nam_project_phase_events where phase_id=$1',[id])).rows[0].n,2);
 await assert.rejects(save(pid,{note:'Stale overwrite'},{id,version:1}),e=>e.code==='40001');assert.equal((await plan(pid)).phases[0].note,change.note);
});

test('phases archive and restore without deleting their dates, versions or events',async()=>{
 const pid=await project(),id=await save(pid,{title:'Optional animation',status:'cancelled',start_date:'2026-11-30',end_date:'2026-12-08'});
 await save(pid,{archived:true},{id,version:1});assert.equal((await plan(pid)).phases.length,0);let archived=await plan(pid,ids.founder,true);assert.equal(archived.phases[0].status,'cancelled');
 await save(pid,{archived:false},{id,version:2});assert.equal((await plan(pid)).phases[0].end_date,'2026-12-08');
 const current=await detail(pid);await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:current.version,changes:{archived:true},retry_key:null});
 await assert.rejects(save(pid,{title:'New phase'}),e=>e.code==='22023');assert.equal((await plan(pid)).phases.length,1);
});

test('invalid dates, forged fields, other projects and missing assurance never change phase records',async()=>{
 const pid=await project(),other=await project(),id=await save(pid,{title:'Briefing'});
 for(const payload of [{start_date:'2027-01-02',end_date:'2027-01-01'},{status:'approved'},{production_stage:'Unknown'},{position:0},{note:'x'.repeat(5001)},{workspace_id:ids.otherW}])await assert.rejects(save(pid,payload,{id,version:1}));
 await assert.rejects(save(other,{title:'Wrong project'},{id,version:1}),denied);assert.equal((await plan(pid)).phases[0].version,1);
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);
 try{await assert.rejects(plan(pid),denied);}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
});

test('a deliberate project cover shares only its chosen derivative with brief participants and respects immediate revocation',async()=>{
 const pid=await project(),other=await project(),{rid}=await render(pid);await setCover(pid,rid);
 assert.equal(await rpc(ids.artist,'nam_render_access',{w:ids.w,rid}),false);
 const ticket=await rpc(ids.artist,'nam_project_cover_media',{w:ids.w,pid,variant:'thumbnail'});assert.equal(ticket.path,pid+'/'+rid+'.thumbnail.webp');assert.equal(ticket.sha256,digest);assert(!JSON.stringify(ticket).includes('PRIVATE'));
 await assert.rejects(rpc(ids.artist,'nam_project_cover_media',{w:ids.w,pid,variant:'original'}),e=>e.code==='22023');await assert.rejects(setCover(other,rid),e=>e.code==='22023');
 assert.equal((await rpc(ids.artist,'nam_project_detail',{w:ids.w,pid})).overview.recent_images.length,0);
 const current=await detail(pid);await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:current.version,changes:{member_ids:[]},retry_key:null});
 await assert.rejects(rpc(ids.artist,'nam_project_cover_media',{w:ids.w,pid,variant:'preview'}),denied);await assert.rejects(plan(pid,ids.artist),denied);
});

const request=(pid,path,method='GET',body)=>new Request('https://nam.api-test.invalid/api/projects/'+pid+'/'+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
const storage=run=>({from(bucket){assert.equal(bucket,'nam-render-versions');return {download:async path=>({data:await run(path),error:null})};}});
test('planning API writes through the real RPC and rejects malformed fields, dates, page filters and missing expected versions',async()=>{
 const pid=await project(),ctx=await context(db),res=await dispatch(ctx,['projects',pid,'phases'],request(pid,'phases','POST',{changes:{title:'Client review',start_date:'2026-11-27',end_date:'2026-12-01'}}));assert.equal(res.status,201);const saved=await res.json();assert.equal(saved.plan.phases[0].title,'Client review');
 for(const [path,method,body] of [['phases','POST',{changes:{title:'Leap',end_date:'2026-02-30'}}],['phases','POST',{changes:{title:'Forge',user_id:ids.outsider}}],['phases/'+saved.id,'PATCH',{changes:{title:'Missing version'}}],['plan?archived=invalid','GET'],['cover?variant=original','GET']])await assert.rejects(dispatch(ctx,['projects',pid,...path.split('?')[0].split('/')],request(pid,path,method,body)),e=>e.status===400);
});
test('cover API verifies bytes, returns private headers and refuses a revoked participant after a slow storage read',async()=>{
 const pid=await project(),{rid}=await render(pid);await setCover(pid,rid);const ctx=await context(db,ids.artist),path=['projects',pid,'cover'];
 const response=await dispatch(ctx,path,request(pid,'cover'),{storage:storage(async()=>new Blob([bytes]))});assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-type'),'image/webp');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 await assert.rejects(dispatch(ctx,path,request(pid,'cover'),{storage:storage(async()=>new Blob(['x'.repeat(bytes.length)]))}),e=>e.status===503);
 await assert.rejects(dispatch(ctx,path,request(pid,'cover'),{storage:storage(async()=>{const p=await detail(pid);await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:p.version,changes:{member_ids:[]},retry_key:null});return new Blob([bytes]);})}),e=>e.status===404);
});

test('business export retains project planning and audit records within the same workspace',async()=>{
 const pid=await project(),id=await save(pid,{title:'Exported plan'}),exported=await rpc(ids.founder,'nam_export_business',{w:ids.w});assert.equal(exported.version,8);assert(exported.data.nam_project_phases.some(row=>row.id===id));assert(exported.data.nam_project_phase_events.some(row=>row.phase_id===id));assert(!Object.keys(exported.data).some(key=>key.startsWith('auth')));
});
