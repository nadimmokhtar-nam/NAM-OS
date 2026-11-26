import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';
import {client,context,loadServerModule} from './support/runtime.mjs';
let db,dispatch;
const bytes=Buffer.from('Verified laptop cover preview'),sha=createHash('sha256').update(bytes).digest('hex');
before(async()=>{db=await database();({dispatchProjectPlanning:dispatch}=await loadServerModule('lib/api/project-planning.ts'));});
after(async()=>{await db?.close();});
async function rpc(user,name,args){const r=await client(db,user).rpc(name,args);if(r.error)throw r.error;return r.data;}
const denied=e=>['42501','P0002'].includes(e.code);
const detail=pid=>rpc(ids.founder,'nam_project_detail',{w:ids.w,pid});
const project=()=>rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Laptop cover',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:randomUUID()});
async function file(pid,{visibility='project',archived=false,status='ready'}={}){
 const id=randomUUID();await db.query("insert into nam_project_resources(id,workspace_id,project_id,kind,title,visibility,archived,file_name,mime,byte_size,expected_sha256,sha256,storage_path,preview_size,preview_sha256,width,height,status,created_by) values($1,$2,$3,'file','Cover image',$4,$5,'cover.png','image/png',$6::bigint,$7,$7,$8,$6::integer,$7,20,10,$9,$10)",[id,ids.w,pid,visibility,archived,bytes.length,sha,pid+'/'+id,status,ids.founder]);return id;
}
const set=(pid,resource_id,{render_id=null,version=1,key=randomUUID(),user=ids.founder}={})=>rpc(user,'nam_set_project_cover',{w:ids.w,pid,expected_version:version,resource_id,render_id,retry_key:key});

test('a verified laptop cover shares its derivative with project participants without creating a production deliverable',async()=>{
 const pid=await project(),rid=await file(pid);await set(pid,rid);
 const p=await detail(pid);assert.equal(p.cover_resource_id,rid);assert.equal(p.cover_render_id,null);assert.equal(p.overview.images,0);
 const ticket=await rpc(ids.artist,'nam_project_cover_media',{w:ids.w,pid,variant:'thumbnail'});assert.equal(ticket.bucket,'nam-project-resources');assert.equal(ticket.path,pid+'/'+rid+'.preview.webp');assert.equal(ticket.sha256,sha);
 const listed=await rpc(ids.artist,'nam_project_list',{w:ids.w,include_archived:false});assert.equal(listed.find(p=>p.id===pid).has_cover,true);
});
test('wrong-project, Founder-only, archived and unfinished files cannot become a cover or change the project version',async()=>{
 const pid=await project(),other=await project(),candidates=[await file(other),await file(pid,{visibility:'founder'}),await file(pid,{archived:true}),await file(pid,{status:'pending'})];
 for(const rid of candidates)await assert.rejects(set(pid,rid),e=>e.code==='22023');
 assert.equal((await detail(pid)).version,1);assert.equal((await detail(pid)).cover_resource_id,null);
 const rid=await file(pid);await assert.rejects(set(pid,rid,{user:ids.artist}),denied);
 await assert.rejects(asUser(db,ids.artist,()=>db.query('update nam_projects set cover_resource_id=$1 where id=$2',[rid,pid])),denied);
});
test('cover commands retry exactly once and reject stale edits and reused command identities',async()=>{
 const pid=await project(),first=await file(pid),second=await file(pid),key=randomUUID();await set(pid,first,{key});await set(pid,first,{key});
 assert.equal((await detail(pid)).version,2);assert.equal((await db.query("select count(*)::int n from nam_project_events where project_id=$1 and changes?'cover_request_key'",[pid])).rows[0].n,1);
 await assert.rejects(set(pid,second,{key}),e=>e.code==='40001');await assert.rejects(set(pid,second),e=>e.code==='40001');
 assert.equal((await detail(pid)).cover_resource_id,first);
 await set(pid,null,{version:2});assert.equal((await detail(pid)).cover_resource_id,null);
});
test('changing file sharing or revoking project membership immediately removes cover media access',async()=>{
 const pid=await project(),rid=await file(pid);await set(pid,rid);
 await db.query("update nam_project_resources set visibility='founder' where id=$1",[rid]);
 await assert.rejects(rpc(ids.artist,'nam_project_cover_media',{w:ids.w,pid,variant:'preview'}),denied);
 assert.equal((await rpc(ids.artist,'nam_project_list',{w:ids.w,include_archived:false})).find(p=>p.id===pid).has_cover,false);
 await db.query("update nam_project_resources set visibility='project' where id=$1",[rid]);
 const p=await detail(pid);await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:p.version,changes:{member_ids:[]},retry_key:null});
 await assert.rejects(rpc(ids.artist,'nam_project_cover_media',{w:ids.w,pid,variant:'preview'}),denied);
});
test('cover API verifies laptop-preview bytes and rechecks access after storage returns',async()=>{
 const pid=await project(),rid=await file(pid);await set(pid,rid);const ctx=await context(db,ids.artist),url='https://nam.api-test.invalid/api/projects/'+pid+'/cover';
 const storage=run=>({from(bucket){assert.equal(bucket,'nam-project-resources');return {download:async()=>({data:await run(),error:null})};}});
 const response=await dispatch(ctx,['projects',pid,'cover'],new Request(url),{storage:storage(async()=>new Blob([bytes]))});assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 await assert.rejects(dispatch(ctx,['projects',pid,'cover'],new Request(url),{storage:storage(async()=>new Blob(['wrong bytes']))}),e=>e.status===503);
 await assert.rejects(dispatch(ctx,['projects',pid,'cover'],new Request(url),{storage:storage(async()=>{await db.query("update nam_project_resources set archived=true where id=$1",[rid]);return new Blob([bytes]);})}),e=>e.status===404);
});
test('the cover API enforces expected versions and a stable command key before saving a selected file',async()=>{
 const pid=await project(),rid=await file(pid),ctx=await context(db),key=randomUUID();
 const request=(body,withKey=true)=>new Request('https://nam.api-test.invalid/api/projects/'+pid+'/cover',{method:'PATCH',headers:{'Content-Type':'application/json',...(withKey?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
 const body={expectedVersion:1,resourceId:rid,renderId:null};
 for(const [input,withKey] of [[{...body,expectedVersion:0},true],[{...body,renderId:randomUUID()},true],[body,false]])await assert.rejects(dispatch(ctx,['projects',pid,'cover'],request(input,withKey)),e=>e.status===400);
 const res=await dispatch(ctx,['projects',pid,'cover'],request(body));assert.equal(res.status,200);assert.equal((await res.json()).cover_resource_id,rid);
 const retry=await dispatch(ctx,['projects',pid,'cover'],request(body));assert.equal((await retry.json()).version,2);
});
