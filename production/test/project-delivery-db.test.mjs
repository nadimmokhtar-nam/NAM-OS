import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';

let db;
const clientId='40000000-0000-4000-8000-000000000001',viewerId='40000000-0000-4000-8000-000000000002',unselectedId='40000000-0000-4000-8000-000000000003';
const clients=[clientId,viewerId,unselectedId],original=Buffer.from('Verified immutable delivery fixture'),sha=createHash('sha256').update(original).digest('hex'),laterSha=createHash('sha256').update('A later verified original').digest('hex');
const denied=error=>['42501','P0002'].includes(error.code),conflict=error=>error.code==='40001';
before(async()=>{
 db=await database();
 for(const user of clients){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,user+'@delivery-test.invalid']);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[user]);}
});
after(async()=>{await db?.close();});

async function rpc(user,name,args,{aal='aal1',role='authenticated',sessionId=user}={}){
 const keys=Object.keys(args),values=keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]);
 return asUser(db,user,async()=>{const result=await db.query(`select to_jsonb(public.${name}(${keys.map((key,index)=>key+' => $'+(index+1)).join(',')})) data`,values);return result.rows[0].data;},{aal,role,sessionId});
}
async function readyRender(pid,did,{number=1,digest=sha}={}){
 const rid=randomUUID();
 // Seed only already verified database state. Real pixel decoding and private
 // Storage publication are covered by the render API/provider tests.
 await db.query(`insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,storage_path,created_by,request_key,create_payload,verified_at)
 values($1,$2,$3,$4,$5,'final-image.png','image/png',$6::bigint,$7,$7,100,60,80,$7,40,$7,'PRIVATE render note','Draft production','ready',$8,$9,$10,'{}',now())`,[rid,ids.w,pid,did,number,original.length,digest,pid+'/'+rid,ids.artist,randomUUID()]);
 return rid;
}
async function fixture({count=2,stages=[],owners=[]}={}){
 const pid=await rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Revision and delivery project',lead_id:ids.founder,member_ids:[ids.artist]},retry_key:randomUUID()}),images=[];
 for(let index=0;index<count;index++){
  const artist=owners[index]??ids.artist,did=await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did:null,expected_version:null,changes:{project_id:pid,code:'INT-'+String(index+1).padStart(2,'0'),title:'Client camera '+(index+1),artist_id:artist,stage:stages[index]||'Briefing',camera_notes:'PRIVATE production direction'},retry_key:randomUUID()});
  images.push({did,rid:await readyRender(pid,did),version:1,artist});
 }
 for(const user of clients)await rpc(ids.founder,'nam_save_client_access',{w:ids.w,pid,uid:user,expected_version:null,payload:{name:user===clientId?'Delivery client':user===viewerId?'Delivery viewer':'Unselected client',email:user+'@delivery-test.invalid',active:true,can_approve:user===clientId},retry_key:randomUUID()});
 return {pid,images};
}
const selection=image=>({deliverable_id:image.did,render_id:image.rid,expected_version:image.version});
const roundBody=(f,extra={})=>({title:'Round 1 corrections',brief:'Apply the agreed direction to the selected cameras.',due_date:'2026-12-12',items:f.images.map((image,index)=>({...selection(image),instruction:index===0?'Adjust the daylight.':'PRIVATE founder-only revision instruction'})),...extra});
const deliveryBody=(f,extra={})=>({title:'Final image delivery',message:'The issued files are ready to download.',items:f.images.map(selection),recipients:[clientId,viewerId],...extra});
const openRound=(f,payload=roundBody(f),{user=ids.founder,w=ids.w,key=randomUUID(),...options}={})=>rpc(user,'nam_open_revision_round',{w,pid:f.pid,payload,retry_key:key},options);
const issueDelivery=(f,payload=deliveryBody(f),{user=ids.founder,w=ids.w,key=randomUUID(),...options}={})=>rpc(user,'nam_issue_project_delivery',{w,pid:f.pid,payload,retry_key:key},options);
const roundDetail=(rid,user=ids.founder,options={})=>rpc(user,'nam_revision_round_detail',{w:ids.w,rid},options);
const deliveryDetail=(did,user=ids.founder,options={})=>rpc(user,'nam_project_delivery_detail',{w:ids.w,did},options);
const clientDetail=(qid,user=clientId,options={})=>rpc(user,'nam_client_review_detail',{w:ids.w,qid},options);
const imageRow=async did=>(await db.query('select * from nam_deliverables where id=$1',[did])).rows[0];
const roundItems=async rid=>(await db.query('select i.*,t.title,t.description,t.section,t.status,t.production_stage,t.project_id,t.owner_id,t.due_date,t.version from nam_project_revision_items i join nam_tasks t on t.id=i.task_id where i.round_id=$1 order by i.deliverable_id',[rid])).rows;
async function changeTask(tid,status){const task=(await db.query('select version from nam_tasks where id=$1',[tid])).rows[0];return rpc(ids.founder,'nam_save_task',{w:ids.w,task_id:tid,expected_version:task.version,changes:{status}});}
async function closeRound(rid,version=1,{user=ids.founder,w=ids.w,aal='aal1',sessionId=user}={}){return asUser(db,user,()=>db.query('select public.nam_close_revision_round($1,$2,$3)',[w,rid,version]),{aal,sessionId});}
async function cancelDelivery(did,version=1,{user=ids.founder,aal='aal1',sessionId=user}={}){return asUser(db,user,()=>db.query('select public.nam_cancel_project_delivery($1,$2,$3)',[ids.w,did,version]),{aal,sessionId});}
async function snapshot(pid){
 const result=await db.query(`select jsonb_build_object(
 'rounds',(select count(*) from nam_project_revision_rounds where project_id=$1),
 'round_items',(select count(*) from nam_project_revision_items i join nam_project_revision_rounds r on r.id=i.round_id where r.project_id=$1),
 'deliveries',(select count(*) from nam_project_deliveries where project_id=$1),
 'delivery_events',(select count(*) from nam_project_delivery_events where project_id=$1),
 'image_events',(select count(*) from nam_deliverable_events e join nam_deliverables d on d.id=e.deliverable_id where d.project_id=$1),
 'tasks',(select count(*) from nam_tasks where project_id=$1),
 'task_events',(select count(*) from nam_task_events e join nam_tasks t on t.id=e.task_id where t.project_id=$1),
 'task_keys',(select count(*) from nam_task_request_keys k join nam_tasks t on t.id=k.task_id where t.project_id=$1),
 'notifications',(select count(*) from nam_notifications n join nam_tasks t on t.id=n.task_id where t.project_id=$1),
 'requests',(select count(*) from nam_client_review_requests where project_id=$1),
 'issued_items',(select count(*) from nam_client_review_items where project_id=$1),
 'recipients',(select count(*) from nam_client_review_recipients where project_id=$1),
 'decisions',(select count(*) from nam_client_review_decisions e join nam_client_review_requests q on q.id=e.request_id where q.project_id=$1),
 'images',(select jsonb_agg(jsonb_build_object('id',id,'stage',stage,'version',version) order by id) from nam_deliverables where project_id=$1),
 'access',(select jsonb_agg(jsonb_build_object('user_id',user_id,'active',active,'can_approve',can_approve,'version',version) order by user_id) from nam_client_project_access where project_id=$1)
 ) state`,[pid]);return result.rows[0].state;
}
async function rejectsAtomically(f,run,predicate){const before=await snapshot(f.pid);await assert.rejects(run,predicate);assert.deepEqual(await snapshot(f.pid),before,'A rejected operation must retain tasks, stages, notifications, requests, recipients and existing grants');}

test('revision rounds create the actual central task for each assigned image once and retain exact retries',async()=>{
 const f=await fixture({owners:[ids.artist,ids.founder]}),body=roundBody(f),key=randomUUID(),rid=await openRound(f,body,{key}),items=await roundItems(rid);
 assert.equal(items.length,2);assert.equal(new Set(items.map(item=>item.task_id)).size,2);
 for(const item of items){const image=f.images.find(image=>image.did===item.deliverable_id),instruction=body.items.find(row=>row.deliverable_id===image.did).instruction;assert.equal(item.render_id,image.rid);assert.equal(item.owner_id,image.artist);assert.equal(item.description,instruction);assert.equal(item.instruction,instruction);assert.equal(item.project_id,f.pid);assert.equal(item.section,'projects');assert.equal(item.production_stage,'Revisions');assert.equal(item.status,'Todo');assert.equal(item.due_date,body.due_date);assert.equal((await imageRow(image.did)).stage,'Revisions');}
 const all=await rpc(ids.founder,'nam_task_page',{w:ids.w,filters:{project_id:f.pid}}),own=await rpc(ids.artist,'nam_task_page',{w:ids.w,filters:{project_id:f.pid}});assert.deepEqual(new Set(all.items.map(task=>task.id)),new Set(items.map(item=>item.task_id)));assert.equal(own.total,1);assert.equal(own.items[0].id,items.find(item=>item.owner_id===ids.artist).task_id);
 const saved=await snapshot(f.pid);assert.equal(await openRound(f,body,{key}),rid);assert.deepEqual(await snapshot(f.pid),saved);await rejectsAtomically(f,()=>openRound(f,{...body,title:'Changed retry'},{key}),conflict);
 const staff=await roundDetail(rid),artist=await roundDetail(rid,ids.artist);assert.equal(staff.scope,'studio');assert.equal(staff.items.length,2);assert.equal(artist.scope,'assigned');assert.equal(artist.items.length,1);assert(!JSON.stringify(artist).includes('PRIVATE founder-only'));
 const page=await rpc(ids.artist,'nam_revision_round_page',{w:ids.w,pid:f.pid,page:1});assert.equal(page.total,1);assert.equal(page.items[0].items,1);assert.equal(page.items[0].resolved,0);
});

test('stale image metadata or a superseded render rolls back every revision task, stage, notification and round record',async()=>{
 for(const stale of ['image','render']){
  const f=await fixture(),ordered=[...f.images].sort((a,b)=>a.did.localeCompare(b.did)),last=ordered.at(-1),body=roundBody(f);
  if(stale==='image')body.items.find(item=>item.deliverable_id===last.did).expected_version=999;
  else await readyRender(f.pid,last.did,{number:2,digest:laterSha});
  await rejectsAtomically(f,()=>openRound(f,body),conflict);
 }
});

test('revision selection rejects other projects, unassigned images and review identities outside the project',async()=>{
 const f=await fixture(),other=await fixture({count:1}),foreignReview=await rpc(ids.founder,'nam_issue_client_review',{w:ids.w,pid:other.pid,payload:{title:'Other review',message:'Review this project only.',allow_download:false,items:other.images.map(selection),recipients:[{user_id:clientId,can_decide:true}]},retry_key:randomUUID()});
 await rejectsAtomically(f,()=>openRound(f,roundBody(f,{items:[{...selection(other.images[0]),instruction:'Wrong project'}]})),denied);
 await rejectsAtomically(f,()=>openRound(f,roundBody(f,{review_request_id:foreignReview})),error=>error.code==='22023');
 await db.query('update nam_deliverables set artist_id=null where id=$1',[f.images[0].did]);await rejectsAtomically(f,()=>openRound(f),error=>error.code==='22023');
});

test('round closure requires every real task to be Done or Canceled and never changes image approvals or client decisions',async()=>{
 const f=await fixture(),rid=await openRound(f),items=await roundItems(rid);await rejectsAtomically(f,()=>closeRound(rid),conflict);
 await changeTask(items[0].task_id,'Done');await rejectsAtomically(f,()=>closeRound(rid),conflict);await changeTask(items[1].task_id,'Canceled');await rejectsAtomically(f,()=>closeRound(rid,99),conflict);
 await closeRound(rid);const closed=await roundDetail(rid);assert.equal(closed.status,'closed');assert.equal(closed.version,2);assert(closed.closed_at);assert.deepEqual(new Set(closed.items.map(item=>item.task_status)),new Set(['Done','Canceled']));
 for(const image of f.images)assert.equal((await imageRow(image.did)).stage,'Revisions');const after=await snapshot(f.pid);assert.equal(after.decisions,0);assert.equal(after.requests,0);assert.equal(after.deliveries,0);await closeRound(rid,1);assert.deepEqual(await snapshot(f.pid),after);
});

test('revision and delivery mutations deny other actors, tenants, revoked memberships and sessions, and elected MFA',async()=>{
 const f=await fixture({count:1}),final=await fixture({count:1,stages:['Final approval']}),rid=await openRound(f),item=(await roundItems(rid))[0];await changeTask(item.task_id,'Done');
 const beforeRound=await snapshot(f.pid),beforeDelivery=await snapshot(final.pid);
 const attempt=async options=>{await assert.rejects(openRound(f,roundBody(f),options),denied);await assert.rejects(closeRound(rid,1,options),denied);await assert.rejects(issueDelivery(final,deliveryBody(final),options),denied);};
 for(const user of [ids.artist,ids.sales,ids.outsider,ids.suspended,clientId])await attempt({user});await attempt({w:ids.otherW});await attempt({sessionId:randomUUID()});
 await db.query('update nam_memberships set active=false where workspace_id=$1 and user_id=$2',[ids.w,ids.founder]);try{await attempt({});}finally{await db.query('update nam_memberships set active=true where workspace_id=$1 and user_id=$2',[ids.w,ids.founder]);}
 await db.query('delete from auth.sessions where id=$1',[ids.founder]);try{await attempt({});}finally{await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.founder]);}
 const factor=randomUUID();await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')",[factor,ids.founder]);try{await attempt({aal:'aal1'});assert.deepEqual(await snapshot(f.pid),beforeRound);assert.deepEqual(await snapshot(final.pid),beforeDelivery);await closeRound(rid,1,{aal:'aal2'});assert.equal((await roundDetail(rid,ids.founder,{aal:'aal2'})).status,'closed');}finally{await db.query('delete from auth.mfa_factors where id=$1',[factor]);}
});

test('final delivery issues only explicitly selected recipients as view-only with pinned original downloads and one stage transition',async()=>{
 const f=await fixture({stages:['Final approval','Delivery']}),body=deliveryBody(f),key=randomUUID(),did=await issueDelivery(f,body,{key}),delivery=await deliveryDetail(did),qid=delivery.review_request_id;
 assert.equal(delivery.status,'issued');assert.equal(delivery.manifest.length,2);assert.deepEqual(new Set(delivery.recipients.map(row=>row.user_id)),new Set([clientId,viewerId]));
 const request=(await db.query('select purpose,allow_download from nam_client_review_requests where id=$1',[qid])).rows[0];assert.deepEqual(request,{purpose:'delivery',allow_download:true});
 const recipients=(await db.query('select user_id,can_decide from nam_client_review_recipients where request_id=$1 order by user_id',[qid])).rows;assert(recipients.every(row=>row.can_decide===false));
 for(const image of f.images){const row=await imageRow(image.did);assert.equal(row.stage,'Delivery');assert.equal(row.version,image===f.images[0]?2:1);const manifest=delivery.manifest.find(row=>row.deliverable_id===image.did);assert.equal(manifest.render_id,image.rid);assert.equal(manifest.version,1);assert.equal(manifest.sha256,sha);assert.equal(manifest.byte_size,original.length);}
 const saved=await snapshot(f.pid);assert.equal(saved.tasks,0);assert.equal(saved.decisions,0);assert.equal(saved.access.length,3);assert.equal(await issueDelivery(f,body,{key}),did);assert.deepEqual(await snapshot(f.pid),saved,'Retry must not repeat image stage writes, audit events, requests or recipient rows');await rejectsAtomically(f,()=>issueDelivery(f,{...body,message:'Changed retry'},{key}),conflict);
 for(const user of [clientId,viewerId]){const view=await clientDetail(qid,user);assert.equal(view.purpose,'delivery');assert.equal(view.allow_download,true);assert.equal(view.can_decide,false);assert(!JSON.stringify(view).includes('PRIVATE'));const media=await rpc(user,'nam_client_review_media',{w:ids.w,qid,iid:view.items[0].id,variant:'original'});assert.equal(media.mime,'image/png');assert.equal(media.sha256,sha);await assert.rejects(rpc(user,'nam_decide_client_review',{w:ids.w,qid,iid:view.items[0].id,expected_version:0,payload:{decision:'accepted',message:''},retry_key:randomUUID()}),denied);}
 await assert.rejects(clientDetail(qid,unselectedId),denied);const list=await rpc(clientId,'nam_client_review_list',{w:ids.w});assert.equal(list.find(row=>row.id===qid).purpose,'delivery');
 await rejectsAtomically(f,()=>openRound(f,roundBody(f,{review_request_id:qid})),error=>error.code==='22023');
});

test('a later verified upload cannot rewrite an issued final manifest, render hash, version, title or original media ticket',async()=>{
 const f=await fixture({count:1,stages:['Final approval']}),body=deliveryBody(f),key=randomUUID(),did=await issueDelivery(f,body,{key}),initial=await deliveryDetail(did),fingerprint=createHash('sha256').update(JSON.stringify(initial.manifest)).digest('hex'),qid=initial.review_request_id,view=await clientDetail(qid),iid=view.items[0].id;
 const newer=await readyRender(f.pid,f.images[0].did,{number:2,digest:laterSha});await db.query("update nam_deliverables set title='A later camera title',version=version+1 where id=$1",[f.images[0].did]);
 const unchanged=await deliveryDetail(did);assert.deepEqual(unchanged.manifest,initial.manifest);assert.equal(createHash('sha256').update(JSON.stringify(unchanged.manifest)).digest('hex'),fingerprint);assert.equal((await clientDetail(qid)).items[0].number,1);assert.equal((await clientDetail(qid)).items[0].title,view.items[0].title);const ticket=await rpc(clientId,'nam_client_review_media',{w:ids.w,qid,iid,variant:'original'});assert.equal(ticket.sha256,sha);assert(ticket.path.includes(f.images[0].rid));assert(!ticket.path.includes(newer));
 const saved=await snapshot(f.pid);assert.equal(await issueDelivery(f,body,{key}),did);assert.deepEqual(await snapshot(f.pid),saved);await rejectsAtomically(f,()=>issueDelivery(f,body),conflict);
 const current=await imageRow(f.images[0].did),next=await issueDelivery(f,deliveryBody(f,{items:[{deliverable_id:current.id,render_id:newer,expected_version:current.version}]})),latest=await deliveryDetail(next);assert.equal(latest.manifest[0].version,2);assert.equal(latest.manifest[0].sha256,laterSha);assert.equal(latest.manifest[0].render_id,newer);assert.deepEqual((await deliveryDetail(did)).manifest,initial.manifest);
});

test('invalid final stages, stale or unverified renders, duplicate selections and inactive recipients leave no partial issuance or grants',async()=>{
 const f=await fixture({stages:['Final approval','Final approval']}),last=[...f.images].sort((a,b)=>a.did.localeCompare(b.did)).at(-1),other=await fixture({count:1,stages:['Final approval']});
 await db.query("update nam_deliverables set stage='Briefing' where id=$1",[last.did]);await rejectsAtomically(f,()=>issueDelivery(f),error=>error.code==='22023');await db.query("update nam_deliverables set stage='Final approval' where id=$1",[last.did]);
 const stale=deliveryBody(f);stale.items.find(item=>item.deliverable_id===last.did).expected_version=999;await rejectsAtomically(f,()=>issueDelivery(f,stale),conflict);
 await readyRender(f.pid,last.did,{number:2,digest:laterSha});await rejectsAtomically(f,()=>issueDelivery(f),conflict);last.rid=(await db.query("select id from nam_render_versions where deliverable_id=$1 and status='ready' order by number desc limit 1",[last.did])).rows[0].id;
 const valid=deliveryBody(f),pending=randomUUID();await db.query("insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,file_name,mime,byte_size,expected_sha256,storage_path,created_by,request_key,create_payload) values($1,$2,$3,$4,'pending.png','image/png',100,$5,$6,$7,$8,'{}')",[pending,ids.w,f.pid,last.did,sha,f.pid+'/'+pending,ids.artist,randomUUID()]);
 await rejectsAtomically(f,()=>issueDelivery(f,{...valid,items:valid.items.map(item=>item.deliverable_id===last.did?{...item,render_id:pending}:item)}),error=>error.code==='22023');
 await rejectsAtomically(f,()=>issueDelivery(f,{...valid,items:other.images.map(selection)}),error=>['22023','P0002'].includes(error.code));await rejectsAtomically(f,()=>issueDelivery(f,{...valid,items:[valid.items[0],valid.items[0]]}),error=>error.code==='23505');
 await rejectsAtomically(f,()=>issueDelivery(f,{...valid,recipients:[]}),error=>error.code==='22023');await rejectsAtomically(f,()=>issueDelivery(f,{...valid,recipients:[clientId,randomUUID()]}),error=>error.code==='22023');await rejectsAtomically(f,()=>issueDelivery(f,{...valid,recipients:[clientId,clientId]}),error=>error.code==='23505');
 await db.query('update nam_client_project_access set active=false where project_id=$1 and user_id=$2',[f.pid,viewerId]);await rejectsAtomically(f,()=>issueDelivery(f,valid),error=>error.code==='22023');
 assert.equal((await snapshot(f.pid)).requests,0);assert.equal((await snapshot(f.pid)).recipients,0);assert.equal((await snapshot(f.pid)).deliveries,0);
});

test('final delivery reads and raw tables retain studio boundaries, and access revocation removes issued metadata and originals',async()=>{
 const f=await fixture({count:1,stages:['Final approval']}),did=await issueDelivery(f),delivery=await deliveryDetail(did),qid=delivery.review_request_id,iid=(await clientDetail(qid)).items[0].id;
 assert.equal((await rpc(ids.founder,'nam_project_delivery_page',{w:ids.w,pid:f.pid,page:1})).items[0].id,did);
 for(const user of [ids.artist,ids.sales,ids.outsider,clientId]){await assert.rejects(deliveryDetail(did,user),denied);await assert.rejects(rpc(user,'nam_project_delivery_page',{w:ids.w,pid:f.pid,page:1}),denied);for(const table of ['nam_project_deliveries','nam_project_delivery_events'])assert.equal((await asUser(db,user,()=>db.query('select id from '+table))).rows.length,0);}
 for(const table of ['nam_project_deliveries','nam_project_revision_items'])await assert.rejects(asUser(db,ids.founder,()=>db.query('delete from '+table)),error=>error.code==='42501');
 await db.query('update nam_client_project_access set active=false where project_id=$1 and user_id=$2',[f.pid,clientId]);await assert.rejects(clientDetail(qid),denied);await assert.rejects(rpc(clientId,'nam_client_review_media',{w:ids.w,qid,iid,variant:'original'}),denied);assert.equal((await clientDetail(qid,viewerId)).can_decide,false);
});

test('delivery cancellation revokes the issued download, preserves its manifest and audits both the delivery and legacy review paths once',async()=>{
 const f=await fixture({count:1,stages:['Final approval']}),did=await issueDelivery(f),delivery=await deliveryDetail(did),qid=delivery.review_request_id,iid=(await clientDetail(qid)).items[0].id;
 await rejectsAtomically(f,()=>cancelDelivery(did,99),conflict);await assert.rejects(cancelDelivery(did,1,{user:ids.artist}),denied);await cancelDelivery(did,1);const cancelled=await deliveryDetail(did);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.version,2);assert.deepEqual(cancelled.manifest,delivery.manifest);await assert.rejects(clientDetail(qid),denied);await assert.rejects(rpc(clientId,'nam_client_review_media',{w:ids.w,qid,iid,variant:'original'}),denied);
 const saved=await snapshot(f.pid);await cancelDelivery(did,1);assert.deepEqual(await snapshot(f.pid),saved);assert.equal((await db.query("select count(*)::integer n from nam_project_delivery_events where record_id=$1 and kind='delivery_cancelled'",[did])).rows[0].n,1);
 const current=await imageRow(f.images[0].did),next=await issueDelivery(f,deliveryBody(f,{items:[{...selection(f.images[0]),expected_version:current.version}]}));const later=await deliveryDetail(next);await rpc(ids.founder,'nam_close_client_review',{w:ids.w,qid:later.review_request_id,expected_version:1,next_status:'cancelled'});assert.equal((await db.query("select count(*)::integer n from nam_project_delivery_events where record_id=$1 and kind='delivery_cancelled'",[next])).rows[0].n,1);
});
