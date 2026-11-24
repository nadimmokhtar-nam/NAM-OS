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
