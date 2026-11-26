import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';

// Real PostgreSQL data and RPCs, isolated from the hosted workspace. Seeded
// ready-render metadata is an export fixture, not a pixel-verification claim.
let db,main,other,hasHome=false;
const MAIN='NAM_MAIN_EXPORT',OTHER='OTHER_TENANT_SECRET',INTERNAL='INTERNAL_COMMAND_SENTINEL',BLOB='PRIVATE_STORAGE_BYTES_SENTINEL';
const credentials='a'.repeat(64),otherCredentials='b'.repeat(64),mediaHash='d'.repeat(64);
async function rpc(user,name,args,options={}){
 const keys=Object.keys(args),values=keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]);
 return asUser(db,user,async()=>{const result=await db.query(`select to_jsonb(public.${name}(${keys.map((key,index)=>'"'+key+'" => $'+(index+1)).join(',')})) data`,values);return result.rows[0].data;},options);
}
const key=()=>randomUUID();
const exportData=(user=ids.founder,w=ids.w,options={})=>rpc(user,'nam_export_business',{w},options);
const privateTables=['nam_task_request_keys','nam_task_schedule_requests','nam_learning_path_commands','nam_sales_followup_requests','nam_team_requests','nam_home_announcement_requests','nam_integration_state','nam_invitations','nam_identity_events','nam_password_setups','nam_job_payloads','users','sessions','mfa_factors','storage.objects','storage.buckets'];
const newBusinessTables=['nam_project_resources','nam_project_resource_events','nam_task_dependencies','nam_academy_topics','nam_course_topics','nam_course_version_topics','nam_learning_paths','nam_learning_path_topics','nam_learning_path_courses','nam_learning_path_assignments','nam_learning_path_assignment_courses','nam_learning_path_events','nam_sales_followup_links','nam_sales_revenue_targets','nam_sales_revenue_target_events','nam_departments','nam_member_profiles','nam_team_events','nam_project_revision_rounds','nam_project_revision_items','nam_project_deliveries','nam_project_delivery_events','nam_project_milestones','nam_project_milestone_events'];

async function seed(w,actor,learner,marker,credential){
 const pid=await rpc(actor,'nam_save_project',{w,pid:null,expected_version:null,changes:{title:marker+' project',lead_id:actor,member_ids:[]},retry_key:key()});
 const phase=await rpc(actor,'nam_save_project_phase',{w,pid,phase_id:null,expected_version:null,payload:{title:marker+' planned phase',start_date:'2026-11-25',end_date:'2026-12-15'},retry_key:key()});
 const resource=await rpc(actor,'nam_save_project_resource',{w,pid,rid:null,expected_version:null,payload:{kind:'note',title:marker+' direction',visibility:'founder',document:{body:marker+' retained business notes'}},retry_key:key()});
 const file=await rpc(actor,'nam_save_project_resource',{w,pid,rid:null,expected_version:null,payload:{kind:'file',title:marker+' original',visibility:'founder',file_name:marker+'.txt',mime:'text/plain',byte_size:32,sha256:mediaHash},retry_key:key()});
 const prerequisite=await rpc(actor,'nam_create_task',{w,changes:{title:marker+' prerequisite',section:'projects',project_id:pid,owner_id:actor},retry_key:key()}),task=await rpc(actor,'nam_create_task',{w,changes:{title:marker+' scheduled task',section:'projects',project_id:pid,owner_id:actor,due_date:'2026-12-01'},retry_key:key()});
 await rpc(actor,'nam_save_task_scheduling',{w,tid:task.id,expected_version:task.version,changes:{prerequisite_ids:[prerequisite.id],recurrence:{frequency:'weekly',interval:1,until:'2026-12-15'}},retry_key:key()});
 await db.query('insert into nam_task_comments(task_id,author_id,body) values($1,$2,$3)',[task.id,actor,marker+' child comment']);
 await db.query('insert into nam_task_subtasks(task_id,title) values($1,$2)',[task.id,marker+' child subtask']);

 let course=await rpc(actor,'nam_academy_admin',{w,op:'create',p_course_id:null,expected_revision:null,changes:{title:marker+' course',area:'3d',summary:marker+' learning content'}});
 course=await rpc(actor,'nam_academy_admin',{w,op:'lesson',p_course_id:course.id,expected_revision:course.revision,changes:{title:marker+' lesson',body:marker+' authored lesson'}});
 const classified=await rpc(actor,'nam_learning_path_command',{w,op:'classify',p_id:course.id,expected_revision:course.revision,changes:{topics:['onboarding']},command_key:key()});
 await rpc(actor,'nam_academy_admin',{w,op:'publish',p_course_id:course.id,expected_revision:classified.revision,changes:{}});
 const publication=(await db.query('select id from nam_course_versions where workspace_id=$1 and course_id=$2 order by version desc limit 1',[w,course.id])).rows[0].id,path=key();
 const createdPath=await rpc(actor,'nam_learning_path_command',{w,op:'create',p_id:path,expected_revision:null,changes:{title:marker+' learning path',summary:marker+' assigned curriculum',topics:['onboarding'],courses:[{course_id:course.id,publication_id:publication}]},command_key:key()});
 const assignment=await rpc(actor,'nam_learning_path_command',{w,op:'assign',p_id:path,expected_revision:createdPath.revision,changes:{member_id:learner,mandatory:true},command_key:key()});
 const lesson=(await db.query('select id from nam_lessons where workspace_id=$1 and course_version_id=$2',[w,publication])).rows[0].id;await rpc(learner,'nam_academy_progress',{w,l_id:lesson,mark_complete:true});

 await db.query("insert into nam_integration_state(workspace_id,source,status,credential_fingerprint,last_success_fingerprint,coverage) values($1,'attio','connected',$2,$2,$3)",[w,credential,JSON.stringify({private_worker_state:INTERNAL})]);
 const external=marker+'-lead';await db.query("insert into nam_integration_records(workspace_id,source,kind,external_id,external_owner_id,payload,credential_fingerprint) values($1,'attio','lead',$2,'fixture-owner',$3,$4)",[w,external,JSON.stringify({title:marker+' CRM contact'}),credential]);
 const followup=await rpc(actor,'nam_create_sales_followup',{w,s:'attio',k:'lead',ref:external,changes:{title:marker+' CRM follow-up'},retry_key:key(),source_fingerprint:credential});
 const target=await rpc(actor,'nam_set_sales_revenue_target',{w,payload:{owner_id:learner,period:'2026-11',currency:'EUR',amount:'12345.00',note:marker+' revenue objective'}});
 const activity=await rpc(learner,'nam_save_sales_activity',{w,activity_id:null,expected_version:null,payload:{type:'Research',context:marker+' sales context',outcome:marker+' researched',note:'',occurred_on:'2026-11-25'},p_request_key:key()});
 await db.query('update nam_sales_activities set request_fingerprint=$1 where id=$2',[INTERNAL,activity.id]);

 const department=await rpc(actor,'nam_save_team_metadata',{w,operation:'department',target_id:null,expected_version:0,payload:{name:marker+' department',archived:false},retry_key:key()});
 const profile=await rpc(actor,'nam_save_team_metadata',{w,operation:'member_department',target_id:learner,expected_version:0,payload:{department_id:department.id},retry_key:key()});
 await rpc(learner,'nam_save_team_metadata',{w,operation:'profile',target_id:learner,expected_version:profile.revision,payload:{name:marker+' colleague',job_title:marker+' professional title'},retry_key:key()});

 async function image(code,stage){
  const did=await rpc(actor,'nam_save_deliverable',{w,did:null,expected_version:null,changes:{project_id:pid,title:marker+' '+code,code,artist_id:actor,stage},retry_key:key()}),rid=key();
  await db.query(`insert into nam_render_versions(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,storage_path,created_by,request_key,create_payload,verified_at)
   values($1,$2,$3,$4,1,$5,'image/png',32,$6,$6,32,16,16,$6,8,$6,$7,$8,'ready',$9,$10,$11,'{}',now())`,[rid,w,pid,did,marker+'-'+code+'.png',mediaHash,marker+' retained render note',stage,w+'/'+rid,actor,key()]);return {deliverable_id:did,render_id:rid,expected_version:1};
 }
 const revisionImage=await image('REV-01','Briefing'),finalImage=await image('FINAL-01','Final approval');
 const round=await rpc(actor,'nam_open_revision_round',{w,pid,payload:{title:marker+' revision round',brief:marker+' correction brief',items:[{...revisionImage,instruction:marker+' adjust the camera'}]},retry_key:key()});
 const contact=key();await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[contact,contact+'@export-test.invalid']);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[contact]);
 await rpc(actor,'nam_save_client_access',{w,pid,uid:contact,expected_version:null,payload:{name:marker+' delivery client',email:contact+'@export-test.invalid',active:true,can_approve:false},retry_key:key()});
 const delivery=await rpc(actor,'nam_issue_project_delivery',{w,pid,payload:{title:marker+' final delivery',message:marker+' issued message',items:[finalImage],recipients:[contact]},retry_key:key()});
 const milestone=await rpc(actor,'nam_save_project_milestone',{w,pid,mid:null,expected_version:null,changes:{title:marker+' checkpoint',target_date:'2026-12-15',note:marker+' agreed date'},retry_key:key()});
 await rpc(actor,'nam_save_project_milestone',{w,pid,mid:milestone.id,expected_version:1,changes:{status:'complete'},retry_key:key()});
 let announcement=null;
 if(hasHome){announcement=await rpc(actor,'nam_save_home_announcement',{w,aid:null,expected_version:0,changes:{title:marker+' announcement',body:marker+' business announcement',audience_roles:[],starts_on:'2026-11-25',ends_on:null},retry_key:key()});await rpc(actor,'nam_save_home_announcement',{w,aid:announcement.id,expected_version:announcement.version,changes:{archived:true},retry_key:key()});}

 // Private transport commands are populated, then marked distinctly so a
 // future broad-table export would fail this regression instead of passing on
 // empty command tables. Actual business data/events above stay unchanged.
 await db.query('update nam_task_request_keys set body=$1 where workspace_id=$2',[JSON.stringify({private_command:INTERNAL}),w]);
 for(const table of ['nam_task_schedule_requests','nam_learning_path_commands','nam_sales_followup_requests'])await db.query(`update public.${table} set payload=$1 where workspace_id=$2`,[JSON.stringify({private_command:INTERNAL}),w]);
 await db.query('update nam_team_requests set fingerprint=$1 where workspace_id=$2',[JSON.stringify({private_command:INTERNAL}),w]);
 if(hasHome)await db.query('update nam_home_announcement_requests set fingerprint=$1 where workspace_id=$2',[JSON.stringify({private_command:INTERNAL}),w]);
 await db.query('insert into nam_password_setups(user_id,token_hash,reason,expires_at) values($1,$2,$3,now()+interval \'30 minutes\')',[actor,credential,'recovery']);
 await db.query('insert into nam_identity_events(workspace_id,actor_id,target_id,kind) values($1,$2,$2,$3)',[w,actor,INTERNAL]);
 await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['nam-project-resources',w+'/export-byte-fixture.txt',JSON.stringify({size:32,mimetype:'text/plain',content_base64:BLOB})]);
 await db.query('insert into nam_job_payloads(workspace_id,payload) values($1,$2)',[w,JSON.stringify({private_job:INTERNAL})]);
 return {w,actor,learner,pid,phase,resource,file,task:task.id,prerequisite:prerequisite.id,course:course.id,publication,path,assignment:assignment.assignment_id,followup:followup.id,target:target.id,department:department.id,round,delivery,milestone:milestone.id,announcement:announcement?.id,contact,lesson};
}

before(async()=>{
 db=await database();
 hasHome=(await db.query("select pg_catalog.to_regclass('public.nam_home_announcements') is not null present")).rows[0].present;
 // A second tenant's real Founder is useful: export isolation must hold even
 // for a caller who has an elevated role in a different workspace.
 await db.query("update nam_memberships set role='founder' where workspace_id=$1 and user_id=$2",[ids.otherW,ids.outsider]);
 await db.exec('create table public.nam_job_payloads(workspace_id uuid not null,payload jsonb not null)');
 main=await seed(ids.w,ids.founder,ids.sales,MAIN,credentials);other=await seed(ids.otherW,ids.outsider,ids.outsider,OTHER,otherCredentials);
});
after(async()=>{await db?.close();});

test('v9 exports every expanded business family, exact learning publications and retained project audit states',async()=>{
 const exported=await exportData();assert.equal(exported.version,9);assert.equal(exported.format,'NAM OS business data export');for(const flag of ['attachmentBytesIncluded','videoBytesIncluded','renderBytesIncluded','resourceBytesIncluded'])assert.equal(exported[flag],false);
 for(const table of newBusinessTables){assert(Array.isArray(exported.data[table]),table+' must be exported');assert(exported.data[table].length>0,table+' fixture must survive export');}
 const data=exported.data;assert(data.nam_project_resources.some(row=>row.id===main.resource&&row.document.body===MAIN+' retained business notes'));assert(data.nam_project_resource_events.some(row=>row.resource_id===main.resource));
 assert(data.nam_task_dependencies.some(row=>row.task_id===main.task&&row.prerequisite_id===main.prerequisite));assert.equal(data.nam_tasks.find(row=>row.id===main.task).recurrence_rule.frequency,'weekly');
 assert(data.nam_learning_path_courses.some(row=>row.path_id===main.path&&row.course_version_id===main.publication));assert(data.nam_learning_path_assignment_courses.some(row=>row.assignment_id===main.assignment&&row.course_version_id===main.publication));assert(data.nam_learning_path_events.some(row=>row.assignment_id===main.assignment&&row.kind==='assign'));
 assert(data.nam_sales_followup_links.some(row=>row.task_id===main.followup));assert.equal(Number(data.nam_sales_revenue_targets.find(row=>row.id===main.target).amount),12345);
 assert(data.nam_member_profiles.some(row=>row.user_id===main.learner&&row.department_id===main.department&&row.job_title===MAIN+' professional title'));
 assert(data.nam_project_revision_items.some(row=>row.round_id===main.round&&row.instruction===MAIN+' adjust the camera'));assert(data.nam_project_deliveries.find(row=>row.id===main.delivery).manifest[0].sha256===mediaHash);
 const milestone=data.nam_project_milestones.find(row=>row.id===main.milestone);assert.equal(milestone.status,'complete');assert(milestone.completed_at);assert(data.nam_project_milestone_events.some(row=>row.milestone_id===main.milestone&&row.before_state?.status==='pending'&&row.after_state.status==='complete'));
 if(hasHome){assert(data.nam_home_announcements.some(row=>row.id===main.announcement&&row.archived&&row.body===MAIN+' business announcement'));assert(data.nam_home_announcement_events.some(row=>row.announcement_id===main.announcement&&row.kind==='archived'&&row.before_state.archived===false&&row.after_state.archived===true));}
 assert(data.nam_operations_events.some(row=>row.kind==='business_exported'&&row.detail.export_version===9&&row.detail.resource_bytes===false));
});

test('the global topic catalog has its explicit catalog branch while legacy child tables remain tenant scoped',async()=>{
 const exported=await exportData(),topics=(await db.query('select * from nam_academy_topics order by position,code')).rows;assert.deepEqual(exported.data.nam_academy_topics,topics);assert.equal(topics.length,8);
 assert(exported.data.nam_project_phases.some(row=>row.id===main.phase));assert(exported.data.nam_task_comments.some(row=>row.task_id===main.task&&row.body===MAIN+' child comment'));assert(exported.data.nam_task_subtasks.some(row=>row.task_id===main.task));assert(exported.data.nam_lesson_progress.some(row=>row.lesson_id===main.lesson&&row.user_id===main.learner));assert(exported.data.nam_course_completions.some(row=>row.course_version_id===main.publication&&row.user_id===main.learner));
 for(const rows of Object.values(exported.data))for(const row of rows)if(Object.hasOwn(row,'workspace_id'))assert.equal(row.workspace_id,ids.w);
 const text=JSON.stringify(exported);assert(!text.includes(OTHER));assert(!text.includes(ids.otherW));assert(!exported.data.nam_task_comments.some(row=>row.task_id===other.task));assert(!exported.data.nam_lesson_progress.some(row=>row.lesson_id===other.lesson));
 const inverse=JSON.stringify(await exportData(ids.outsider,ids.otherW));assert(inverse.includes(OTHER));assert(!inverse.includes(MAIN));
});

test('private commands, identity state, worker payloads, credential bindings and media bytes never enter an export',async()=>{
 const exported=await exportData(),text=JSON.stringify(exported);
 for(const table of privateTables)assert(!Object.hasOwn(exported.data,table),table+' must stay private');for(const table of Object.keys(exported.data))assert(!/^(auth|storage)\./.test(table));
 assert(!text.includes(INTERNAL));assert(!text.includes(BLOB));assert(!text.includes(credentials));assert(!text.includes(otherCredentials));
 for(const rows of Object.values(exported.data))for(const row of rows)for(const column of ['credential_fingerprint','request_fingerprint','fingerprint','request_key','create_payload','command_key','command_payload'])assert(!Object.hasOwn(row,column),column+' is not business data');
 const source=exported.data.nam_integration_records.find(row=>row.external_id===MAIN+'-lead'),link=exported.data.nam_sales_followup_links.find(row=>row.task_id===main.followup);assert.equal(source.payload.title,MAIN+' CRM contact');assert.equal(link.external_id,MAIN+'-lead');
 const milestoneEvent=exported.data.nam_project_milestone_events.find(row=>row.milestone_id===main.milestone&&row.version===2);assert.equal(milestoneEvent.after_state.status,'complete');assert.equal(milestoneEvent.before_state.status,'pending');
 assert((await db.query('select count(*)::integer n from nam_learning_path_commands where workspace_id=$1',[ids.w])).rows[0].n>0);assert((await db.query('select count(*)::integer n from nam_team_requests where workspace_id=$1',[ids.w])).rows[0].n>0);
});

test('only the same currently assured managed Founder can export, including global catalog rows',async()=>{
 const denied=error=>error.code==='42501';for(const actor of [ids.sales,ids.artist,ids.outsider,ids.suspended])await assert.rejects(exportData(actor),denied);
 await assert.rejects(exportData(ids.founder,ids.w,{sessionId:null}),denied);await assert.rejects(exportData(null,ids.w,{role:'service_role',sessionId:null}),denied);
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);try{await assert.rejects(exportData(ids.founder,ids.w,{aal:'aal1'}),denied);assert.equal((await exportData(ids.founder,ids.w,{aal:'aal2'})).data.nam_academy_topics.length,8);}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
 await db.query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[ids.founder]);try{await assert.rejects(exportData(),denied);}finally{await db.query('update auth.sessions set not_after=null where id=$1',[ids.founder]);}
 await db.query('update nam_memberships set active=false where workspace_id=$1 and user_id=$2',[ids.w,ids.founder]);try{await assert.rejects(exportData(),denied);}finally{await db.query('update nam_memberships set active=true where workspace_id=$1 and user_id=$2',[ids.w,ids.founder]);}
});
