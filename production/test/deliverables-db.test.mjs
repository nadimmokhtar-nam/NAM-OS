import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {database,asUser,ids,grantFixtureAccess} from './database.mjs';
import {productionStages} from '../public/production-stages.js';
let db;const helper='20000000-0000-4000-8000-000000000006';
before(async()=>{db=await database();await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'helper@deliverables.invalid',now())",[helper]);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[helper]);await db.query("insert into nam_memberships(workspace_id,user_id,name,role,active) values($1,$2,'Second artist','freelancer',true)",[ids.w,helper]);await grantFixtureAccess(db,ids.w,helper);});
after(async()=>{await db?.close();});
const denied=error=>['42501','P0002'].includes(error.code);
async function rpc(user,name,args,options={aal:'aal1'}){return (await asUser(db,user,()=>db.query(`select to_jsonb(public.${name}(${args.map((_,index)=>'$'+(index+1)).join(',')})) as value`,args.map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value)),options)).rows[0].value;}
const project=()=>rpc(ids.founder,'nam_save_project',[ids.w,null,null,{title:'Camera registry project',lead_id:ids.founder,member_ids:[ids.artist,helper]},null]);
const create=(pid,changes={},key=null)=>rpc(ids.founder,'nam_save_deliverable',[ids.w,null,null,{project_id:pid,code:'INT-01',title:'Living room hero',artist_id:ids.artist,...changes},key]);
const detail=(user,did)=>rpc(user,'nam_deliverable_detail',[ids.w,did]);
const page=(user,pid,filters={})=>rpc(user,'nam_deliverable_page',[ids.w,pid,filters]);
const update=(user,did,version,changes)=>rpc(user,'nam_save_deliverable',[ids.w,did,version,changes,null]);
const work=(pid,did,owner=ids.artist)=>rpc(ids.founder,'nam_create_task',[ids.w,{title:'Prepare linked image work',section:'projects',project_id:pid,deliverable_id:did,owner_id:owner,production_stage:'Draft production'},null]);

test('the database and UI share the agreed production stages while historical task stages remain usable',async()=>{
 assert.deepEqual(await rpc(ids.founder,'nam_production_stages',[]),productionStages());const pid=await project();
 for(const [index,stage]of productionStages().entries()){
  const did=await create(pid,{code:'CAM-'+index,stage});assert.equal((await detail(ids.artist,did)).stage,stage);
  const task=await work(pid,did);const saved=await rpc(ids.founder,'nam_save_task',[ids.w,task.id,task.version,{production_stage:stage}]);assert.equal(saved.production_stage,stage);
 }
 const legacy=await rpc(ids.founder,'nam_create_task',[ids.w,{title:'Historical lighting work',section:'projects',project_id:pid,production_stage:'Lighting'},null]);
 assert.equal((await rpc(ids.founder,'nam_save_task',[ids.w,legacy.id,legacy.version,{description:'Historical phase preserved'}])).production_stage,'Lighting');
 await assert.rejects(create(pid,{code:'BAD',stage:'Approved'}),error=>error.code==='22023');
});

test('camera creation retries are idempotent and camera codes remain unique across archive history',async()=>{
 const pid=await project(),input={project_id:pid,code:'int-01',title:'First camera',artist_id:ids.artist};
 const a=await rpc(ids.founder,'nam_save_deliverable',[ids.w,null,null,input,'camera-create-retry-01']);
 assert.equal(await rpc(ids.founder,'nam_save_deliverable',[ids.w,null,null,input,'camera-create-retry-01']),a);
 assert.equal((await detail(ids.artist,a)).code,'INT-01');assert.equal((await detail(ids.artist,a)).history.length,1);
 await assert.rejects(rpc(ids.founder,'nam_save_deliverable',[ids.w,null,null,{...input,title:'Different request'},'camera-create-retry-01']),error=>error.code==='40001');
 await update(ids.founder,a,1,{archived:true});await assert.rejects(create(pid),error=>error.code==='23505');
 assert.equal((await page(ids.founder,pid)).total,0);assert.equal((await page(ids.founder,pid,{archived:true})).total,1);
 await update(ids.founder,a,2,{archived:false});assert.equal((await detail(ids.artist,a)).history.length,3);
});

test('a shared project brief never exposes another artists images or private task work',async()=>{
 const pid=await project(),a=await create(pid),b=await create(pid,{code:'INT-02',title:'Private second camera',artist_id:helper}),c=await create(pid,{code:'INT-03',artist_id:null});
 assert.deepEqual((await page(ids.artist,pid)).items.map(item=>item.id),[a]);assert.equal((await page(helper,pid)).total,1);
 await assert.rejects(detail(ids.artist,b),denied);await assert.rejects(detail(ids.artist,c),denied);
 const privateTask=await work(pid,b,ids.founder),sharedTask=await work(pid,b,ids.artist);
 const visible=await detail(ids.artist,b);assert.equal(visible.can_edit,false);assert.deepEqual(visible.tasks.map(task=>task.id),[sharedTask.id]);assert(!visible.tasks.some(task=>task.id===privateTask.id));
 await assert.rejects(update(ids.artist,b,1,{camera_notes:'Edit another artists brief'}),denied);
 await rpc(ids.founder,'nam_save_task',[ids.w,sharedTask.id,sharedTask.version,{archived:true}]);await assert.rejects(detail(ids.artist,b),denied);
});

test('the assigned artist can update stage and camera brief without changing delivery or assignment',async()=>{
 const pid=await project(),did=await create(pid);
 await update(ids.artist,did,1,{stage:'Camera approval',camera_notes:'Keep the agreed eye level.'});
 const saved=await detail(ids.artist,did);assert.equal(saved.version,2);assert.equal(saved.stage,'Camera approval');assert.equal(saved.camera_notes,'Keep the agreed eye level.');
 for(const changes of [{artist_id:helper},{title:'Renamed'},{code:'CAM-99'},{due_date:'2030-01-01'},{archived:true}])await assert.rejects(update(ids.artist,did,2,changes),denied);
 await assert.rejects(rpc(ids.artist,'nam_save_deliverable',[ids.w,null,null,{project_id:pid,code:'NEW',title:'Unapproved new camera'},null]),denied);
});

test('stale updates preserve the accepted fields, version and event history',async()=>{
 const pid=await project(),did=await create(pid);await update(ids.founder,did,1,{due_date:'2030-05-04'});
 await assert.rejects(update(ids.artist,did,1,{stage:'Revisions',camera_notes:'Stale overwrite'}),error=>error.code==='40001');
 const saved=await detail(ids.artist,did);assert.equal(saved.stage,'Briefing');assert.equal(saved.due_date,'2030-05-04');assert.equal(saved.camera_notes,'');assert.equal(saved.version,2);assert.equal(saved.history.length,2);
});

test('revoking a project or section immediately hides images while ordinary assigned task edits retain their association',async()=>{
 const pid=await project(),did=await create(pid),task=await work(pid,did);
 await rpc(ids.founder,'nam_save_project',[ids.w,pid,1,{member_ids:[helper]},null]);
 await assert.rejects(detail(ids.artist,did),denied);await assert.rejects(page(ids.artist,pid),denied);
 const saved=await rpc(ids.artist,'nam_save_task',[ids.w,task.id,task.version,{description:'My assigned work remains editable'}]);assert.equal(saved.deliverable_id,did);assert.equal(saved.project_id,pid);
 await rpc(ids.founder,'nam_save_project',[ids.w,pid,2,{member_ids:[ids.artist,helper]},null]);
 const grants=(await db.query("delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section='projects' returning *",[ids.w,ids.artist])).rows;
 try{await assert.rejects(detail(ids.artist,did),denied);}finally{for(const grant of grants)await db.query('insert into nam_section_grants(workspace_id,user_id,section,can_create) values($1,$2,$3,$4)',[grant.workspace_id,grant.user_id,grant.section,grant.can_create]);}
});

test('task links enforce the same project and clearing context is atomic',async()=>{
 const pid=await project(),other=await project(),did=await create(pid);await assert.rejects(work(other,did),error=>error.code==='22023');
 const task=await work(pid,did,ids.founder);
 const moved=await rpc(ids.founder,'nam_save_task',[ids.w,task.id,task.version,{section:'sales',project_id:null}]);assert.equal(moved.deliverable_id,null);assert.equal(moved.project_id,null);assert.equal(moved.production_stage,null);
 const assigned=await work(pid,did);await assert.rejects(rpc(ids.founder,'nam_save_task',[ids.w,assigned.id,assigned.version,{section:'sales',project_id:null}]),error=>['22023','42501'].includes(error.code));
 const retained=(await asUser(db,ids.artist,()=>db.query('select project_id,deliverable_id,version from nam_tasks where id=$1',[assigned.id]))).rows[0];assert.equal(retained.project_id,pid);assert.equal(retained.deliverable_id,did);assert.equal(retained.version,assigned.version);
});

test('archive and restore preserve history and existing links without granting new linked work',async()=>{
 const pid=await project(),did=await create(pid),task=await work(pid,did);await update(ids.founder,did,1,{archived:true});
 assert.equal((await detail(ids.artist,did)).tasks[0].id,task.id);await assert.rejects(work(pid,did),error=>error.code==='22023');
 await assert.rejects(update(ids.artist,did,2,{stage:'Delivery'}),error=>error.code==='22023');await update(ids.founder,did,2,{archived:false});
 await rpc(ids.founder,'nam_save_project',[ids.w,pid,1,{archived:true},null]);await assert.rejects(create(pid,{code:'NEW'}),error=>error.code==='22023');await assert.rejects(update(ids.artist,did,3,{stage:'Delivery'}),error=>error.code==='22023');
 assert.equal((await detail(ids.artist,did)).version,3);
});

test('paging, sorting and filters use complete authorized totals and stable record identities',async()=>{
 const pid=await project();await create(pid,{code:'C-03',title:'Zulu',stage:'Delivery',due_date:'2030-01-03'});await create(pid,{code:'C-01',title:'Alpha',stage:'Briefing',due_date:'2030-01-01',kind:'animation'});await create(pid,{code:'C-02',title:'Middle',stage:'Camera approval'});await create(pid,{code:'HIDDEN',artist_id:helper});
 const first=await page(ids.artist,pid,{pageSize:2,sort:'code'}),second=await page(ids.artist,pid,{pageSize:2,page:2,sort:'code'});assert.equal(first.total,3);assert.equal(first.hasMore,true);assert.equal(second.items.length,1);assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,3);
 assert.deepEqual((await page(ids.artist,pid,{sort:'stage'})).items.map(item=>item.stage),['Briefing','Camera approval','Delivery']);
 assert.equal((await page(ids.artist,pid,{kind:'animation'})).total,1);assert.equal((await page(ids.artist,pid,{stage:'Delivery'})).total,1);assert.equal((await page(ids.artist,pid,{search:'%'})).total,0);
 for(const filters of [{sort:'secret'},{pageSize:101},{stage:'Approved'},{unknown:true}])await assert.rejects(page(ids.artist,pid,filters),error=>error.code==='22023');
});

test('direct writes, cross-workspace identities and unverified assurance cannot bypass image access',async()=>{
 const pid=await project(),did=await create(pid);await assert.rejects(asUser(db,ids.artist,()=>db.query("update nam_deliverables set stage='Delivery' where id=$1",[did])),denied);
 await assert.rejects(create(pid,{code:'OTHER',artist_id:ids.outsider}),error=>error.code==='22023');await assert.rejects(detail(ids.outsider,did),denied);
 await assert.rejects(rpc(ids.artist,'nam_deliverable_detail',[ids.w,did],{aal:'aal1',sessionId:null}),denied);
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);
 try{await assert.rejects(create(pid,{code:'MFA'}),denied);assert.equal((await rpc(ids.founder,'nam_deliverable_detail',[ids.w,did],{aal:'aal2'})).id,did);}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
});

test('business export includes camera metadata, history and task associations without inventing image approval',async()=>{
 const pid=await project(),did=await create(pid),task=await work(pid,did);await rpc(ids.artist,'nam_save_task',[ids.w,task.id,task.version,{status:'Done'}]);
 assert.equal((await detail(ids.artist,did)).stage,'Briefing');
 const exported=await rpc(ids.founder,'nam_export_business',[ids.w]);assert.equal(exported.version,6);assert(exported.data.nam_deliverables.some(item=>item.id===did));assert(exported.data.nam_deliverable_events.some(item=>item.deliverable_id===did));assert.equal(exported.data.nam_tasks.find(item=>item.id===task.id).deliverable_id,did);assert.equal(exported.attachmentBytesIncluded,false);
});
