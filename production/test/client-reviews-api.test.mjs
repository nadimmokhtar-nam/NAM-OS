import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';
import {client,context,loadServerModule} from './support/runtime.mjs';

let db,dispatch,studio;
const uid='40000000-0000-4000-8000-000000000001',origin='http://127.0.0.1:3100';
const image=Buffer.from('Verified media fixture bytes'),digest=createHash('sha256').update(image).digest('hex');
before(async()=>{db=await database();({dispatchClientReviews:dispatch,dispatchStudioReviews:studio}=await loadServerModule('lib/api/client-reviews.ts'));await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,'client@review-test.invalid']);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[uid]);});
after(async()=>{await db?.close();});
async function rpc(user,name,args){const response=await client(db,user).rpc(name,args);if(response.error)throw response.error;return response.data;}
async function fixture(){
 const pid=await rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'API issued review',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:null});
 const did=await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did:null,expected_version:null,changes:{project_id:pid,title:'Issued camera',code:'INT-01',artist_id:ids.artist},retry_key:null});
 await rpc(ids.founder,'nam_save_client_access',{w:ids.w,pid,uid,expected_version:null,payload:{name:'API client',email:'client@review-test.invalid',active:true,can_approve:true},retry_key:randomUUID()});
 const rid=randomUUID();await db.query(`insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,storage_path,created_by,request_key,create_payload,verified_at)
 values($1,$2,$3,$4,1,'render.png','image/png',$5,$6,$6,20,10,$5,$6,$5,$6,'Private note','Briefing','ready',$7,$8,$9,'{}',now())`,[rid,ids.w,pid,did,image.length,digest,pid+'/'+rid,ids.artist,randomUUID()]);
 const qid=await rpc(ids.founder,'nam_issue_client_review',{w:ids.w,pid,payload:{title:'Approve material',message:'Please review.',items:[{deliverable_id:did,render_id:rid,expected_version:1}],recipients:[{user_id:uid,can_decide:true}],allow_download:true},retry_key:randomUUID()});
 const review=await rpc(uid,'nam_client_review_detail',{w:ids.w,qid});
 return {pid,did,rid,qid,iid:review.items[0].id};
}
function guest(user=uid){return {supabase:client(db,user),workspaceId:ids.w,userId:user,sessionId:user,name:'API client',csrf:'fixture',mfaRequired:false,mfaVerified:false,factors:[]};}
function request(path,method='GET',body,headers={}){return new Request(origin+'/api/client/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});}
async function call(f,path='',method='GET',body,headers={},storage){const suffix='reviews/'+f.qid+(path?'/'+path:'');return dispatch(guest(),['client',...suffix.split('?')[0].split('/')],request(suffix,method,body,headers),storage?{storage}:{});}
const media=(run=()=>new Blob([image],{type:'image/webp'}))=>({from(bucket){assert.equal(bucket,'nam-render-versions');return {async download(path){return {data:await run(path),error:null};}};}});

test('client API reads only issued metadata and saves a version-checked decision with a stable key',async()=>{
 const f=await fixture(),view=await call(f),data=await view.json();assert.equal(view.status,200);assert.equal(data.items[0].number,1);assert(!JSON.stringify(data).includes('Private note'));
 const response=await call(f,'items/'+f.iid+'/response','POST',{expectedVersion:0,decision:'accepted',message:'Agreed.'},{'Idempotency-Key':randomUUID()});assert.equal(response.status,201);assert.equal((await response.json()).version,1);
 await assert.rejects(call(f,'items/'+f.iid+'/response','POST',{expectedVersion:0,decision:'rejected',message:'Stale.'},{'Idempotency-Key':randomUUID()}),e=>e.status===409);
});

test('client media checks stored bytes and returns private preview headers and original download disposition',async()=>{
 const f=await fixture(),preview=await call(f,'items/'+f.iid+'/content','GET',undefined,{},media());assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'private, no-store');assert.equal(preview.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),image);
 const original=await call(f,'items/'+f.iid+'/content?variant=original','GET',undefined,{},media());assert.match(original.headers.get('content-disposition'),/^attachment;/);assert.equal(original.headers.get('content-type'),'image/png');
 await assert.rejects(call(f,'items/'+f.iid+'/content','GET',undefined,{},media(()=>new Blob(['substituted']))),e=>e.status===503);
});

test('project revocation during a private media read prevents the response from being returned',async()=>{
 const f=await fixture();
 const storage=media(async()=>{await rpc(ids.founder,'nam_save_client_access',{w:ids.w,pid:f.pid,uid,expected_version:1,payload:{name:'API client',email:'client@review-test.invalid',active:false,can_approve:true},retry_key:randomUUID()});return new Blob([image]);});
 await assert.rejects(call(f,'items/'+f.iid+'/content','GET',undefined,{},storage),e=>[403,404].includes(e.status));
});

test('review API rejects forged fields, unsafe routes, unsupported variants and missing retry identity',async()=>{
 const f=await fixture();
 await assert.rejects(call(f,'items/'+f.iid+'/response','POST',{expectedVersion:0,decision:'accepted',message:'',user_id:ids.founder},{'Idempotency-Key':randomUUID()}),e=>e.status===400);
 await assert.rejects(call(f,'items/'+f.iid+'/response','POST',{expectedVersion:0,decision:'accepted',message:''}),e=>e.status===400);
 await assert.rejects(call(f,'items/'+f.iid+'/content?variant=internal','GET',undefined,{},media()),e=>e.status===400);
 assert.equal(await dispatch(guest(),['tasks'],request('tasks')),null);
});

test('studio review pagination and details stay founder-only while assigned artists receive version-specific client feedback',async()=>{
 const f=await fixture(),founder=await context(db),artist=await context(db,ids.artist);
 const path=['projects',f.pid,'reviews'],req=new Request(origin+'/api/'+path.join('/'));
 const response=await studio(founder,path,req);assert.equal(response.status,200);assert.equal((await response.json()).total,1);
 await assert.rejects(studio(artist,path,req),e=>e.status===403);
 const feedback=await studio(artist,['renders',f.rid,'client-feedback'],new Request(origin+'/api/renders/'+f.rid+'/client-feedback'));assert.deepEqual(await feedback.json(),{items:[]});
});

test('a client cannot borrow another session identity to publish a decision',async()=>{
 const f=await fixture(),other=guest();other.sessionId=ids.founder;
 await assert.rejects(dispatch(other,['client','reviews',f.qid,'items',f.iid,'response'],request('reviews/'+f.qid+'/items/'+f.iid+'/response','POST',{expectedVersion:0,decision:'accepted',message:''},{'Idempotency-Key':randomUUID()})),e=>e.status===401);
});
