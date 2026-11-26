import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {database,ids} from './database.mjs';
import {client,context,loadServerModule} from './support/runtime.mjs';

let db,dispatch,clientDispatch,providerCalls=0;
const uid='50000000-0000-4000-8000-000000000001',otherUid='50000000-0000-4000-8000-000000000002',origin='http://127.0.0.1:3100';
const bytes=Buffer.from('Verified final delivery API fixture'),digest=createHash('sha256').update(bytes).digest('hex');
before(async()=>{
 db=await database();
 for(const user of [uid,otherUid]){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,user+'@delivery-api.invalid']);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[user]);}
 // Capture the module's actual network boundary. Issuance must finish its real
 // database transaction without invoking an email or other provider request.
 const fetcher=globalThis.fetch;globalThis.fetch=async()=>{providerCalls++;throw Error('Delivery issuance must not send a provider request.');};
 try{({dispatchProjectDelivery:dispatch,dispatchClientDelivery:clientDispatch}=await loadServerModule('lib/api/project-delivery.ts'));}finally{globalThis.fetch=fetcher;}
});
after(async()=>{await db?.close();});
async function rpc(user,name,args,options={}){const result=await client(db,user,options).rpc(name,args);if(result.error)throw result.error;return result.data;}
async function fixture({stages=['Final approval']}={}){
 const pid=await rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'API final delivery',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:randomUUID()}),images=[];
 for(const [index,stage]of stages.entries()){
  const did=await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did:null,expected_version:null,changes:{project_id:pid,title:'Issued camera '+(index+1),code:'INT-'+String(index+1).padStart(2,'0'),artist_id:ids.artist,stage,camera_notes:'PRIVATE camera brief'},retry_key:randomUUID()}),rid=randomUUID();
  // Only already verified SQL state is seeded here. Stored pixel verification
  // remains exercised by the render API/provider tests.
  await db.query(`insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,storage_path,created_by,request_key,create_payload,verified_at)
  values($1,$2,$3,$4,1,'final-image.png','image/png',$5::bigint,$6,$6,100,60,80,$6,40,$6,'PRIVATE render note','Draft production','ready',$7,$8,$9,'{}',now())`,[rid,ids.w,pid,did,bytes.length,digest,pid+'/'+rid,ids.artist,randomUUID()]);images.push({deliverable_id:did,render_id:rid,expected_version:1});
 }
 for(const user of [uid,otherUid])await rpc(ids.founder,'nam_save_client_access',{w:ids.w,pid,uid:user,expected_version:null,payload:{name:user===uid?'Delivery API client':'Unselected API client',email:user+'@delivery-api.invalid',active:true,can_approve:true},retry_key:randomUUID()});
 return {pid,images};
}
const roundBody=f=>({title:'API revision round',brief:'Retain the approved direction.',due_date:'2026-12-12',items:f.images.map(image=>({...image,instruction:'Soften the daylight.'}))});
const deliveryBody=f=>({title:'API final files',message:'Download the issued originals.',items:f.images,recipients:[uid]});
function request(path,method='GET',body,{key=randomUUID(),headers={}}={}){return new Request(origin+'/api/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
const call=(ctx,path,method='GET',body,options={})=>dispatch(ctx,path.split('?')[0].split('/'),request(path,method,body,options));
function guest(user=uid,options={}){return {supabase:client(db,user,options),workspaceId:ids.w,userId:user,sessionId:user,name:'Delivery API client',csrf:'fixture',mfaRequired:false,mfaVerified:options.aal==='aal2',factors:[]};}
const clientCall=(ctx,qid,suffix='')=>clientDispatch(ctx,['client','reviews',qid,'manifest'],request('client/reviews/'+qid+'/manifest'+suffix));
async function counts(pid){return (await db.query(`select jsonb_build_object('rounds',(select count(*) from nam_project_revision_rounds where project_id=$1),'tasks',(select count(*) from nam_tasks where project_id=$1),'deliveries',(select count(*) from nam_project_deliveries where project_id=$1),'events',(select count(*) from nam_project_delivery_events where project_id=$1),'requests',(select count(*) from nam_client_review_requests where project_id=$1),'recipients',(select count(*) from nam_client_review_recipients where project_id=$1),'images',(select jsonb_agg(jsonb_build_object('id',id,'version',version,'stage',stage) order by id) from nam_deliverables where project_id=$1)) value`,[pid])).rows[0].value;}
function privateManifestHeaders(response){assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');assert.match(response.headers.get('content-disposition'),/^attachment; filename="NAM-final-delivery\.json"$/);assert.equal(response.headers.get('content-security-policy'),"sandbox; default-src 'none'");}
async function issued(f=undefined){f??=await fixture();const ctx=await context(db),response=await call(ctx,'projects/'+f.pid+'/deliveries','POST',deliveryBody(f));assert.equal(response.status,201);return {f,ctx,delivery:await response.json()};}

test('revision API returns real central task DTOs, preserves retry identities and closes only resolved tasks',async()=>{
 const f=await fixture({stages:['Briefing']}),ctx=await context(db),body=roundBody(f),key=randomUUID(),path='projects/'+f.pid+'/revisions',created=await call(ctx,path,'POST',body,{key}),round=await created.json();assert.equal(created.status,201);assert.equal(round.status,'open');assert.equal(round.items.length,1);assert.equal(round.items[0].instruction,'Soften the daylight.');
 const task=(await db.query('select id,project_id,deliverable_id,production_stage,owner_id,status from nam_tasks where id=$1',[round.items[0].task_id])).rows[0];assert.deepEqual(task,{id:round.items[0].task_id,project_id:f.pid,deliverable_id:f.images[0].deliverable_id,production_stage:'Revisions',owner_id:ids.artist,status:'Todo'});
 const before=await counts(f.pid),retry=await call(ctx,path,'POST',body,{key});assert.equal((await retry.json()).id,round.id);assert.deepEqual(await counts(f.pid),before);await assert.rejects(call(ctx,path,'POST',{...body,title:'Changed retry'},{key}),error=>error.status===409);
 assert.equal((await (await call(ctx,path)).json()).total,1);assert.equal((await (await call(ctx,'revision-rounds/'+round.id)).json()).items[0].task_id,task.id);assert.equal((await (await call(await context(db,ids.artist),'revision-rounds/'+round.id)).json()).scope,'assigned');
 await assert.rejects(call(ctx,'revision-rounds/'+round.id+'/close','POST',{expectedVersion:1}),error=>error.status===409);await rpc(ids.founder,'nam_save_task',{w:ids.w,task_id:task.id,expected_version:round.items[0].task_version,changes:{status:'Done'}});
 await assert.rejects(call(ctx,'revision-rounds/'+round.id+'/close','POST',{expectedVersion:99}),error=>error.status===409);const closed=await call(ctx,'revision-rounds/'+round.id+'/close','POST',{expectedVersion:1});assert.equal(closed.status,200);assert.equal((await closed.json()).status,'closed');assert.equal((await counts(f.pid)).deliveries,0);
});

test('project delivery API rejects forged fields, invalid dates, duplicate images or recipients and missing retry identities before creating work',async()=>{
 const f=await fixture(),ctx=await context(db),round=roundBody(f),delivery=deliveryBody(f),before=await counts(f.pid),roundPath='projects/'+f.pid+'/revisions',deliveryPath='projects/'+f.pid+'/deliveries';
 const invalidRounds=[{...round,workspace_id:ids.otherW},{...round,created_by:ids.artist},{...round,title:''},{...round,due_date:'2026-02-30'},{...round,due_date:'0000-01-01'},{...round,review_request_id:'not-a-record'},{...round,items:[round.items[0],round.items[0]]},{...round,items:[{...round.items[0],owner_id:ids.founder}]},{...round,items:[{...round.items[0],expected_version:0}]},{...round,items:[{...round.items[0],instruction:''}]}];
 for(const body of invalidRounds)await assert.rejects(call(ctx,roundPath,'POST',body),error=>error.status===400);
 const invalidDeliveries=[{...delivery,allow_download:false},{...delivery,email:'another@recipient.invalid'},{...delivery,recipients:[]},{...delivery,recipients:[uid,uid]},{...delivery,recipients:[{user_id:uid,can_decide:true}]},{...delivery,recipients:['not-a-record']},{...delivery,items:[delivery.items[0],delivery.items[0]]},{...delivery,items:[{...delivery.items[0],instruction:'Forged'}]}];
 for(const body of invalidDeliveries)await assert.rejects(call(ctx,deliveryPath,'POST',body),error=>error.status===400);
 for(const [path,body]of [[roundPath,round],[deliveryPath,delivery]]){await assert.rejects(call(ctx,path,'POST',body,{key:null}),error=>error.status===400);await assert.rejects(call(ctx,path,'POST',body,{key:'bad'}),error=>error.status===400);}
 for(const path of [roundPath+'?page=0',deliveryPath+'?unknown=1','projects/'+f.pid+'/round-images?final=2','projects/'+f.pid+'/round-images?search='+'x'.repeat(201)])await assert.rejects(call(ctx,path),error=>error.status===400);
 assert.deepEqual(await counts(f.pid),before);assert.equal(await dispatch(ctx,['tasks'],request('tasks')),null);
});

test('valid multi-image instructions exceed forty kilobytes while streamed round and final bodies remain bounded before writes',async()=>{
 const f=await fixture({stages:Array(9).fill('Draft production')}),ctx=await context(db),body=roundBody(f);for(const item of body.items)item.instruction='x'.repeat(5000);assert(Buffer.byteLength(JSON.stringify(body))>40000);
 const created=await call(ctx,'projects/'+f.pid+'/revisions','POST',body);assert.equal(created.status,201);assert.equal((await created.json()).items.length,9);assert.equal((await counts(f.pid)).tasks,9);
 const before=await counts(f.pid),encoded=new TextEncoder().encode(JSON.stringify({...body,brief:'x'.repeat(2100000+131072)}));let offset=0;
 const streamed=new ReadableStream({pull(controller){if(offset>=encoded.length){controller.close();return;}const next=Math.min(encoded.length,offset+16384);controller.enqueue(encoded.subarray(offset,next));offset=next;}}),path='projects/'+f.pid+'/revisions',incoming=new Request(origin+'/api/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:streamed,duplex:'half'});
 await assert.rejects(dispatch(ctx,path.split('/'),incoming),error=>error.status===413);await assert.rejects(call(ctx,'projects/'+f.pid+'/deliveries','POST',{...deliveryBody(f),message:'x'.repeat(64001)}),error=>error.status===413);assert.deepEqual(await counts(f.pid),before);
});

test('Founder-only mutations and image choices recheck revoked managed sessions and newly elected MFA',async()=>{
 const f=await fixture(),founder=await context(db),path='projects/'+f.pid+'/deliveries',before=await counts(f.pid);
 for(const user of [ids.artist,ids.sales]){const ctx=await context(db,user);await assert.rejects(call(ctx,path,'POST',deliveryBody(f)),error=>error.status===403);await assert.rejects(call(ctx,'projects/'+f.pid+'/revisions','POST',roundBody(f)),error=>error.status===403);await assert.rejects(call(ctx,'projects/'+f.pid+'/round-images'),error=>error.status===403);}
 await db.query('delete from auth.sessions where id=$1',[ids.founder]);try{await assert.rejects(call(founder,path,'POST',deliveryBody(f)),error=>error.status===403);}finally{await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.founder]);}
 const factor=randomUUID();await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')",[factor,ids.founder]);try{await assert.rejects(call(founder,path,'POST',deliveryBody(f)),error=>error.status===403);}finally{await db.query('delete from auth.mfa_factors where id=$1',[factor]);}
 assert.deepEqual(await counts(f.pid),before);
 const choices=await (await call(founder,'projects/'+f.pid+'/round-images?final=1&search=INT-01')).json();assert.equal(choices.total,1);assert.equal(choices.items[0].render_id,f.images[0].render_id);assert(!JSON.stringify(choices).includes('PRIVATE'));
});

test('final issuance returns real DTOs, private downloadable manifests and exact retries without sending provider email',async()=>{
 const f=await fixture(),ctx=await context(db),body=deliveryBody(f),path='projects/'+f.pid+'/deliveries',key=randomUUID(),response=await call(ctx,path,'POST',body,{key}),delivery=await response.json();assert.equal(response.status,201);assert.equal(delivery.status,'issued');assert.equal(delivery.manifest[0].sha256,digest);assert.equal(delivery.manifest[0].render_id,f.images[0].render_id);assert.equal(delivery.recipients[0].user_id,uid);assert.equal(providerCalls,0);
 const before=await counts(f.pid);assert.equal((await (await call(ctx,path,'POST',body,{key})).json()).id,delivery.id);assert.deepEqual(await counts(f.pid),before);await assert.rejects(call(ctx,path,'POST',{...body,message:'Changed retry'},{key}),error=>error.status===409);
 assert.equal((await (await call(ctx,path)).json()).items[0].id,delivery.id);assert.equal((await (await call(ctx,'final-deliveries/'+delivery.id)).json()).review_request_id,delivery.review_request_id);
 const manifest=await call(ctx,'final-deliveries/'+delivery.id+'/manifest');privateManifestHeaders(manifest);const exported=await manifest.json();assert.equal(exported.format,'NAM Studio final delivery');assert.deepEqual(exported.files,delivery.manifest);assert.equal(exported.status,'issued');assert.equal(providerCalls,0);
 await assert.rejects(call(await context(db,ids.artist),'final-deliveries/'+delivery.id+'/manifest'),error=>error.status===403);
});

test('client manifests include only selected immutable final-file facts and require the exact issued delivery recipient',async()=>{
 const {f,delivery}=await issued(),qid=delivery.review_request_id,response=await clientCall(guest(),qid);assert.equal(response.status,200);privateManifestHeaders(response);const manifest=await response.json();
 assert.deepEqual(Object.keys(manifest).sort(),['files','format','issued_at','project','title','version']);assert.equal(manifest.files.length,1);assert.deepEqual(Object.keys(manifest.files[0]).sort(),['byte_size','code','file_name','height','item_id','mime','sha256','title','version','width']);assert.equal(manifest.files[0].sha256,digest);assert.equal(manifest.files[0].version,1);assert.equal(manifest.files[0].file_name,'final-image.png');
 const serialized=JSON.stringify(manifest);for(const value of ['PRIVATE','storage_path','camera_notes',f.images[0].render_id,f.images[0].deliverable_id,uid+'@'])assert(!serialized.includes(value));
 await assert.rejects(clientCall(guest(otherUid),qid),error=>error.status===404);await assert.rejects(clientCall(guest(),randomUUID()),error=>error.status===404);await assert.rejects(clientCall(guest(),qid,'?internal=1'),error=>error.status===400);
 const row=(await db.query('select version from nam_deliverables where id=$1',[f.images[0].deliverable_id])).rows[0],review=await rpc(ids.founder,'nam_issue_client_review',{w:ids.w,pid:f.pid,payload:{title:'Ordinary review',message:'Review only.',allow_download:true,items:[{...f.images[0],expected_version:row.version}],recipients:[{user_id:uid,can_decide:true}]},retry_key:randomUUID()});await assert.rejects(clientCall(guest(),review),error=>error.status===404);
 const borrowed=guest();borrowed.sessionId=ids.founder;await assert.rejects(clientCall(borrowed,qid),error=>error.status===401);assert.equal(await clientDispatch(guest(),['tasks'],request('tasks')),null);
});

test('a permission revoke or cancellation after the first real manifest read prevents the client response',async()=>{
 for(const action of ['revoke','cancel']){
  const {f,ctx,delivery}=await issued(),clientCtx=guest(),execute=clientCtx.supabase.rpc.bind(clientCtx.supabase);let read=false;
  clientCtx.supabase.rpc=async(name,args)=>{const result=await execute(name,args);if(name==='nam_client_delivery_manifest'&&!read&&!result.error){read=true;if(action==='revoke')await db.query('update nam_client_project_access set active=false where project_id=$1 and user_id=$2',[f.pid,uid]);else{const response=await call(ctx,'final-deliveries/'+delivery.id+'/cancel','POST',{expectedVersion:1});assert.equal(response.status,200);assert.equal((await response.json()).status,'cancelled');}}return result;};
  await assert.rejects(clientCall(clientCtx,delivery.review_request_id),error=>[403,404].includes(error.status));assert.equal(read,true,'The fixture revokes access after actual authorized database data was read');await assert.rejects(clientCall(guest(),delivery.review_request_id),error=>[403,404].includes(error.status));
  if(action==='cancel'){const before=await counts(f.pid),retry=await call(ctx,'final-deliveries/'+delivery.id+'/cancel','POST',{expectedVersion:1});assert.equal((await retry.json()).status,'cancelled');assert.deepEqual(await counts(f.pid),before);assert.equal((await db.query("select count(*)::integer n from nam_project_delivery_events where record_id=$1 and kind='delivery_cancelled'",[delivery.id])).rows[0].n,1);}
 }
 assert.equal(providerCalls,0);
});
