import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {database,asUser,ids} from './database.mjs';

let db;
before(async()=>{db=await database();});
after(async()=>{await db?.close();});
async function rpc(user,name,args,options={aal:'aal1'}){
 const values=args.map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value);
 return (await asUser(db,user,()=>db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as value`,values),options)).rows[0].value;
}
const denied=error=>['42501','P0002'].includes(error.code);
const project=changes=>rpc(ids.founder,'nam_save_project',[ids.w,null,null,{title:'Courtyard residence',brief:'Warm afternoon light; preserve the architect’s proportions.',outcome:'Approved image and final full-resolution delivery.',lead_id:ids.artist,member_ids:[ids.artist],...changes},null]);

test('project brief, explicit participants and a deliverable share the existing task system',async()=>{
 const pid=await project();
 const brief=await rpc(ids.artist,'nam_project_detail',[ids.w,pid]);
 assert.equal(brief.title,'Courtyard residence');assert(brief.brief.includes('afternoon'));assert.deepEqual(brief.member_ids,[ids.artist]);
 const task=await rpc(ids.founder,'nam_create_task',[ids.w,{title:'Interior / living room',section:'projects',owner_id:ids.artist,project_id:pid,production_stage:'Lighting'},'project-deliverable-01']);
 assert.equal(task.project_id,pid);assert.equal(task.production_stage,'Lighting');
 const page=await rpc(ids.artist,'nam_task_page',[ids.w,{project_id:pid}]);
 assert.equal(page.items.length,1);assert.equal(page.items[0].project_title,'Courtyard residence');assert.equal(page.items[0].id,task.id);
 const saved=await rpc(ids.artist,'nam_save_task',[ids.w,task.id,task.version,{production_stage:'Internal review',status:'In progress'}]);
 assert.equal(saved.version,task.version+1);assert.equal(saved.production_stage,'Internal review');
 assert.equal((await rpc(ids.founder,'nam_project_list',[ids.w,false])).find(p=>p.id===pid).deliverables,1);
});

test('knowing a project ID or holding a manager template never grants its brief or another owner’s tasks',async()=>{
 const pid=await project({title:'Restricted brief',member_ids:[],lead_id:ids.founder});
 await assert.rejects(rpc(ids.artist,'nam_project_detail',[ids.w,pid]),denied);
 assert(!(await rpc(ids.artist,'nam_project_list',[ids.w,false])).some(p=>p.id===pid));
 await assert.rejects(rpc(ids.artist,'nam_create_task',[ids.w,{title:'Guess private context',section:'projects',project_id:pid},null]),denied);
 await assert.rejects(rpc(ids.founder,'nam_create_task',[ids.w,{title:'Ungrantable assignment',section:'projects',owner_id:ids.artist,project_id:pid},null]),denied);
 const shared=await project();
 const own=await rpc(ids.founder,'nam_create_task',[ids.w,{title:'Founder-only review notes',section:'projects',owner_id:ids.founder,project_id:shared},null]);
 assert(!(await rpc(ids.artist,'nam_task_page',[ids.w,{project_id:shared}])).items.some(t=>t.id===own.id));
 const summary=(await rpc(ids.artist,'nam_project_list',[ids.w,false])).find(p=>p.id===shared);assert.equal(summary.deliverables,0);
});

test('project creation retries deduplicate and stale edits retain the saved brief and participants',async()=>{
 const input={title:'Retry-safe project',member_ids:[ids.artist],lead_id:ids.artist};
 const a=await rpc(ids.founder,'nam_save_project',[ids.w,null,null,input,'project-retry-0001']);
 const b=await rpc(ids.founder,'nam_save_project',[ids.w,null,null,input,'project-retry-0001']);assert.equal(a,b);
 await assert.rejects(rpc(ids.founder,'nam_save_project',[ids.w,null,null,{...input,title:'Different request'},'project-retry-0001']),e=>e.code==='40001');
 await rpc(ids.founder,'nam_save_project',[ids.w,a,1,{brief:'Reviewed direction'},null]);
 await assert.rejects(rpc(ids.founder,'nam_save_project',[ids.w,a,1,{brief:'Stale overwrite',member_ids:[]},null]),e=>e.code==='40001');
 const saved=await rpc(ids.founder,'nam_project_detail',[ids.w,a]);assert.equal(saved.brief,'Reviewed direction');assert(saved.member_ids.includes(ids.artist));
});

test('project records preserve existing section access, optional MFA and immediate participant revocation',async()=>{
 const pid=await project();
 await assert.rejects(rpc(ids.artist,'nam_save_project',[ids.w,pid,1,{title:'Self promotion'},null]),denied);
 await assert.rejects(asUser(db,ids.artist,()=>db.query("update nam_projects set brief='bypass' where id=$1",[pid])),denied);
 await assert.rejects(rpc(ids.artist,'nam_save_task_core',[ids.w,null,null,{title:'Bypass wrapper',section:'projects'}]),denied);
 await assert.rejects(rpc(ids.founder,'nam_save_project',[ids.w,null,null,{title:'Cross-workspace owner',lead_id:ids.outsider},null]),e=>e.code==='22023');
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);
 try{assert.deepEqual(await rpc(ids.founder,'nam_project_list',[ids.w,false]),[]);
  await assert.rejects(rpc(ids.founder,'nam_save_project',[ids.w,pid,1,{brief:'MFA bypass'},null]),denied);
  assert((await rpc(ids.founder,'nam_project_list',[ids.w,false],{aal:'aal2'})).length>0);
 }finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
 await rpc(ids.founder,'nam_save_project',[ids.w,pid,1,{member_ids:[],lead_id:ids.founder},null]);
 await assert.rejects(rpc(ids.artist,'nam_project_detail',[ids.w,pid]),denied);
});

test('daily brief counts all authorized records, not the first page; Paris date filters agree with work views',async()=>{
 const today=(await db.query("select (now() at time zone 'Europe/Paris')::date::text as today")).rows[0].today;
 await db.query(`insert into nam_tasks(workspace_id,title,section,status,priority,owner_id,created_by,due_date)
  select $1,'Sales follow-up '||n,'sales',case when n=120 then 'Blocked' else 'Todo' end,'Normal',$2,$3,$4::date-1 from generate_series(1,120) n`,[ids.w,ids.sales,ids.founder,today]);
 await db.query("insert into nam_tasks(workspace_id,title,section,status,owner_id,created_by,due_date) values($1,'Next week meeting','sales','Todo',$2,$3,$4::date+3),($1,'Finished item','sales','Done',$2,$3,$4::date-1),($1,'No date','sales','Todo',$2,$3,null)",[ids.w,ids.sales,ids.founder,today]);
 const personal=await rpc(ids.sales,'nam_daily_brief',[ids.w,'mine']);
 assert.equal(personal.today,today);assert.equal(personal.counts.overdue,120);assert.equal(personal.counts.blocked,1);assert.equal(personal.counts.upcoming,1);assert.equal(personal.counts.unscheduled,1);
 assert(personal.attention.some(t=>t.title==='Sales follow-up 120'));assert(personal.attention.length<=8);assert.deepEqual(personal.workload,[]);
 assert(!personal.priorities.some(task=>task.due_date&&task.due_date<today),'Overdue work stays in Attention rather than appearing twice');
 const page=await rpc(ids.sales,'nam_task_page',[ids.w,{pageSize:20,focus:'overdue'}]);assert.equal(page.total,120);assert.equal(page.items.length,20);assert.equal(page.hasMore,true);
 const blocked=await rpc(ids.sales,'nam_task_page',[ids.w,{focus:'blocked'}]);assert.equal(blocked.items.length,1);assert.equal(blocked.items[0].title,'Sales follow-up 120');
 assert.equal((await rpc(ids.sales,'nam_task_page',[ids.w,{focus:'upcoming'}])).total,1);
 assert.equal((await rpc(ids.sales,'nam_task_page',[ids.w,{focus:'unscheduled'}])).total,1);
 assert.equal((await rpc(ids.sales,'nam_task_page',[ids.w,{focus:'completed'}])).total,1);
 assert.equal((await rpc(ids.sales,'nam_task_page',[ids.w,{focus:'today'}])).total,120);
 await assert.rejects(rpc(ids.sales,'nam_daily_brief',[ids.w,'studio']),denied);
 await assert.rejects(rpc(ids.sales,'nam_task_page',[ids.w,{focus:'unrecognized'}]),e=>e.code==='22023');
 const founder=await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio']);assert(founder.counts.open>=personal.counts.open);assert(founder.workload.some(w=>w.owner_id===ids.sales&&w.overdue===120));
 assert.equal((await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine'])).attention.filter(t=>t.section==='sales').length,0);
 await db.query('update nam_memberships set active=false where workspace_id=$1 and user_id=$2',[ids.w,ids.sales]);
 try{assert.equal((await rpc(ids.sales,'nam_daily_brief',[ids.w,'mine'])).counts.open,0);}finally{await db.query('update nam_memberships set active=true where workspace_id=$1 and user_id=$2',[ids.w,ids.sales]);}
});

test('daily sales summary uses the actual ledger, shared follow-up tasks and existing section access',async()=>{
 const today=(await rpc(ids.sales,'nam_daily_brief',[ids.w,'mine'])).today;
 for(const [type,day] of [['Meeting held',today],['Reply',today],['Research','2020-01-01'],['Proposal','2099-01-01']]){
  await rpc(ids.sales,'nam_save_sales_activity',[ids.w,null,null,{type,context:'Real ledger context',outcome:'Recorded outcome',occurred_on:day},null]);
 }
 const brief=await rpc(ids.sales,'nam_daily_brief',[ids.w,'mine']);
 assert.equal(brief.sales.length,1);assert.equal(brief.sales[0].owner_id,ids.sales);
 assert.equal(brief.sales[0].week_activities,2);assert.equal(brief.sales[0].week_meetings,1);assert.equal(brief.sales[0].today_activities,2);assert.equal(brief.sales[0].last_activity,today);assert.equal(brief.sales[0].overdue_followups,120);
 assert.deepEqual((await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine'])).sales,[]);
 assert.deepEqual((await rpc(ids.founder,'nam_daily_brief',[ids.w,'mine'])).sales,[]);
 assert((await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio'])).sales.some(row=>row.owner_id===ids.sales&&row.week_activities===2));
 const grants=(await db.query("delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section='sales' returning *",[ids.w,ids.sales])).rows;
 try{assert.deepEqual((await rpc(ids.sales,'nam_daily_brief',[ids.w,'mine'])).sales,[]);assert(!(await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio'])).sales.some(row=>row.owner_id===ids.sales));}
 finally{for(const grant of grants)await db.query('insert into nam_section_grants(workspace_id,user_id,section,can_create) values($1,$2,$3,$4)',[grant.workspace_id,grant.user_id,grant.section,grant.can_create]);}
});

test('Founder reviews the exact sales report read; a resubmission cannot be marked reviewed by a stale action',async()=>{
 const input={week_start:'2026-11-23',outcomes:'Three conversations advanced',blockers:'Need a portfolio example',next_week:'Follow up with a clear date'};
 const report=await rpc(ids.sales,'nam_submit_sales_report',[ids.w,input]);
 let brief=await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio']);assert.equal(brief.review_counts.sales,1);assert(brief.reviews.some(row=>row.id===report.id&&row.kind==='sales_report'));assert(!('outcomes' in brief.reviews[0]));
 assert.deepEqual((await rpc(ids.sales,'nam_daily_brief',[ids.w,'mine'])).reviews,[]);
 const revised=await rpc(ids.sales,'nam_submit_sales_report',[ids.w,{...input,outcomes:'Updated with the fourth conversation'}]);
 assert.notEqual(report.submitted_at,revised.submitted_at);
 await assert.rejects(rpc(ids.founder,'nam_review_sales_report_checked',[ids.w,report.id,report.submitted_at]),error=>error.code==='40001');
 assert.equal((await db.query('select reviewed_at from nam_sales_reports where id=$1',[report.id])).rows[0].reviewed_at,null);
 await assert.rejects(rpc(ids.sales,'nam_review_sales_report_checked',[ids.w,report.id,revised.submitted_at]),denied);
 await assert.rejects(rpc(ids.founder,'nam_review_sales_report_checked',[ids.w,report.id]),error=>error.code==='40001');
 await rpc(ids.founder,'nam_review_sales_report_checked',[ids.w,report.id,revised.submitted_at]);
 brief=await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio']);assert.equal(brief.review_counts.sales,0);assert(!brief.reviews.some(row=>row.id===report.id));
 const events=(await db.query("select id from nam_sales_events where record_id=$1 and kind='report_reviewed'",[report.id])).rows.length;
 await rpc(ids.founder,'nam_review_sales_report_checked',[ids.w,report.id,revised.submitted_at]);
 assert.equal((await db.query("select id from nam_sales_events where record_id=$1 and kind='report_reviewed'",[report.id])).rows.length,events);
});

test('practical reviews connect Founder decisions with the learner’s next action without changing completion history',async()=>{
 const admin=(op,c,changes)=>rpc(ids.founder,'nam_academy_admin',[ids.w,op,c?.id||null,c?.revision||null,changes]);
 let course=await admin('create',null,{title:'Daily review / light hierarchy',area:'3d',summary:'A practical standard'});
 course=await admin('lesson',course,{title:'Read the image',body:'Describe the subject and the intended light.'});
 course=await admin('publish',course,{});course=await admin('enroll',course,{member_id:ids.artist,course_version:1,mandatory:true});
 const assignment=await admin('assignments',course,{course_version:1,title:'Explain the lighting choice',instructions:'Describe the reference, subject and next adjustment.'});
 let response=await rpc(ids.artist,'nam_academy_submit',[ids.w,assignment.id,0,'A focused daylight study.']);
 const submission=response.submissions[0];let brief=await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio']);
 assert.equal(brief.review_counts.academy,1);assert(brief.reviews.some(row=>row.id===submission.id&&row.title===assignment.title));
 assert.deepEqual((await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine'])).reviews,[]);
 await rpc(ids.founder,'nam_academy_review',[ids.w,submission.id,submission.revision,'changes_requested','Identify the brightest surface and explain its role.']);
 brief=await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine']);assert.equal(brief.learning_feedback.length,1);assert.equal(brief.learning_feedback[0].course_id,course.id);
 assert.equal((await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio'])).review_counts.academy,0);
 response=await rpc(ids.artist,'nam_academy_submit',[ids.w,assignment.id,submission.revision+1,'The subject plane receives the strongest light; I will soften the competing highlight.']);
 await assert.rejects(rpc(ids.founder,'nam_academy_review',[ids.w,submission.id,submission.revision,'approved','']),error=>error.code==='40001');
 await rpc(ids.founder,'nam_academy_review',[ids.w,submission.id,response.submissions[0].revision,'approved','Clear and actionable.']);
 assert.deepEqual((await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine'])).learning_feedback,[]);
 assert.equal((await db.query('select count(*)::int as n from nam_academy_submission_events where submission_id=$1',[submission.id])).rows[0].n,4);
 assert.equal((await db.query('select count(*)::int as n from nam_course_completions where course_id=$1',[course.id])).rows[0].n,0,'Practical approval must not fabricate a reading completion');
});

test('production watch respects explicit participation and Attention includes a future-dated render awaiting review',async()=>{
 const pid=await project({title:'Future review / explicit brief',due_date:'2030-01-08'});
 const task=await rpc(ids.founder,'nam_create_task',[ids.w,{title:'Review the first courtyard image',section:'projects',owner_id:ids.artist,project_id:pid,production_stage:'Internal review',due_date:'2030-01-07',status:'Todo'},null]);
 const brief=await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine']);
 assert(brief.projects.some(row=>row.id===pid&&row.reviews===1));
 assert((await rpc(ids.artist,'nam_task_page',[ids.w,{focus:'attention'}])).items.some(row=>row.id===task.id));
 assert(!(await rpc(ids.artist,'nam_task_page',[ids.w,{focus:'today'}])).items.some(row=>row.id===task.id));
 assert(!(await rpc(ids.sales,'nam_daily_brief',[ids.w,'mine'])).projects.some(row=>row.id===pid));
 await rpc(ids.founder,'nam_save_project',[ids.w,pid,1,{member_ids:[],lead_id:ids.founder},null]);
 assert(!(await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine'])).projects.some(row=>row.id===pid));
});

test('Today includes a shared project for an assigned non-lead participant without exposing its membership list',async()=>{
 const pid=await project({title:'Artist participant / Founder lead',lead_id:ids.founder,member_ids:[ids.artist],due_date:'2020-01-01'});
 const task=await rpc(ids.founder,'nam_create_task',[ids.w,{title:'Participant lighting pass',section:'projects',owner_id:ids.artist,project_id:pid,production_stage:'Lighting',status:'In progress'},null]);
 assert((await rpc(ids.artist,'nam_project_list',[ids.w,false])).some(row=>row.id===pid));
 const brief=await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine']);
 assert(brief.projects.some(row=>row.id===pid&&row.deliverables===1));
 assert.equal(await rpc(ids.artist,'nam_project_participant',[ids.w,pid]),true);
 assert.equal(await rpc(ids.sales,'nam_project_participant',[ids.w,pid]),false);
 assert.deepEqual((await asUser(db,ids.artist,()=>db.query('select * from nam_project_members where project_id=$1',[pid]))).rows,[]);
 await rpc(ids.founder,'nam_save_project',[ids.w,pid,1,{member_ids:[]},null]);
 assert.equal(await rpc(ids.artist,'nam_project_participant',[ids.w,pid]),false);
 assert(!(await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine'])).projects.some(row=>row.id===pid));
 assert((await rpc(ids.artist,'nam_task_page',[ids.w,{}])).items.some(row=>row.id===task.id),'Removing brief access preserves the existing assigned task');
});

test('Canceled project work retains history while leaving the deliverable completion denominator',async()=>{
 const pid=await project({title:'One delivered image / one canceled image',due_date:'2020-01-01'});
 await rpc(ids.founder,'nam_create_task',[ids.w,{title:'Delivered image',section:'projects',owner_id:ids.artist,project_id:pid,status:'Done'},null]);
 const canceled=await rpc(ids.founder,'nam_create_task',[ids.w,{title:'Canceled image',section:'projects',owner_id:ids.artist,project_id:pid,status:'Canceled'},null]);
 const summary=(await rpc(ids.artist,'nam_project_list',[ids.w,false])).find(row=>row.id===pid);
 assert.equal(summary.completed,1);assert.equal(summary.deliverables,1);assert.equal(summary.overdue,0);
 assert(!(await rpc(ids.artist,'nam_daily_brief',[ids.w,'mine'])).projects.some(row=>row.id===pid),'Finished production leaves the daily production watch');
 assert((await rpc(ids.artist,'nam_task_page',[ids.w,{project_id:pid}])).items.some(row=>row.id===canceled.id&&row.status==='Canceled'),'The canceled record is still available in work history');
});

test('My day limits Founder projects to explicit participation; Studio retains the full authorized view',async()=>{
 const pid=await project({title:'Artist-led / Founder observes',lead_id:ids.artist,due_date:'2019-01-01'});
 assert.equal(await rpc(ids.founder,'nam_project_participant',[ids.w,pid]),false);
 assert(!(await rpc(ids.founder,'nam_daily_brief',[ids.w,'mine'])).projects.some(row=>row.id===pid));
 assert((await rpc(ids.founder,'nam_daily_brief',[ids.w,'studio'])).projects.some(row=>row.id===pid));
 await assert.rejects(asUser(db,ids.artist,()=>db.query('select nam_project_participant($1,$2)',[ids.w,pid]),{role:'anon'}),error=>error.code==='42501');
});

test('business export retains project context, learning structure and grants without exporting another workspace or Auth',async()=>{
 const pid=await project({title:'Export the approved brief'});
 const other=(await db.query("insert into nam_projects(workspace_id,title,lead_id,created_by,create_payload) values($1,'A different workspace',$2,$2,'{}') returning id",[ids.otherW,ids.outsider])).rows[0].id;
 const exported=await rpc(ids.founder,'nam_export_business',[ids.w]);assert.equal(exported.version,7);assert.equal(exported.videoBytesIncluded,false);assert.equal(exported.attachmentBytesIncluded,false);
 assert(exported.data.nam_projects.some(row=>row.id===pid));assert(!exported.data.nam_projects.some(row=>row.id===other));
 assert(exported.data.nam_project_members.some(row=>row.project_id===pid&&row.user_id===ids.artist));
 assert(exported.data.nam_project_events.some(row=>row.project_id===pid));
 for(const table of ['nam_course_modules','nam_course_version_resources','nam_academy_videos','nam_course_version_videos','nam_section_grants','nam_access_events'])assert(Array.isArray(exported.data[table]),table);
 assert(!Object.keys(exported.data).some(name=>name.startsWith('auth')||/session|invite|integration_state/.test(name)));
 await assert.rejects(rpc(ids.artist,'nam_export_business',[ids.w]),denied);
});
