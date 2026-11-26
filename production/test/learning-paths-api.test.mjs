import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,ids,asUser} from './database.mjs';
import {context,loadServerModule} from './support/runtime.mjs';
import {withVerifiedFactor} from './optional-mfa.mjs';

// Real dispatchers and PostgreSQL/RLS. The transport/session fixtures are
// isolated; this suite never connects to NAM's hosted project or curriculum.
let db,dispatch,academy;
before(async()=>{db=await database();({dispatchLearningPaths:dispatch}=await loadServerModule('lib/api/learning-paths.ts'));({dispatchAcademy:academy}=await loadServerModule('lib/api/academy.ts'));});
after(async()=>{await db?.close();});
async function call(user,path,method='GET',body,{options={},handler=dispatch}={}){const ctx=await context(db,user,options),request=new Request('https://nam.invalid/api/'+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const response=await handler(ctx,path.split('?')[0].split('/'),request);assert(response);return {status:response.status,body:await response.json()};}
const founder=(path,method='GET',body,options={})=>call(ids.founder,path,method,body,options);
const command=(body={})=>({command_key:randomUUID(),...body});
const errorCode=code=>error=>error.code===code;
async function course(title='Path test course'){
 let c=(await founder('academy/admin/courses','POST',{title,area:'3d',summary:'Synthetic database fixture.'},{handler:academy})).body;
 c=(await founder(`academy/admin/courses/${c.id}/lessons`,'POST',{expectedRevision:c.revision,title:'Test lesson',body:'Synthetic lesson, not NAM curriculum.'},{handler:academy})).body;
 c=(await founder(`academy/admin/courses/${c.id}/publish`,'POST',{expectedRevision:c.revision},{handler:academy})).body;return c;
}
async function createPath(courses,title='Synthetic learning path'){
 const id=randomUUID(),body=command({id,title,summary:'A real ordered assignment of synthetic courses.',topics:['onboarding'],courses:courses.map(c=>({course_id:c.id,publication_id:c.publications[0].id}))});
 const result=await founder('academy/admin/paths','POST',body);assert.equal(result.status,201);return (await founder(`academy/admin/paths/${id}`)).body;
}
const assign=(p,member=ids.sales,extra={})=>founder(`academy/admin/paths/${p.id}/assign`,'POST',command({expectedRevision:p.revision,member_id:member,mandatory:true,...extra}));
const native=(path,method,body,user=ids.founder)=>call(user,path,method,body,{handler:academy});

// Call the public RPC as PostgreSQL's authenticated role, including its actual
// managed-session claims. This bypasses HTTP validation and response shaping.
async function directCommand(operation,pathId,revision,changes,key=randomUUID(),options={}){
 const result=await asUser(db,ids.founder,()=>db.query('select public.nam_learning_path_command($1,$2,$3,$4,$5::jsonb,$6) as result',[ids.w,operation,pathId,revision,JSON.stringify(changes),key]),options);
 return result.rows[0].result;
}

test('direct PostgreSQL path commands execute the full ordered lifecycle and preserve exact retry receipts',async()=>{
 const first=await course('Direct RPC first course'),second=await course('Direct RPC second course');
 const classified=await directCommand('classify',first.id,first.revision,{topics:['interior','onboarding']});
 assert.deepEqual(classified,{id:first.id,revision:first.revision+1,topics:['interior','onboarding']});
 assert.deepEqual((await db.query('select topic from nam_course_topics where course_id=$1 order by topic',[first.id])).rows.map(r=>r.topic),['interior','onboarding']);
 assert.equal((await db.query('select count(*)::integer as n from nam_course_version_topics where course_version_id=$1',[first.publications[0].id])).rows[0].n,0,'classification leaves an existing immutable publication unchanged');
 const pathId=randomUUID(),publications=[first,second].map(c=>({course_id:c.id,publication_id:c.publications[0].id}));
 const created=await directCommand('create',pathId,null,{title:'Direct PostgreSQL lifecycle',summary:'Original snapshot',topics:['onboarding'],courses:publications});
 assert.deepEqual(created,{id:pathId,revision:1});
 const edited=await directCommand('edit',pathId,created.revision,{title:'Edited direct lifecycle',summary:'Ordered snapshot',topics:['interior','onboarding'],courses:publications.toReversed()});
 assert.deepEqual(edited,{id:pathId,revision:2});
 const archived=await directCommand('archive',pathId,edited.revision,{archived:true});
 assert.deepEqual(archived,{id:pathId,revision:3,archived:true});
 await assert.rejects(directCommand('assign',pathId,archived.revision,{member_id:ids.sales,mandatory:true}),errorCode('22023'));
 const restored=await directCommand('archive',pathId,archived.revision,{archived:false});
 assert.deepEqual(restored,{id:pathId,revision:4,archived:false});
 const key=randomUUID(),changes={member_id:ids.sales,mandatory:true};
 const assigned=await directCommand('assign',pathId,restored.revision,changes,key);
 assert.deepEqual(assigned,{id:pathId,revision:4,assignment_id:assigned.assignment_id,member_id:ids.sales});
 const courses=(await db.query('select course_id,course_version_id,position from nam_learning_path_assignment_courses where assignment_id=$1 order by position',[assigned.assignment_id])).rows;
 assert.deepEqual(courses,publications.toReversed().map((c,index)=>({course_id:c.course_id,course_version_id:c.publication_id,position:index+1})));
 const snapshot=(await db.query('select title,summary,path_revision,topics,mandatory from nam_learning_path_assignments where id=$1',[assigned.assignment_id])).rows[0];
 assert.deepEqual(snapshot,{title:'Edited direct lifecycle',summary:'Ordered snapshot',path_revision:4,topics:['interior','onboarding'],mandatory:true});
 assert.deepEqual(await directCommand('assign',pathId,restored.revision,changes,key),assigned);
 await assert.rejects(directCommand('assign',pathId,restored.revision,{...changes,member_id:ids.artist},key),errorCode('40001'));
 assert.equal((await db.query('select count(*)::integer as n from nam_learning_path_events where assignment_id=$1',[assigned.assignment_id])).rows[0].n,1,'an exact retry does not repeat effects');
 assert.equal((await db.query('select count(*)::integer as n from nam_enrollments where course_id=any($1::uuid[]) and user_id=$2 and revoked_at is null',[publications.map(c=>c.course_id),ids.sales])).rows[0].n,2);
 const revoked=await directCommand('revoke',pathId,restored.revision,{assignment_id:assigned.assignment_id});
 assert.deepEqual(revoked,{id:pathId,assignment_id:assigned.assignment_id,revoked:true});
 assert.equal((await db.query('select revoked_at is not null as revoked from nam_learning_path_assignments where id=$1',[assigned.assignment_id])).rows[0].revoked,true);
 assert.equal((await db.query('select count(*)::integer as n from nam_enrollments where course_id=any($1::uuid[]) and user_id=$2 and revoked_at is null',[publications.map(c=>c.course_id),ids.sales])).rows[0].n,2,'revoking a path retains independent course access');
 assert.deepEqual((await db.query('select kind from nam_learning_path_events where path_id=$1 order by id',[pathId])).rows.map(r=>r.kind),['create','edit','archive','archive','assign','revoke']);
});

test('direct command retries require the exact current session, an available account and opted-in MFA',async()=>{
 const pathId=randomUUID(),key=randomUUID(),changes={title:'Direct session policy',summary:'',topics:[],courses:[]};
 const retry=options=>directCommand('create',pathId,null,changes,key,options);
 const created=await retry({aal:'aal1'});
 assert.deepEqual(created,{id:pathId,revision:1},'password-only managed sessions can write at AAL1');
 for(const sessionId of [ids.sales,null,randomUUID()])await assert.rejects(retry({aal:'aal1',sessionId}),errorCode('42501'));
 const expired=randomUUID();await db.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()-interval '1 minute')",[expired,ids.founder]);
 try{await assert.rejects(retry({aal:'aal1',sessionId:expired}),errorCode('42501'));}finally{await db.query('delete from auth.sessions where id=$1',[expired]);}
 await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[ids.founder]);
 try{await assert.rejects(retry({aal:'aal1'}),errorCode('42501'));}finally{await db.query('update auth.users set banned_until=null where id=$1',[ids.founder]);}
 await withVerifiedFactor(db,ids.founder,async()=>{
  await assert.rejects(retry({aal:'aal1'}),errorCode('42501'));
  assert.deepEqual(await retry({aal:'aal2'}),created,'an opted-in verified factor requires AAL2 even for an exact retry');
 });
 assert.deepEqual(await retry({aal:'aal1'}),created);
 assert.equal((await db.query('select count(*)::integer as n from nam_learning_path_commands where workspace_id=$1 and command_key=$2',[ids.w,key])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::integer as n from nam_learning_path_events where path_id=$1',[pathId])).rows[0].n,1);
});

test('path assignments pin exact immutable publications and show real lesson progress and reopen state',async()=>{
 const c=await course(),p=await createPath([c]),assignment=(await assign(p)).body;
 let record=(await call(ids.sales,'academy/paths/'+assignment.assignment_id)).body;assert.equal(record.courses[0].publication_id,c.publications[0].id);assert.equal(record.courses[0].access_status,'available');assert.equal(record.courses[0].completed,0);assert.equal(record.courses[0].completion,null);
 const learner=(await native('courses/'+c.id,'GET',undefined,ids.sales)).body;
 await native('lessons/'+learner.lessons[0].id+'/complete','POST',{},ids.sales);
 record=(await call(ids.sales,'academy/paths/'+assignment.assignment_id)).body;assert.equal(record.courses[0].completed,1);assert.equal(record.courses[0].completion.basis,'self_reported');
 await native('lessons/'+learner.lessons[0].id+'/progress','POST',{completed:false,course_id:c.id,course_version:1},ids.sales);
 record=(await call(ids.sales,'academy/paths/'+assignment.assignment_id)).body;assert.equal(record.courses[0].completed,0);assert.equal(record.courses[0].completion,null);
 const count=(await db.query('select count(*)::integer as n from nam_course_completions where course_version_id=$1 and user_id=$2',[c.publications[0].id,ids.sales])).rows[0].n;assert.equal(count,1,'historical completion is retained without falsely counting reopened lessons');
});

test('new path publication conflicts roll back every enrollment and never silently upgrade a learner',async()=>{
 let c=await course('Course with two publications');const first=c.publications[0];
 await native(`academy/admin/courses/${c.id}/enroll`,'POST',{member_id:ids.sales,course_version:1});
 const learner=(await native('courses/'+c.id,'GET',undefined,ids.sales)).body;await native('lessons/'+learner.lessons[0].id+'/complete','POST',{},ids.sales);
 c=(await native(`academy/admin/courses/${c.id}`,'PATCH',{expectedRevision:c.revision,title:'New publication title'})).body;c=(await native(`academy/admin/courses/${c.id}/publish`,'POST',{expectedRevision:c.revision})).body;
 const unrelated=await course('Do not partly enroll this course'),p=await createPath([unrelated,c]);
 await assert.rejects(assign(p),error=>error.status===409&&/different course publication/.test(error.message));
 const actual=(await native('courses/'+c.id,'GET',undefined,ids.sales)).body;assert.equal(actual.publication_id,first.id);assert.equal(actual.completed,1);
 const enrollment=(await db.query('select count(*)::integer as n from nam_enrollments where course_id=$1 and user_id=$2',[unrelated.id,ids.sales])).rows[0].n;assert.equal(enrollment,0);
 assert.equal((await founder('academy/admin/paths/'+p.id)).body.assignment_total,0);
});

test('path edits retain earlier assignment snapshots and stale revisions cannot overwrite the path',async()=>{
 const first=await course('First path course'),second=await course('Second path course'),p=await createPath([first]),assigned=(await assign(p)).body;
 const update=command({expectedRevision:p.revision,title:'Revised path',summary:'Changed order',topics:['interior','lighting_composition'],courses:[{course_id:second.id,publication_id:second.publications[0].id},{course_id:first.id,publication_id:first.publications[0].id}]});
 const changed=(await founder('academy/admin/paths/'+p.id,'PATCH',update)).body;assert.equal(changed.revision,p.revision+1);
 await assert.rejects(founder('academy/admin/paths/'+p.id,'PATCH',{...update,command_key:randomUUID(),title:'Stale overwrite'}),error=>error.status===409);
 const original=(await call(ids.sales,'academy/paths/'+assigned.assignment_id)).body;assert.equal(original.title,p.title);assert.equal(original.path_revision,p.revision);assert.equal(original.courses.length,1);assert.equal(original.courses[0].course_id,first.id);
 const latest=(await founder('academy/admin/paths/'+p.id)).body;await assign(latest,ids.artist);
 const artist=(await call(ids.artist,'academy/paths')).body;const snapshot=artist.items.find(a=>a.path_id===p.id);assert.deepEqual(snapshot.courses.map(c=>c.course_id),[second.id,first.id]);
});

test('identical command retries have one effect and reusing the request key for a different change conflicts',async()=>{
 const c=await course(),p=await createPath([c]),body=command({expectedRevision:p.revision,member_id:ids.sales,mandatory:true});
 const a=(await founder(`academy/admin/paths/${p.id}/assign`,'POST',body)).body,b=(await founder(`academy/admin/paths/${p.id}/assign`,'POST',body)).body;assert.equal(a.assignment_id,b.assignment_id);
 await assert.rejects(founder(`academy/admin/paths/${p.id}/assign`,'POST',{...body,member_id:ids.artist}),error=>error.status===409);
 const count=(await db.query('select count(*)::integer as n from nam_learning_path_events where assignment_id=$1 and kind=$2',[a.assignment_id,'assign'])).rows[0].n;assert.equal(count,1);
 const create=command({id:randomUUID(),title:'Retryable new path',summary:'',topics:[],courses:[]});const created=(await founder('academy/admin/paths','POST',create)).body,retried=(await founder('academy/admin/paths','POST',create)).body;assert.deepEqual(created,retried);
});

test('path removal retains independently useful enrollments and prevents reading removed assignments',async()=>{
 const c=await course(),p=await createPath([c]),a=(await assign(p)).body;
 await founder(`academy/admin/paths/${p.id}/revoke`,'POST',command({expectedRevision:p.revision,assignment_id:a.assignment_id}));
 await assert.rejects(call(ids.sales,'academy/paths/'+a.assignment_id),error=>error.status===404);
 assert.equal((await native('courses/'+c.id,'GET',undefined,ids.sales)).body.version,1);
 assert.equal((await db.query('select count(*)::integer as n from nam_learning_path_assignments where id=$1 and revoked_at is not null',[a.assignment_id])).rows[0].n,1);
});

test('paths lose completion credit when enrollment is removed or explicitly moved to another publication',async()=>{
 let c=await course(),p=await createPath([c]),a=(await assign(p)).body;
 const learner=(await native('courses/'+c.id,'GET',undefined,ids.sales)).body;await native('lessons/'+learner.lessons[0].id+'/complete','POST',{},ids.sales);
 await native(`academy/admin/courses/${c.id}/revoke`,'POST',{member_id:ids.sales});
 let record=(await call(ids.sales,'academy/paths/'+a.assignment_id)).body;assert.equal(record.courses[0].access_status,'enrollment_missing');assert.equal(record.courses[0].completion,null);assert.equal(record.courses[0].completed,0);
 c=(await native('academy/admin/courses/'+c.id,'PATCH',{expectedRevision:c.revision,title:'Explicit next publication'})).body;c=(await native(`academy/admin/courses/${c.id}/publish`,'POST',{expectedRevision:c.revision})).body;
 await native(`academy/admin/courses/${c.id}/enroll`,'POST',{member_id:ids.sales,course_version:2});
 record=(await call(ids.sales,'academy/paths/'+a.assignment_id)).body;assert.equal(record.courses[0].access_status,'enrollment_changed');assert.equal(record.courses[0].version,1);assert.equal(record.courses[0].completion,null);
});

test('subjects preserve the legacy area and are captured only in newly published versions',async()=>{
 let c=await course('Subject classification course');const first=c.publications[0].id;
 const classified=(await founder('academy/admin/course-topics/'+c.id,'PATCH',command({expectedRevision:c.revision,topics:['interior','nam_standards_sops']}))).body;
 assert.equal(classified.revision,c.revision+1);assert.equal((await db.query('select count(*)::integer as n from nam_course_version_topics where course_version_id=$1',[first])).rows[0].n,0);
 c=(await native('academy/admin/courses/'+c.id,'GET')).body;assert.equal(c.publication_status,'draft');assert.equal(c.area,'3d');c=(await native(`academy/admin/courses/${c.id}/publish`,'POST',{expectedRevision:c.revision})).body;
 const page=(await founder(`academy/admin/path-courses/${c.id}/publications?page_size=1`)).body,older=(await founder(`academy/admin/path-courses/${c.id}/publications?page_size=1&offset=1`)).body;assert.equal(page.items[0].version,2);assert.equal(page.next_offset,1);assert.equal(older.items[0].id,first);assert.equal(older.next_offset,null);
 await native(`academy/admin/courses/${c.id}/enroll`,'POST',{member_id:ids.sales,course_version:1});assert.deepEqual((await call(ids.sales,'academy/topics')).body.course_topics[c.id],[]);
 await native(`academy/admin/courses/${c.id}/enroll`,'POST',{member_id:ids.sales,course_version:2});assert.deepEqual((await call(ids.sales,'academy/topics')).body.course_topics[c.id],['interior','nam_standards_sops']);
});

test('direct SQL/API reads enforce assigned-only access, managed sessions, optional MFA and current grants',async()=>{
 const c=await course(),p=await createPath([c]),a=(await assign(p)).body;
 await assert.rejects(call(ids.artist,'academy/paths/'+a.assignment_id),error=>error.status===404);
 for(const user of [ids.sales,ids.artist])await assert.rejects(call(user,'academy/admin/paths'),error=>error.status===403);
 await assert.rejects(asUser(db,ids.outsider,()=>db.query('select nam_learning_paths_list($1)',[ids.w])),errorCode('42501'));
 const hidden=await asUser(db,ids.artist,()=>db.query('select id from nam_learning_paths where id=$1',[p.id]));assert.equal(hidden.rows.length,0);
 await assert.rejects(asUser(db,ids.sales,()=>db.query('select nam_learning_path_assignment_data($1,$2)',[ids.w,a.assignment_id])),errorCode('42501'));
 await assert.rejects(asUser(db,ids.sales,()=>db.query('select nam_learning_path_read($1,$2,null)',[ids.w,p.id])),errorCode('22023'));
 await assert.rejects(asUser(db,ids.sales,()=>db.query('update nam_learning_path_assignments set user_id=$1 where id=$2',[ids.artist,a.assignment_id])),errorCode('42501'));
 await withVerifiedFactor(db,ids.founder,async()=>{await assert.rejects(founder('academy/admin/paths'),error=>error.status===403);assert.equal((await founder('academy/admin/paths','GET',undefined,{options:{aal:'aal2'}})).status,200);});
 await assert.rejects(asUser(db,ids.sales,()=>db.query('select nam_learning_paths_list($1)',[ids.w]),{sessionId:null}),errorCode('42501'));
 await db.query("delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section='academy'",[ids.w,ids.artist]);
 try{await assert.rejects(assign(p,ids.artist),error=>error.status===403);}finally{await db.query("insert into nam_section_grants(workspace_id,user_id,section) values($1,$2,'academy')",[ids.w,ids.artist]);}
});

test('path paging and HTTP validation reject unbounded/unknown fields before writes and preserve unrelated routes',async()=>{
 for(const query of ['page_size=0','page_size=101','page_size=2&page_size=3','offset=-1','offset=100001','offset=1.5','member_id='+ids.artist,'all=true'])await assert.rejects(founder('academy/admin/paths?'+query),error=>error.status===400);
 for(const patch of [{id:'invalid'},{topics:['interior','interior']},{topics:['sales']},{courses:[{course_id:ids.w,publication_id:'bad'}]},{courses:[],user_id:ids.artist},{courses:'all'},{title:'a'.repeat(201)}])await assert.rejects(founder('academy/admin/paths','POST',command({id:randomUUID(),title:'Validation fixture',topics:[],courses:[],...patch})),error=>error.status===400);
 const one=(await founder('academy/admin/paths?page_size=1')).body;assert.equal(one.items.length,1);assert.equal(one.next_offset,1);const next=(await founder('academy/admin/paths?page_size=1&offset=1')).body;assert.notEqual(one.items[0].id,next.items[0].id);
 const ctx=await context(db);assert.equal(await dispatch(ctx,['courses'],new Request('https://nam.invalid/api/courses')),null);
 ctx.supabase.rpc=async()=>({data:null,error:{code:'ECONNRESET',message:'secret connection detail'}});await assert.rejects(dispatch(ctx,['academy','paths'],new Request('https://nam.invalid/api/academy/paths')),error=>error.status===503&&!error.message.includes('secret'));
});
