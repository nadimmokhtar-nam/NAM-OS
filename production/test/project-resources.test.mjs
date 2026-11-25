import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {database,asUser,ids} from './database.mjs';
import {client,context,loadServerModule} from './support/runtime.mjs';

let db,dispatch;
before(async()=>{db=await database();({dispatchProjectResources:dispatch}=await loadServerModule('lib/api/project-resources.ts'));});
after(async()=>{await db?.close();});
const denied=error=>['42501','P0002'].includes(error.code);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function rpc(user,name,args,options={}){const result=await client(db,user,options).rpc(name,args);if(result.error)throw result.error;return result.data;}
const project=()=>rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Resource studio / courtyard',member_ids:[ids.artist]},retry_key:randomUUID()});
const save=(pid,payload,{rid=null,version=null,key=randomUUID(),user=ids.founder}={})=>rpc(user,'nam_save_project_resource',{w:ids.w,pid,rid,expected_version:version,payload,retry_key:key});
const page=(pid,filters={},user=ids.founder)=>rpc(user,'nam_project_resource_page',{w:ids.w,pid,filters});
const ticket=(rid,variant='upload',user=ids.founder)=>rpc(user,'nam_project_resource_ticket',{w:ids.w,rid,variant});
async function row(rid,user=ids.founder){const response=await client(db,user).from('nam_project_resources').select('id,project_id,parent_id,kind,title,visibility,document,reference_url,archived,version,file_name,mime,byte_size,status').eq('id',rid).maybeSingle();if(response.error)throw response.error;return response.data;}
async function file(pid,bytes,{mime='text/plain',name='Direction.txt',visibility='project'}={}){return save(pid,{kind:'file',title:name,file_name:name,mime,byte_size:bytes.length,sha256:digest(bytes),visibility});}
const request=(url,method='GET',body,key=randomUUID())=>new Request('https://nam.api-test.invalid/api'+url,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})});
async function invoke(ctx,url,method='GET',body,service,key){return dispatch(ctx,url.split('?')[0].split('/').filter(Boolean),request(url,method,body,key),{service,storageOrigin:'https://private-storage.invalid'});}
function provider(){
 const assets=new Map();
 const service={storage:{from(bucket){assert.equal(bucket,'nam-project-resources');return {
  async download(path){return assets.has(path)?{data:new Blob([assets.get(path)]),error:null}:{data:null,error:{code:'not_found'}};},
  async upload(path,bytes,options){if(assets.has(path))return {error:{code:'already_exists'}};await put(path,Buffer.from(bytes),options.contentType);return {error:null};},
 };}},async rpc(name,args){return client(db,ids.founder,{role:'service_role'}).rpc(name,args);}};
 async function put(path,bytes,mime){assets.set(path,Buffer.from(bytes));await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4) on conflict(bucket_id,name) do nothing',['nam-project-resources',path,ids.founder,JSON.stringify({size:bytes.length,mimetype:mime})]);}
 return {service,assets,put};
}

test('resources share explicit project content while keeping Founder-only notes and assigned task/image access separate',async()=>{
 const pid=await project(),shared=await save(pid,{kind:'meeting',title:'Client direction',document:{date:'2026-11-25',attendees:'Client and studio',agenda:'Materials',decisions:'Warm oak',actions:'Send samples'}}),secret=await save(pid,{kind:'note',title:'PRIVATE MARGIN',visibility:'founder',document:{body:'Internal fee discussion'}});
 const artist=await page(pid,{kind:'notes'},ids.artist);assert.equal(artist.items.length,1);assert.equal(artist.items[0].id,shared);assert(!JSON.stringify(artist).includes('PRIVATE'));
 assert.equal(await row(secret,ids.artist),null);await assert.rejects(save(pid,{title:'Self edit'},{rid:shared,version:1,user:ids.artist}),denied);await assert.rejects(page(pid,{},ids.sales),denied);
 await assert.rejects(asUser(db,ids.artist,()=>db.query("update nam_project_resources set visibility='project' where id=$1",[secret])),denied);
 await assert.rejects(asUser(db,ids.founder,()=>db.query('delete from nam_project_resource_events where resource_id=$1',[shared])),denied);
 await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{member_ids:[]},retry_key:null});await assert.rejects(page(pid,{},ids.artist),denied);
});

test('resource creation and edits retain exact retries, one immutable event per mutation and optimistic versions',async()=>{
 const pid=await project(),key=randomUUID(),payload={kind:'note',title:'Site notes',document:{body:'First visit'}},rid=await save(pid,payload,{key});assert.equal(await save(pid,payload,{key}),rid);
 await assert.rejects(save(pid,{...payload,title:'Different'},{key}),e=>e.code==='40001');const editKey=randomUUID(),change={document:{body:'Revised after site visit'}};
 await save(pid,change,{rid,version:1,key:editKey});await save(pid,change,{rid,version:1,key:editKey});assert.equal((await row(rid)).version,2);
 await assert.rejects(save(pid,{title:'Stale overwrite'},{rid,version:1}),e=>e.code==='40001');assert.equal((await row(rid)).document.body,change.document.body);
 assert.equal((await db.query('select count(*)::integer n from nam_project_resource_events where resource_id=$1',[rid])).rows[0].n,2);
 await save(pid,{archived:true},{rid,version:2});assert.equal((await page(pid,{kind:'notes'})).items.length,0);assert.equal((await page(pid,{kind:'notes',archived:true})).items[0].document,undefined);
 await save(pid,{archived:false},{rid,version:3});assert.equal((await row(rid)).document.body,change.document.body);
});

test('folders stay within a project and cannot contain themselves or form cycles; content visibility belongs to each resource',async()=>{
 const pid=await project(),other=await project(),folder=await save(pid,{kind:'folder',title:'Concept'}),nested=await save(pid,{kind:'folder',title:'Materials',parent_id:folder}),note=await save(pid,{kind:'note',title:'Oak',parent_id:nested,visibility:'founder'});
 assert.equal((await page(pid,{kind:'files',folder:nested})).items[0].id,note);assert.equal((await page(pid,{kind:'files',folder:nested},ids.artist)).items.length,0);
 await assert.rejects(save(pid,{parent_id:nested},{rid:folder,version:1}),e=>e.code==='22023');await assert.rejects(save(other,{kind:'note',title:'Wrong folder',parent_id:folder}),e=>e.code==='22023');
 await assert.rejects(save(pid,{visibility:'founder'},{rid:folder,version:1}),e=>e.code==='22023');await save(pid,{archived:true},{rid:nested,version:1});await assert.rejects(save(pid,{kind:'note',title:'Archived parent',parent_id:nested}),e=>e.code==='22023');
});

test('notes, meetings, pinboards and reference URLs validate at the database boundary before any event is committed',async()=>{
 const pid=await project();for(const payload of [
  {kind:'note',title:'Missing body',document:{}},{kind:'note',title:'Oversize',document:{body:'x'.repeat(30001)}},
  {kind:'meeting',title:'Invalid date',document:{date:'2026-02-30',attendees:'',agenda:'',decisions:'',actions:''}},
  {kind:'meeting',title:'Forged field',document:{date:'',attendees:'',agenda:'',decisions:'',actions:'',task_id:ids.outsider}},
  ...['javascript:alert(1)','http://example.com/','https://me:secret@example.com/','https://localhost/','https://127.0.0.1/','https://example.com:8443/'].map(reference_url=>({kind:'reference',title:'Unsafe',reference_url})),
  {kind:'board',title:'Forged board',document:{sections:[{id:randomUUID(),title:'One',items:[{id:randomUUID(),file_id:randomUUID(),caption:'',reference_url:''}]}]}}
 ])await assert.rejects(save(pid,payload),e=>['22023','23514'].includes(e.code));
 assert.equal((await page(pid)).total,0);const rid=await save(pid,{kind:'reference',title:'Supplier reference',reference_url:'https://example.com/specification?q=oak#finish'});assert.equal((await row(rid)).reference_url,'https://example.com/specification?q=oak#finish');
});

test('lists are bounded, searchable, sorted and private verification fields cannot be selected by authenticated users',async()=>{
 const pid=await project();for(let n=0;n<53;n++)await save(pid,{kind:'note',title:'Note '+String(n).padStart(2,'0')});const first=await page(pid,{kind:'notes'}),next=await page(pid,{kind:'notes',page:2});assert.equal(first.items.length,50);assert.equal(next.items.length,3);assert.equal(first.hasMore,true);assert.equal(next.hasMore,false);assert.equal(first.items[0].title,'Note 00');
 assert.equal((await page(pid,{kind:'notes',search:'Note 52'})).total,1);await assert.rejects(page(pid,{page:0}),e=>e.code==='22023');
 await assert.rejects(asUser(db,ids.founder,()=>db.query('select storage_path,expected_sha256 from nam_project_resources limit 1')),e=>e.code==='42501');
});

test('private file downloads are authenticated, fingerprint verified and recheck revocation after a storage read',async()=>{
 const pid=await project(),content=Buffer.from('Saved studio direction\n'),rid=await file(pid,content),storage=provider(),reserved=await ticket(rid);await storage.put(reserved.path,content,'text/plain');
 const founder=await context(db),finish=await invoke(founder,'/project-resources/'+rid+'/finish','POST',{expectedVersion:1},storage.service);assert.equal(finish.status,200);assert.equal((await row(rid)).status,'ready');
 const artist=await context(db,ids.artist),url='/project-resources/'+rid+'/content',response=await invoke(artist,url,'GET',undefined,storage.service);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(await response.text(),content.toString());
 assert.equal((await asUser(db,ids.artist,()=>db.query("select * from storage.objects where bucket_id='nam-project-resources'"))).rows.length,0);
});

test('Storage has no authenticated read or overwrite capability and exposes only the exact pending immutable write path',async()=>{
 const pid=await project(),content=Buffer.from('safe file'),rid=await file(pid,content),reserved=await ticket(rid);
 assert.equal(await rpc(ids.founder,'nam_project_resource_storage_insert',{object_path:reserved.path}),true);assert.equal(await rpc(ids.artist,'nam_project_resource_storage_insert',{object_path:reserved.path}),false);assert.equal(await rpc(ids.founder,'nam_project_resource_storage_insert',{object_path:reserved.path+'.preview.webp'}),false);
 await asUser(db,ids.founder,()=>db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4)',['nam-project-resources',reserved.path,ids.founder,JSON.stringify({size:content.length,mimetype:'text/plain'})]));
 const visible=await asUser(db,ids.founder,()=>db.query("select * from storage.objects where bucket_id='nam-project-resources'"));assert.equal(visible.rows.length,0);
 const overwritten=await asUser(db,ids.founder,()=>db.query("update storage.objects set metadata='{}' where bucket_id='nam-project-resources' returning name"));assert.equal(overwritten.rows.length,0);
 await assert.rejects(asUser(db,ids.founder,()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['nam-project-resources',reserved.path+'.other'])),e=>e.code==='42501');
});

test('image attestation decodes real pixels and ordered pinboards never broaden a private image to the team',async()=>{
 const pid=await project(),image=await sharp({create:{width:40,height:24,channels:3,background:'#968673'}}).png().toBuffer(),rid=await file(pid,image,{mime:'image/png',name:'Oak.png'}),privateId=await file(pid,image,{mime:'image/png',name:'Private.png',visibility:'founder'}),storage=provider(),ctx=await context(db);
 for(const id of [rid,privateId]){const reserved=await ticket(id);await storage.put(reserved.path,image,'image/png');await invoke(ctx,'/project-resources/'+id+'/finish','POST',{expectedVersion:1},storage.service);}
 const a=randomUUID(),b=randomUUID(),one=randomUUID(),two=randomUUID(),document={sections:[{id:a,title:'Materials',items:[{id:one,file_id:rid,caption:'Warm timber',reference_url:'https://example.com/finish'}]},{id:b,title:'Lighting',items:[{id:two,file_id:rid,caption:'Soft daylight',reference_url:''}]}]},board=await save(pid,{kind:'board',title:'Direction',document});
 const change={sections:[document.sections[1],document.sections[0]]};await save(pid,{document:change},{rid:board,version:1});assert.equal((await row(board,ids.artist)).document.sections[0].id,b);
 const leaked=structuredClone(document);leaked.sections[0].items[0].file_id=privateId;await assert.rejects(save(pid,{kind:'board',title:'Private image leak',document:leaked}),e=>e.code==='22023');
 const confidential=await save(pid,{kind:'board',title:'Internal board',visibility:'founder',document:leaked});assert.equal(await row(confidential,ids.artist),null);
 await assert.rejects(save(pid,{visibility:'project'},{rid:confidential,version:1}),e=>e.code==='22023');
 const preview=await invoke(await context(db,ids.artist),'/project-resources/'+rid+'/content?variant=preview','GET',undefined,storage.service);assert.equal(preview.headers.get('content-type'),'image/webp');assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width,40);
});

test('file verification rejects malformed source bytes, stale metadata and every forged browser attestation',async()=>{
 const pid=await project(),bytes=Buffer.from('not a complete image'),rid=await file(pid,bytes,{mime:'image/png',name:'Broken.png'}),storage=provider(),reserved=await ticket(rid),ctx=await context(db);await storage.put(reserved.path,bytes,'image/png');
 await assert.rejects(invoke(ctx,'/project-resources/'+rid+'/finish','POST',{expectedVersion:1},storage.service),e=>e.status===400);assert.equal((await row(rid)).status,'pending');
 await assert.rejects(rpc(ids.founder,'nam_attest_project_resource',{w:ids.w,rid,expected_version:1,verified_actor:ids.founder,verified_session:ids.founder,verified_aal2:false,evidence:{sha256:digest(bytes)},retry_key:randomUUID()}),e=>e.code==='42501');
 const text=Buffer.from('safe UTF-8\n'),textId=await file(pid,text),textTicket=await ticket(textId);await storage.put(textTicket.path,text,'text/plain');await save(pid,{visibility:'founder'},{rid:textId,version:1});
 await assert.rejects(invoke(ctx,'/project-resources/'+textId+'/finish','POST',{expectedVersion:1},storage.service),e=>e.status===409);assert.equal((await row(textId)).status,'pending');
});

test('API writes validate JSON, supported fields, filters, stable request identities and current session assurance',async()=>{
 const pid=await project(),ctx=await context(db),url='/projects/'+pid+'/resources',created=await invoke(ctx,url,'POST',{changes:{kind:'note',title:'API note',document:{body:'Saved through API'}}});assert.equal(created.status,201);const saved=await created.json();
 for(const [path,method,body] of [[url,'POST',{changes:{kind:'reference',title:'Credentials',reference_url:'https://a:b@example.com/'}}],[url,'POST',{changes:{kind:'note',title:'Forge',user_id:ids.outsider}}],[url+'/'+saved.id,'PATCH',{changes:{title:'Missing version'}}],[url+'?archived=maybe','GET'],[url+'?kind=unknown','GET'],['/project-resources/'+saved.id+'/content?variant=signed','GET']])await assert.rejects(invoke(ctx,path,method,body),e=>e.status===400);
 await assert.rejects(dispatch(ctx,['projects',pid,'resources'],new Request('https://nam.api-test.invalid/api'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes:{kind:'note',title:'Missing retry identity'}})})),e=>e.status===400);
 await db.query('delete from auth.sessions where id=$1',[ids.founder]);try{await assert.rejects(invoke(ctx,url,'POST',{changes:{kind:'note',title:'Ended session'}}),e=>e.status===403);}finally{await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.founder]);}
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);try{await assert.rejects(page(pid),denied);}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
});

test('signed write reservations are exact-retry safe, origin checked and never provide a Storage read capability',async()=>{
 const pid=await project(),content=Buffer.from('Reserved private file'),storage=provider(),key=randomUUID(),paths=[];
 let origin='https://wrong-storage.invalid';const userStorage={from(bucket){assert.equal(bucket,'nam-project-resources');return {async createSignedUploadUrl(path,options){paths.push(path);assert.equal(options.upsert,false);return {data:{signedUrl:origin+'/storage/v1/object/upload/sign/'+bucket+'/'+path+'?token=isolated-write-fixture'},error:null};}};}};
 const ctx=await context(db,ids.founder,{storage:userStorage}),url='/projects/'+pid+'/resources',body={changes:{kind:'file',title:'Original file',visibility:'founder',file_name:'Original.txt',mime:'text/plain',byte_size:content.length,sha256:digest(content)}};
 await assert.rejects(invoke(ctx,url,'POST',body,storage.service,key),e=>e.status===503);origin='https://private-storage.invalid';const response=await invoke(ctx,url,'POST',body,storage.service,key),plan=await response.json();assert.equal(plan.status,'pending');assert.equal(plan.sha256,digest(content));assert.equal(plan.fileName,'Original.txt');assert.equal(plan.uploaded,false);assert(plan.uploadUrl.includes('/upload/sign/'));assert.equal(paths[0],paths[1]);assert.equal((await page(pid)).total,1);
 assert(!Object.hasOwn(plan,'downloadUrl'));assert(!Object.hasOwn(plan,'readUrl'));await assert.rejects(invoke(ctx,'/project-resources/'+plan.id+'/content','GET',undefined,storage.service),e=>e.status===404);
});

test('media reads fail closed when a participant is removed during a slow storage download',async()=>{
 const pid=await project(),content=Buffer.from('Private until participant revocation'),rid=await file(pid,content),storage=provider(),reserved=await ticket(rid);await storage.put(reserved.path,content,'text/plain');await invoke(await context(db),'/project-resources/'+rid+'/finish','POST',{expectedVersion:1},storage.service);
 const read=storage.service.storage.from;storage.service.storage.from=bucket=>{const store=read(bucket);return {...store,async download(path){await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{member_ids:[]},retry_key:null});return store.download(path);}};};
 await assert.rejects(invoke(await context(db,ids.artist),'/project-resources/'+rid+'/content','GET',undefined,storage.service),e=>e.status===404);
});
