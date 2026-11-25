import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';

let db;
const clientId='30000000-0000-4000-8000-000000000001',viewerId='30000000-0000-4000-8000-000000000002';
const hex='1'.repeat(64);
before(async()=>{
 db=await database();
 for(const uid of [clientId,viewerId]){
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,uid+'@client-test.invalid']);
  await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[uid]);
 }
});
after(async()=>{await db?.close();});
async function rpc(user,name,args,{aal='aal1',role='authenticated',sessionId=user}={}){
 const keys=Object.keys(args),values=keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);
 return asUser(db,user,async()=>{const r=await db.query(`select to_jsonb(public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')})) data`,values);return r.rows[0].data;},{aal,role,sessionId});
}
async function image(pid,code='INT-01'){
 const did=await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did:null,expected_version:null,changes:{project_id:pid,code,title:'Client-facing camera title',artist_id:ids.artist,camera_notes:'PRIVATE internal production direction'},retry_key:null});
 const rid=randomUUID();
 // This fixture seeds verified state as the database owner. Pixel decoding and
 // trusted publication remain covered by the real render API/provider tests.
 await db.query(`insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,storage_path,created_by,request_key,create_payload,verified_at)
 values($1,$2,$3,$4,1,'client-image.png','image/png',100,$5,$5,100,60,80,$5,40,$5,'PRIVATE internal render note','Draft production','ready',$6,$7,$8,'{}',now())`,[rid,ids.w,pid,did,hex,pid+'/'+rid,ids.artist,randomUUID()]);
 return {did,rid,selection:{deliverable_id:did,render_id:rid,expected_version:1}};
}
async function fixture(){
 const pid=await rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Shared review project',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:null});
 const a=await image(pid);
 for(const uid of [clientId,viewerId])await access(pid,uid,null,true,uid===clientId);
 return {pid,...a};
}
const access=(pid,uid,version,active,canApprove,key=randomUUID())=>rpc(ids.founder,'nam_save_client_access',{w:ids.w,pid,uid,expected_version:version,payload:{name:uid===clientId?'Review client':'View-only client',email:uid+'@client-test.invalid',active,can_approve:canApprove},retry_key:key});
const payload=(selection,extra={})=>({title:'Material review',message:'Please review the issued image.',allow_download:false,items:[selection],recipients:[{user_id:clientId,can_decide:true},{user_id:viewerId,can_decide:false}],...extra});
const issue=(f,body=payload(f.selection),key=randomUUID())=>rpc(ids.founder,'nam_issue_client_review',{w:ids.w,pid:f.pid,payload:body,retry_key:key});
const detail=(qid,user=clientId)=>rpc(user,'nam_client_review_detail',{w:ids.w,qid});
const respond=(qid,iid,version=0,body={decision:'accepted',message:''},key=randomUUID(),user=clientId)=>rpc(user,'nam_decide_client_review',{w:ids.w,qid,iid,expected_version:version,payload:body,retry_key:key});
const denied=e=>['42501','P0002'].includes(e.code);

test('client identities receive issued snapshots without studio membership, render notes or internal camera briefs',async()=>{
 const f=await fixture(),qid=await issue(f),review=await detail(qid);
 assert.equal(review.can_decide,true);assert.equal(review.items.length,1);assert.equal(review.items[0].number,1);
 assert.equal(review.items[0].title,'Client-facing camera title');assert(!JSON.stringify(review).includes('PRIVATE'));
 const identity=await rpc(clientId,'nam_client_identity',{w:ids.w});assert.equal(identity.id,clientId);
 for(const table of ['nam_tasks','nam_memberships','nam_render_versions','nam_render_comments','nam_projects','nam_client_contacts','nam_client_review_items']){
  try{const rows=await asUser(db,clientId,()=>db.query('select * from '+table));assert.equal(rows.rows.length,0,table+' must stay private');}catch(error){assert.equal(error.code,'42501',table+' must deny non-client columns');}
 }
 assert.equal((await detail(qid,viewerId)).can_decide,false);
 await assert.rejects(respond(qid,review.items[0].id,0,{decision:'accepted',message:''},randomUUID(),viewerId),denied);
});

test('issuing is idempotent, retains explicit versions and does not advance production stages',async()=>{
 const f=await fixture(),key=randomUUID(),body=payload(f.selection),qid=await issue(f,body,key);
 assert.equal(await issue(f,body,key),qid);assert.equal((await detail(qid)).number,1);
 await assert.rejects(issue(f,{...body,title:'Different review'},key),e=>e.code==='40001');
 const row=(await db.query('select stage,version from nam_deliverables where id=$1',[f.did])).rows[0];assert.equal(row.stage,'Briefing');assert.equal(row.version,1);
 const newer=randomUUID();
 await db.query(`insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,storage_path,created_by,request_key,create_payload,verified_at)
 select $1,workspace_id,project_id,deliverable_id,2,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,'A later private revision',stage,status,storage_path||'/next',created_by,$2,create_payload,now() from nam_render_versions where id=$3`,[newer,randomUUID(),f.rid]);
 await db.query('update nam_deliverables set version=2 where id=$1',[f.did]);
 assert.equal((await detail(qid)).items[0].number,1);
 const next=await issue(f,payload({...f.selection,render_id:newer,expected_version:2}));
 assert.equal((await detail(next)).items[0].number,2);assert.equal((await detail(next)).items[0].response,null);
});

test('responses keep immutable history, replay exactly and reject conflicting browser edits',async()=>{
 const f=await fixture(),qid=await issue(f),iid=(await detail(qid)).items[0].id,key=randomUUID();
 const first=await respond(qid,iid,0,{decision:'accepted',message:'Agreed daylight'},key);assert.equal(first.version,1);
 assert.deepEqual(await respond(qid,iid,0,{decision:'accepted',message:'Agreed daylight'},key),first);
 await assert.rejects(respond(qid,iid,0,{decision:'rejected',message:'Stale editor'}),e=>e.code==='40001');
 await assert.rejects(respond(qid,iid,1,{decision:'rejected',message:'Changed retry payload'},key),e=>e.code==='40001');
 const second=await respond(qid,iid,1,{decision:'rejected',message:'Please soften this material.'});assert.equal(second.version,2);
 assert.equal((await detail(qid)).items[0].response.decision,'rejected');
 assert.equal((await db.query('select count(*)::integer n from nam_client_review_decisions where item_id=$1',[iid])).rows[0].n,2);
 const feedback=await rpc(ids.artist,'nam_staff_client_feedback',{w:ids.w,rid:f.rid});assert.equal(feedback[0].client_name,'Review client');assert.equal(feedback[0].message,'Please soften this material.');assert(!JSON.stringify(feedback).includes('@'));
});

test('view-only recipients never gain decision rights through later project permission changes',async()=>{
 const f=await fixture(),qid=await issue(f),iid=(await detail(qid)).items[0].id;
 await access(f.pid,viewerId,1,true,true);
 assert.equal((await detail(qid,viewerId)).can_decide,false);
 await assert.rejects(respond(qid,iid,0,{decision:'accepted',message:''},randomUUID(),viewerId),denied);
});

test('revoking project access immediately denies metadata, media and responses while retaining history',async()=>{
 const f=await fixture(),qid=await issue(f),iid=(await detail(qid)).items[0].id;
 await respond(qid,iid);await access(f.pid,clientId,1,false,true);
 await assert.rejects(detail(qid),denied);
 await assert.rejects(rpc(clientId,'nam_client_review_media',{w:ids.w,qid,iid,variant:'preview'}),denied);
 await assert.rejects(respond(qid,iid,1),denied);
 assert.equal((await db.query('select count(*)::integer n from nam_client_review_decisions where item_id=$1',[iid])).rows[0].n,1);
});

test('disabling approval permission removes decisions without making a recipient lose read-only review',async()=>{
 const f=await fixture(),qid=await issue(f),iid=(await detail(qid)).items[0].id;
 await access(f.pid,clientId,1,true,false);assert.equal((await detail(qid)).can_decide,false);
 await assert.rejects(respond(qid,iid),denied);
});

test('closure freezes new responses and cancellation revokes the complete issued view',async()=>{
 const f=await fixture(),qid=await issue(f),iid=(await detail(qid)).items[0].id;
 const close=()=>rpc(ids.founder,'nam_close_client_review',{w:ids.w,qid,expected_version:1,next_status:'closed'});
 assert.equal((await close()).status,'closed');assert.equal((await close()).version,2);assert.equal((await detail(qid)).can_decide,false);
 await assert.rejects(respond(qid,iid),e=>['42501','40001'].includes(e.code));
 const second=await issue(f);await rpc(ids.founder,'nam_close_client_review',{w:ids.w,qid:second,expected_version:1,next_status:'cancelled'});
 await assert.rejects(detail(second),denied);
});

test('media exposes only the selected item and original downloads require explicit issuance permission',async()=>{
 const f=await fixture(),qid=await issue(f),iid=(await detail(qid)).items[0].id;
 const preview=await rpc(clientId,'nam_client_review_media',{w:ids.w,qid,iid,variant:'preview'});assert(preview.path.endsWith('.preview.webp'));
 await assert.rejects(rpc(clientId,'nam_client_review_media',{w:ids.w,qid,iid,variant:'original'}),denied);
 const downloadable=await issue(f,payload(f.selection,{allow_download:true})),diid=(await detail(downloadable)).items[0].id;
 assert.equal((await rpc(clientId,'nam_client_review_media',{w:ids.w,qid:downloadable,iid:diid,variant:'original'})).mime,'image/png');
 await assert.rejects(rpc(clientId,'nam_client_review_media',{w:ids.w,qid,iid:diid,variant:'preview'}),denied);
 await assert.rejects(rpc(clientId,'nam_client_review_media',{w:ids.otherW,qid,iid,variant:'preview'}),denied);
});

test('expired sessions, elected factors and banned accounts fail closed for clients',async()=>{
 const f=await fixture(),qid=await issue(f);
 await assert.rejects(rpc(clientId,'nam_client_review_detail',{w:ids.w,qid},{sessionId:randomUUID()}),denied);
 const factor=randomUUID();await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')",[factor,clientId]);
 await assert.rejects(detail(qid),denied);assert.equal((await rpc(clientId,'nam_client_review_detail',{w:ids.w,qid},{aal:'aal2'})).id,qid);
 await db.query('delete from auth.mfa_factors where id=$1',[factor]);await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[clientId]);
 await assert.rejects(detail(qid),denied);await db.query('update auth.users set banned_until=null where id=$1',[clientId]);
});

test('issue rejects wrong-project images, stale versions, duplicate items and forged decision privileges',async()=>{
 const f=await fixture(),other=await fixture();
 await assert.rejects(issue(f,payload(other.selection)),denied);
 await assert.rejects(issue(f,payload({...f.selection,expected_version:2})),e=>e.code==='40001');
 await assert.rejects(issue(f,payload(f.selection,{items:[f.selection,f.selection]})),e=>e.code==='23505');
 await assert.rejects(issue(f,payload(f.selection,{recipients:[{user_id:viewerId,can_decide:true}]})),e=>e.code==='22023');
 await assert.rejects(rpc(ids.artist,'nam_issue_client_review',{w:ids.w,pid:f.pid,payload:payload(f.selection),retry_key:randomUUID()}),denied);
});

test('client writes cannot bypass RPCs and privileged email lookup is server-only',async()=>{
 const f=await fixture(),qid=await issue(f),iid=(await detail(qid)).items[0].id;
 await assert.rejects(asUser(db,clientId,()=>db.query("update nam_client_project_access set can_approve=true where user_id=$1",[clientId])),e=>e.code==='42501');
 await assert.rejects(asUser(db,ids.founder,()=>db.query('delete from nam_client_review_items where id=$1',[iid])),e=>e.code==='42501');
 await assert.rejects(rpc(clientId,'nam_client_account_for_email',{address:clientId+'@client-test.invalid'}),e=>e.code==='42501');
 assert.equal(await rpc(null,'nam_client_account_for_email',{address:clientId+'@client-test.invalid'},{role:'service_role'}),clientId);
});
