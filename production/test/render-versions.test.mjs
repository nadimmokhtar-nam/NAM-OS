import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID,createHash} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';
import {client,context,loadServerModule,serial} from './support/runtime.mjs';

let db,dispatch,ApiError,prepareRender,bytes;
const origin='http://127.0.0.1:3111',objects=new Map(),uploads=new Map(),bucket='nam-render-versions';
const hash=b=>createHash('sha256').update(b).digest('hex');
before(async()=>{db=await database();({dispatchRenders:dispatch}=await loadServerModule('lib/api/renders.ts'));({ApiError}=await loadServerModule('lib/api/context.ts'));({prepareRender}=await loadServerModule('lib/api/render-media.ts'));bytes=await sharp({create:{width:100,height:60,channels:3,background:'#a48b77'}}).png().toBuffer();});
after(async()=>{await db?.close();});
const rpc=async(user,name,args,options={})=>{const result=await client(db,user,options).rpc(name,args);if(result.error)throw result.error;return result.data;};
function storage(user){return {from(name){assert.equal(name,bucket);return {
 async createSignedUploadUrl(path){if(objects.has(path))return {error:{statusCode:'409',code:'Duplicate'},data:null};const allowed=await rpc(user,'nam_render_storage_access',{object_path:path,operation:'insert'});if(!allowed)return {error:{code:'42501'},data:null};const key=randomUUID();uploads.set(key,{user,path});return {data:{signedUrl:origin+'/_fixture/upload/'+key},error:null};},
 async upload(path,content,{contentType}){try{await put(user,path,Buffer.from(content),contentType);return {data:{path},error:null};}catch(error){return {data:null,error};}},
 async download(path){try{const rows=await serial(db,()=>asUser(db,user,()=>db.query('select name from storage.objects where bucket_id=$1 and name=$2',[bucket,path])));const item=rows.rows.length?objects.get(path):null;return item?{data:new Blob([item.bytes],{type:item.mime}),error:null}:{data:null,error:{code:'42501'}};}catch(error){return {data:null,error};}},
 async remove(paths){try{for(const path of paths){const rows=await serial(db,()=>asUser(db,user,()=>db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,path])));if(rows.rows.length)objects.delete(path);}return {data:[],error:null};}catch(error){return {data:null,error};}},
 };}};}
async function put(user,path,content,mime){if(objects.has(path))throw Object.assign(Error('Immutable object'),{code:'23505'});await serial(db,()=>asUser(db,user,()=>db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4)',[bucket,path,user,JSON.stringify({size:content.length,mimetype:mime})])));objects.set(path,{bytes:Buffer.from(content),mime});}
async function attest(ctx,render,expectedVersion,evidence){try{return await rpc(null,'nam_attest_render',{w:ids.w,rid:render.id,expected_version:expectedVersion,verified_actor:ctx.user.id,verified_session:ctx.sessionId,verified_aal2:ctx.mfa.verified,verified_image:evidence},{role:'service_role'});}catch(error){throw new ApiError(error.code==='42501'?403:error.code==='40001'?409:400,'Isolated render attestation refused the action.');}}
async function call(user,path,method='GET',body,headers={},internal={attest,storageOrigin:origin}){const ctx=await context(db,user,{storage:storage(user)});return dispatch(ctx,path.split('?')[0].split('/'),new Request(origin+'/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),internal);}
async function fixture(){const pid=await rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Immutable render project',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:null});const did=await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did:null,expected_version:null,changes:{project_id:pid,code:'INT-01',title:'Living room hero',artist_id:ids.artist},retry_key:null});return {pid,did};}
const detail=did=>rpc(ids.founder,'nam_deliverable_detail',{w:ids.w,did});
async function reserve(did,{user=ids.artist,content=bytes,file_name='living-room.png',expectedVersion=1,note='First material pass',key=randomUUID()}={}){const response=await call(user,'deliverables/'+did+'/renders','POST',{expectedVersion,file_name,mime:'image/png',byte_size:content.length,sha256:hash(content),note},{'Idempotency-Key':key});assert.equal(response.status,201);return response.json();}
async function upload(plan,content=bytes){const entry=uploads.get(new URL(plan.uploadUrl).pathname.split('/').at(-1));await put(entry.user,entry.path,content,'image/png');}
async function finish(plan,expectedVersion=1,user=ids.artist){const response=await call(user,'renders/'+plan.id+'/finish','POST',{expectedVersion});assert.equal(response.status,200);return response.json();}
const denied=e=>['42501','P0002'].includes(e.code)||[403,404].includes(e.status);

test('actual image decoding produces bounded, oriented WebP previews while preserving original bytes',async()=>{
 const image=await prepareRender(bytes,'image/png');assert.equal(image.sha256,hash(bytes));assert.equal(image.width,100);assert.equal(image.height,60);assert.equal((await sharp(image.preview).metadata()).format,'webp');
 const rotated=await sharp({create:{width:80,height:40,channels:3,background:'#9b826d'}}).jpeg().withMetadata({orientation:6}).toBuffer(),oriented=await prepareRender(rotated,'image/jpeg');assert.equal(oriented.width,40);assert.equal(oriented.height,80);assert.equal((await sharp(oriented.preview).metadata()).width,40);assert.equal(oriented.sha256,hash(rotated));
 for(const data of [Buffer.from('<svg></svg>'),bytes.subarray(0,40),Buffer.alloc(80)])await assert.rejects(prepareRender(data,'image/png'),e=>e.status===400);
 await assert.rejects(prepareRender(bytes,'image/jpeg'),e=>e.status===400);
 const large=await sharp({create:{width:9000,height:9000,channels:3,background:'#fff'}}).png().toBuffer();await assert.rejects(prepareRender(large,'image/png'),e=>e.status===400);
});

test('the real API verifies stored originals and derivatives, then exposes one immutable numbered version',async()=>{
 const {pid,did}=await fixture(),plan=await reserve(did);assert.equal((await detail(did)).version,1);await upload(plan);const version=await finish(plan);
 assert.equal(version.number,1);assert.equal(version.status,'ready');assert.equal(version.width,100);assert.equal(version.storage_path,undefined);assert.equal((await detail(did)).version,2);
 const page=await (await call(ids.artist,'deliverables/'+did+'/renders')).json();assert.equal(page.total,1);assert.equal(page.pending.length,0);assert.equal(page.items[0].id,plan.id);
 const inventory=await rpc(ids.artist,'nam_deliverable_page',{w:ids.w,pid,filters:{}});assert.equal(inventory.items[0].latest_render_id,plan.id);assert.equal(inventory.items[0].render_total,1);
 for(const variant of ['preview','thumbnail','original']){const response=await call(ids.artist,'renders/'+plan.id+'/content?variant='+variant);assert.equal(response.headers.get('cache-control'),'private, no-store');const content=Buffer.from(await response.arrayBuffer());if(variant==='original'){assert.deepEqual(content,bytes);assert.match(response.headers.get('content-disposition'),/^attachment/);}else assert.equal((await sharp(content).metadata()).format,'webp');}
 const metadata=(await db.query('select * from nam_render_versions where id=$1',[plan.id])).rows[0];await assert.rejects(put(ids.artist,metadata.storage_path,bytes,'image/png'));
 await assert.rejects(serial(db,()=>asUser(db,ids.artist,()=>db.query('delete from nam_render_versions where id=$1',[plan.id]))),denied);
 await assert.rejects(call(ids.founder,'renders/'+plan.id+'/cancel','POST',{}),denied);
});

test('new versions retain earlier files, numbers, notes and feedback rather than overwriting them',async()=>{
 const {did}=await fixture(),a=await reserve(did);await upload(a);await finish(a);const b=await reserve(did,{expectedVersion:2,note:'Updated lighting'});await upload(b);await finish(b,2);
 const page=await (await call(ids.artist,'deliverables/'+did+'/renders')).json();assert.deepEqual(page.items.map(r=>r.number),[2,1]);assert.equal(page.items[1].note,'First material pass');assert.equal(page.items[0].note,'Updated lighting');
 assert.deepEqual(Buffer.from(await (await call(ids.artist,'renders/'+a.id+'/content?variant=original')).arrayBuffer()),bytes);
 const history=(await detail(did)).history;assert.equal(history.filter(e=>e.changes.render_version).length,2);assert.equal((await detail(did)).stage,'Briefing');
 const exported=await rpc(ids.founder,'nam_export_business',{w:ids.w});assert.equal(exported.version,7);assert.equal(exported.renderBytesIncluded,false);assert(exported.data.nam_render_versions.some(row=>row.id===a.id));
});

test('upload and feedback retries preserve identity and reject changed payloads',async()=>{
 const {did}=await fixture(),key=randomUUID(),a=await reserve(did,{key}),b=await reserve(did,{key});assert.equal(a.id,b.id);
 await assert.rejects(reserve(did,{key,note:'Changed request'}),e=>e.status===409);await upload(a);const ready=await finish(a);assert.equal((await finish(a)).id,ready.id);assert.equal((await detail(did)).version,2);
 const body={body:'Warm the timber without changing the framing.',point_x:0.25,point_y:0.5},headers={'Idempotency-Key':randomUUID()};await call(ids.artist,'renders/'+a.id+'/comments','POST',body,headers);await call(ids.artist,'renders/'+a.id+'/comments','POST',body,headers);
 const comments=await (await call(ids.artist,'renders/'+a.id+'/comments')).json();assert.equal(comments.total,1);assert.equal(Number(comments.items[0].point_x),0.25);
 await assert.rejects(call(ids.artist,'renders/'+a.id+'/comments','POST',{...body,body:'Changed feedback'},headers),e=>e.status===409);
});

test('a conflict retains uploaded bytes and only an explicit newer image version can finish them',async()=>{
 const {did}=await fixture(),a=await reserve(did);await upload(a);await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did,expected_version:1,changes:{camera_notes:'A newer agreed camera brief'},retry_key:null});
 await assert.rejects(finish(a),e=>e.status===409);assert.equal((await detail(did)).version,2);assert.equal((await (await call(ids.artist,'deliverables/'+did+'/renders')).json()).pending[0].id,a.id);
 const resume=await (await call(ids.artist,'renders/'+a.id+'/upload','POST',{})).json();
 assert.equal(resume.uploaded,true);assert.equal(resume.uploadUrl,undefined);assert.equal(resume.id,a.id);
 assert.equal((await finish(a,2)).number,1);assert.equal((await detail(did)).camera_notes,'A newer agreed camera brief');
});

test('bad or substituted stored bytes cannot be published and failed cleanup keeps quota reserved',async()=>{
 const {did}=await fixture(),a=await reserve(did);await upload(a,Buffer.alloc(bytes.length));await assert.rejects(finish(a),e=>e.status===409);assert.equal((await detail(did)).version,1);
 const meta=(await db.query('select * from nam_render_versions where id=$1',[a.id])).rows[0];await rpc(ids.artist,'nam_cancel_render',{w:ids.w,rid:a.id,phase:'prepare'});await assert.rejects(rpc(ids.artist,'nam_cancel_render',{w:ids.w,rid:a.id,phase:'complete'}),e=>e.code==='40001');
 await rpc(ids.artist,'nam_cancel_render',{w:ids.w,rid:a.id,phase:'failed'});assert.equal((await db.query('select cleanup_error from nam_render_versions where id=$1',[a.id])).rows[0].cleanup_error,true);
 await call(ids.artist,'renders/'+a.id+'/cancel','POST',{});assert(!objects.has(meta.storage_path));assert.equal((await (await call(ids.artist,'deliverables/'+did+'/renders')).json()).pending.length,0);
});

test('a matching fingerprint cannot turn malformed or active image content into a verified render',async()=>{
 const {did}=await fixture(),bad=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>invalid</script></svg>'),a=await reserve(did,{content:bad});await upload(a,bad);
 await assert.rejects(finish(a),e=>e.status===400);assert.equal((await detail(did)).version,1);assert.equal((await (await call(ids.artist,'deliverables/'+did+'/renders')).json()).total,0);
});

test('trusted attestation rechecks original session, account status and elected factors even on a saved version',async()=>{
 const {did}=await fixture(),a=await reserve(did);await upload(a);await finish(a);
 const evidence={sha256:hash(bytes)},args={w:ids.w,rid:a.id,expected_version:2,verified_actor:ids.artist,verified_session:ids.artist,verified_aal2:false,verified_image:evidence};
 await assert.rejects(rpc(null,'nam_attest_render',{...args,verified_session:ids.sales},{role:'service_role'}),denied);
 await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[ids.artist]);try{await assert.rejects(rpc(null,'nam_attest_render',args,{role:'service_role'}),denied);}finally{await db.query('update auth.users set banned_until=null where id=$1',[ids.artist]);}
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.artist]);try{await assert.rejects(rpc(null,'nam_attest_render',args,{role:'service_role'}),denied);assert.equal(await rpc(null,'nam_attest_render',{...args,verified_aal2:true},{role:'service_role'}),a.id);}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.artist]);}
});

test('revoked project access and assignment changes block pending uploads and verified render reads',async()=>{
 const {pid,did}=await fixture(),a=await reserve(did);await upload(a);await finish(a);await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{member_ids:[]},retry_key:null});
 for(const path of ['deliverables/'+did+'/renders','renders/'+a.id+'/content','renders/'+a.id+'/comments'])await assert.rejects(call(ids.artist,path),denied);
 await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:2,changes:{member_ids:[ids.artist]},retry_key:null});const b=await reserve(did,{expectedVersion:2});await upload(b);
 await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did,expected_version:2,changes:{artist_id:ids.founder},retry_key:null});await assert.rejects(finish(b,3),denied);assert.equal((await finish(b,3,ids.founder)).number,2);
});

test('shared image collaborators can read and give feedback without gaining upload, assignment or private task access',async()=>{
 const {pid,did}=await fixture();await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did,expected_version:1,changes:{artist_id:ids.founder},retry_key:null});const a=await reserve(did,{user:ids.founder,expectedVersion:2});await upload(a);await finish(a,2,ids.founder);
 await assert.rejects(call(ids.artist,'renders/'+a.id+'/content'),denied);await rpc(ids.founder,'nam_create_task',{w:ids.w,changes:{title:'Explicitly linked image work',section:'projects',project_id:pid,deliverable_id:did,owner_id:ids.artist},retry_key:null});
 assert.equal((await call(ids.artist,'renders/'+a.id+'/content')).status,200);await assert.rejects(reserve(did,{expectedVersion:3}),denied);
 assert.equal((await call(ids.artist,'renders/'+a.id+'/comments','POST',{body:'Reviewing the linked camera.'},{'Idempotency-Key':randomUUID()})).status,201);
 await assert.rejects(call(ids.sales,'renders/'+a.id+'/content'),denied);
});

test('pending slots, archived records, assurance and field validation cannot bypass the render boundary',async()=>{
 const {pid,did}=await fixture(),plans=[];for(let i=0;i<3;i++)plans.push(await reserve(did));await assert.rejects(reserve(did),e=>e.status===413);await call(ids.artist,'renders/'+plans[0].id+'/cancel','POST',{});await reserve(did);
 await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:1,changes:{archived:true},retry_key:null});await assert.rejects(reserve(did),denied);await rpc(ids.founder,'nam_save_project',{w:ids.w,pid,expected_version:2,changes:{archived:false},retry_key:null});
 const input={expectedVersion:1,file_name:'render.png',mime:'image/png',byte_size:bytes.length,sha256:hash(bytes)};
 for(const changes of [{file_name:'../file.png'},{mime:'image/svg+xml'},{byte_size:52428801},{sha256:'wrong'},{verified_actor:ids.founder}])await assert.rejects(call(ids.artist,'deliverables/'+did+'/renders','POST',{...input,...changes},{'Idempotency-Key':randomUUID()}),e=>[400,413].includes(e.status));
 await assert.rejects(call(ids.artist,'deliverables/'+did+'/renders','POST',input,{'Idempotency-Key':randomUUID()},{}),e=>e.status===503&&e.code==='CONFIGURATION_REQUIRED');
 await assert.rejects(rpc(ids.artist,'nam_attest_render',{w:ids.w,rid:plans[1].id,expected_version:1,verified_actor:ids.artist,verified_session:ids.artist,verified_aal2:false,verified_image:{}}),denied);
});
