import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,asUser,ids,grantFixtureAccess} from './database.mjs';
import {client} from './support/runtime.mjs';

let db;
before(async()=>{db=await database();});
after(async()=>{await db?.close();});
async function rpc(user,name,args,options={}){const result=await client(db,user,options).rpc(name,args);if(result.error)throw result.error;return result.data;}
const denied=error=>['42501','P0002'].includes(error.code);
const task=(title,changes={})=>rpc(ids.founder,'nam_create_task',{w:ids.w,changes:{title,section:'sales',owner_id:ids.sales,due_date:'2027-01-31',...changes},retry_key:randomUUID()});
const schedule=(tid,user=ids.founder)=>rpc(user,'nam_task_scheduling',{w:ids.w,tid});
async function configure(tid,changes,{user=ids.founder,key=randomUUID(),version}={}){return rpc(user,'nam_save_task_scheduling',{w:ids.w,tid,expected_version:version??(await schedule(tid,user)).version,changes,retry_key:key});}
async function change(tid,changes,{user=ids.founder,version}={}){return rpc(user,'nam_save_task',{w:ids.w,task_id:tid,expected_version:version??(await schedule(tid,user)).version,changes});}
const calendar=(user,filters={},from='2027-01-01',to='2027-01-31')=>rpc(user,'nam_task_calendar',{w:ids.w,from_date:from,to_date:to,filters});

test('calendar queries complete authorized windows with exact totals, daily counts and bounded pages beyond the bootstrap slice',async()=>{
 await db.query(`insert into nam_tasks(workspace_id,title,section,owner_id,created_by,due_date,status)
 select $1,'Window fixture '||n,'sales',case when n<=215 then $2::uuid else $3::uuid end,$3,date '2027-01-12',case when n%6=0 then 'Done' else 'Todo' end from generate_series(1,240) n`,[ids.w,ids.sales,ids.founder]);
 for(const due_date of [null,null,'2027-02-01'])await task('Window fixture outside',{due_date});
 await db.query("insert into nam_tasks(workspace_id,title,section,owner_id,created_by,due_date) values($1,'Window fixture private workspace','sales',$2,$2,'2027-01-12')",[ids.otherW,ids.outsider]);
 const filters={search:'Window fixture',page:1,pageSize:75},first=await calendar(ids.sales,filters);assert.equal(first.total,215);assert.equal(first.items.length,75);assert.equal(first.days[0].total,215);assert.equal(first.unscheduled_total,2);assert.equal(first.scope,'assigned');assert.equal(first.hasMore,true);assert.equal(first.timezone,'Europe/Paris');
 const pages=[first,await calendar(ids.sales,{...filters,page:2}),await calendar(ids.sales,{...filters,page:3})];assert.equal(new Set(pages.flatMap(page=>page.items.map(row=>row.id))).size,215);assert.equal(pages[2].hasMore,false);assert(pages.flatMap(page=>page.items).every(row=>row.owner_id===ids.sales));
 assert.equal((await calendar(ids.founder,filters)).total,240);assert.equal((await calendar(ids.founder,{...filters,mine:true})).total,25);
 const done=await calendar(ids.sales,{...filters,status:'Done'});assert(done.items.every(row=>row.status==='Done'));assert.equal(done.total,35);
 for(const invalid of [{pageSize:201},{page:0},{status:'Approved'},{owner:ids.sales+'bad'},{unknown:true}])await assert.rejects(calendar(ids.sales,invalid),e=>e.code.startsWith('22'));
 await assert.rejects(calendar(ids.sales,{},'2027-01-01','2028-01-02'),e=>e.code==='22023');
});

test('calendar preserves all six statuses, filters unscheduled honestly and does not fabricate repeat occurrences',async()=>{
 for(const status of ['Backlog','Todo','In progress','Blocked','Done','Canceled'])await task('Status window '+status,{status,due_date:'2028-02-29'});
 await task('Status window no date',{due_date:null});
 const result=await calendar(ids.sales,{search:'Status window'},'2028-02-01','2028-02-29');assert.equal(result.total,6);assert.equal(result.unscheduled_total,1);assert.deepEqual(new Set(result.items.map(row=>row.status)),new Set(['Backlog','Todo','In progress','Blocked','Done','Canceled']));
 const undated=await calendar(ids.sales,{search:'Status window',focus:'unscheduled'},'2028-02-01','2028-02-29');assert.equal(undated.total,0);assert.equal(undated.unscheduled_total,1);
 const early=await task('Year one date',{due_date:'0001-01-01'});assert.equal((await calendar(ids.sales,{search:'Year one date'},'0001-01-01','0001-01-31')).items[0].id,early.id);
});

test('task sorts apply to the complete authorized set before pagination with stable ties and retained context fields',async()=>{
 await db.query(`insert into nam_tasks(workspace_id,title,section,owner_id,created_by,due_date,status,priority,created_at)
 select $1,'Task sort fixture '||lpad(((84-n)%17)::text,2,'0'),'sales',case when n<=73 then $2::uuid else $3::uuid end,$3,
 case when n%13=0 then null else date '2027-04-01'+(n%7) end,case when n%11=0 then 'Done' else 'Todo' end,
 case n%4 when 0 then 'Urgent' when 1 then 'High' when 2 then 'Normal' else 'Low' end,timestamp '2027-01-01'+(n%11)*interval '1 day' from generate_series(1,83) n`,[ids.w,ids.sales,ids.founder]);
 const source=(await db.query("select id,title,status,priority,due_date,created_at,number from nam_tasks where workspace_id=$1 and owner_id=$2 and title like 'Task sort fixture %'",[ids.w,ids.sales])).rows;
 const lexical=(a,b)=>a<b?-1:a>b?1:0,priority={Urgent:0,High:1,Normal:2,Low:3},due=(a,b)=>a.due_date===b.due_date?0:a.due_date===null?1:b.due_date===null?-1:lexical(a.due_date,b.due_date),number=(a,b)=>Number(a.number)-Number(b.number);
 const comparisons={due_date:(a,b)=>Number(['Done','Canceled'].includes(a.status))-Number(['Done','Canceled'].includes(b.status))||due(a,b)||priority[a.priority]-priority[b.priority]||number(a,b),priority:(a,b)=>priority[a.priority]-priority[b.priority]||due(a,b)||number(a,b),newest:(a,b)=>new Date(b.created_at)-new Date(a.created_at)||number(b,a),title:(a,b)=>lexical(a.title.toLowerCase(),b.title.toLowerCase())||lexical(a.title,b.title)||number(a,b)};
 for(const [sort,compare]of Object.entries(comparisons)){
  const rows=[];for(let page=1;page<=4;page++){const result=await rpc(ids.sales,'nam_task_page',{w:ids.w,filters:{search:'Task sort fixture',sort,page,pageSize:19}});assert.equal(result.total,73);assert.equal(result.sort,sort);rows.push(...result.items);}
  assert.deepEqual(rows.map(row=>row.id),[...source].sort(compare).map(row=>row.id),sort+' must sort all73 matching rows before paging');assert.equal(new Set(rows.map(row=>row.id)).size,73);assert(rows.every(row=>Object.hasOwn(row,'project_id')&&Object.hasOwn(row,'deliverable_id')&&Object.hasOwn(row,'production_stage')));
 }
 const founder=await rpc(ids.founder,'nam_task_page',{w:ids.w,filters:{search:'Task sort fixture',sort:'title'}});assert.equal(founder.total,83);
 await assert.rejects(rpc(ids.sales,'nam_task_page',{w:ids.w,filters:{sort:'title; delete from nam_tasks'}}),e=>e.code==='22023');
});

test('dependencies validate both endpoints, reject cycles and expose no hidden prerequisite identities or titles',async()=>{
 const a=await task('Dependency A'),b=await task('Dependency B'),c=await task('Dependency C');
 await configure(a.id,{prerequisite_ids:[b.id]});await configure(b.id,{prerequisite_ids:[c.id]});
 await assert.rejects(configure(c.id,{prerequisite_ids:[a.id]}),e=>e.code==='22023');await assert.rejects(configure(a.id,{prerequisite_ids:[a.id]}),e=>e.code==='22023');
 const foreign=(await db.query("insert into nam_tasks(workspace_id,title,section,owner_id,created_by) values($1,'NEVER EXPOSE OUTSIDER TITLE','sales',$2,$2) returning id",[ids.otherW,ids.outsider])).rows[0];
 const secret=await task('NEVER EXPOSE FOUNDER TITLE',{owner_id:ids.founder});
 for(const prerequisite of [secret.id,foreign.id,randomUUID()])await assert.rejects(configure(c.id,{prerequisite_ids:[prerequisite]},{user:ids.sales}),e=>e.code==='P0002'&&!e.message.includes('TITLE'));
 await configure(c.id,{prerequisite_ids:[secret.id]});const own=await schedule(c.id,ids.sales);assert.equal(own.prerequisites.length,0);assert.equal(own.unavailable_prerequisites,1);assert.equal(own.can_complete,false);assert(!JSON.stringify(own).includes(secret.id));assert(!JSON.stringify(own).includes('NEVER EXPOSE'));
 const raw=await asUser(db,ids.sales,()=>db.query('select * from nam_task_dependencies where task_id=$1',[c.id]));assert.equal(raw.rows.length,0);
 await assert.rejects(change(c.id,{status:'Done'},{user:ids.sales}),e=>e.code==='40001'&&e.message.startsWith('Complete the prerequisites'));
});

test('completion, reopening and deletion honor prerequisites under one graph lock, while cancellation does not satisfy a prerequisite',async()=>{
 const prior=await task('Gate prerequisite'),after=await task('Gate dependent');await configure(after.id,{prerequisite_ids:[prior.id]});
 for(const status of ['Todo','Canceled']){await change(prior.id,{status});await assert.rejects(change(after.id,{status:'Done',confirmOpenSubtasks:true}),e=>e.code==='40001'&&e.message.startsWith('Complete the prerequisites'));}
 await change(prior.id,{status:'Done'});await change(after.id,{status:'Done'});assert.equal((await schedule(after.id)).can_complete,true);
 await assert.rejects(change(prior.id,{status:'Todo'}),e=>e.code==='40001'&&e.message.startsWith('A completed task depends'));
 await assert.rejects(rpc(ids.founder,'nam_task_action',{w:ids.w,tid:prior.id,action:'delete',input:{expectedVersion:(await schedule(prior.id)).version}}),e=>e.code==='40001');
 await change(after.id,{status:'Todo'});await change(prior.id,{status:'Todo'});await rpc(ids.founder,'nam_task_action',{w:ids.w,tid:prior.id,action:'delete',input:{expectedVersion:(await schedule(prior.id)).version}});assert.equal((await schedule(after.id)).unavailable_prerequisites,1);
 const names=['nam_save_task','nam_create_task','nam_task_action','nam_save_task_scheduling'];for(const name of names){const definition=(await db.query('select pg_get_functiondef(p.oid) as body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',['public',name])).rows[0].body;assert(definition.indexOf('nam_task_schedule_lock(w)')<definition.indexOf('for update')||!definition.includes('for update'));}
 for(const name of ['nam_task_schedule_lock','nam_save_task_before_scheduling','nam_create_task_before_scheduling','nam_task_action_before_scheduling'])assert.equal((await db.query("select has_function_privilege('authenticated',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[name])).rows[0].allowed,false);
});

test('ordinary task writes and unrelated completion or reopening stay scoped to the named task RPC argument',async()=>{
 const prerequisite=await task('Scoped prerequisite'),dependent=await task('Scoped dependent'),unrelated=await task('Scoped unrelated task');
 await configure(dependent.id,{prerequisite_ids:[prerequisite.id]});
 let saved=await change(unrelated.id,{status:'In progress'},{user:ids.sales});assert.equal(saved.id,unrelated.id);assert.equal(saved.status,'In progress');
 saved=await change(unrelated.id,{description:'Description saved with another dependency present'},{user:ids.sales});assert.equal(saved.description,'Description saved with another dependency present');
 saved=await change(unrelated.id,{archived:true});assert.equal(saved.archived,true);saved=await change(unrelated.id,{archived:false});assert.equal(saved.archived,false);
 saved=await change(unrelated.id,{status:'Done'},{user:ids.sales});assert.equal(saved.status,'Done');assert(saved.completed_at);assert.equal((await schedule(dependent.id)).status,'Todo');
 await change(prerequisite.id,{status:'Done'});await change(dependent.id,{status:'Done'});
 saved=await change(unrelated.id,{status:'Todo'},{user:ids.sales});assert.equal(saved.id,unrelated.id);assert.equal(saved.status,'Todo');assert.equal(saved.completed_at,null);
 const before=await schedule(prerequisite.id);await assert.rejects(change(prerequisite.id,{status:'Todo'}),e=>e.code==='40001'&&e.message.startsWith('A completed task depends'));
 const after=await schedule(prerequisite.id);assert.equal(after.status,'Done');assert.equal(after.version,before.version);assert.equal((await schedule(dependent.id)).status,'Done');
});

test('monthly recurrence creates real stable task UUIDs, retains its anchor and never copies private child records',async()=>{
 const current=await task('Repeat anchored on 31');await rpc(ids.sales,'nam_task_action',{w:ids.w,tid:current.id,action:'subtask',input:{title:'Occurrence-only checklist'}});
 await configure(current.id,{recurrence:{frequency:'monthly',interval:1,until:'2027-03-31'}},{user:ids.sales});await change(current.id,{status:'Done',confirmOpenSubtasks:true},{user:ids.sales});
 const first=await schedule(current.id,ids.sales),next=first.next_task;assert(next.id!==current.id);assert.equal(next.due_date,'2027-02-28');
 const stored=(await db.query('select t.*,t.recurrence_anchor_date::text as anchor_date_iso from nam_tasks t where t.id=$1',[next.id])).rows[0];assert.equal(stored.status,'Todo');assert.equal(stored.recurrence_occurrence,1);assert.equal(stored.anchor_date_iso,'2027-01-31');assert.equal((await db.query('select count(*)::integer n from nam_task_subtasks where task_id=$1',[next.id])).rows[0].n,0);
 await change(current.id,{status:'Todo'},{user:ids.sales});await change(current.id,{status:'Done',confirmOpenSubtasks:true},{user:ids.sales});assert.equal((await schedule(current.id,ids.sales)).next_task.id,next.id);
 await change(next.id,{status:'Done'},{user:ids.sales});const last=(await schedule(next.id,ids.sales)).next_task;assert.equal(last.due_date,'2027-03-31');await change(last.id,{status:'Done'},{user:ids.sales});assert.equal((await schedule(last.id,ids.sales)).next_task,null);
 const march=await calendar(ids.sales,{search:'Repeat anchored on 31'},'2027-03-01','2027-03-31');assert.equal(march.total,1);assert.equal(march.items[0].id,last.id);assert.equal((await db.query('select count(*)::integer n from nam_tasks where recurrence_series_id=$1',[stored.recurrence_series_id])).rows[0].n,3);
 await assert.rejects(change(current.id,{due_date:'2027-01-30'}),e=>e.code==='40001');
});

test('recurrence configuration retries are exact, date changes start from that occurrence and permission loss rolls completion back',async()=>{
 const current=await task('Repeat retry and access'),key=randomUUID(),changes={recurrence:{frequency:'weekly',interval:2,until:null}},args={w:ids.w,tid:current.id,expected_version:current.version,changes,retry_key:key};
 const saved=await rpc(ids.sales,'nam_save_task_scheduling',args);assert.equal((await rpc(ids.sales,'nam_save_task_scheduling',args)).version,saved.version);await assert.rejects(rpc(ids.sales,'nam_save_task_scheduling',{...args,changes:{recurrence:{frequency:'daily'}}}),e=>e.code==='40001');
 await change(current.id,{due_date:'2027-02-02'},{user:ids.sales});assert.equal((await schedule(current.id,ids.sales)).next_due_date,'2027-02-16');await assert.rejects(change(current.id,{due_date:null},{user:ids.sales}),e=>e.code==='22023');
 await db.query("update nam_section_grants set can_create=false where workspace_id=$1 and user_id=$2 and section='sales'",[ids.w,ids.sales]);
 try{const prior=await schedule(current.id,ids.sales);await assert.rejects(change(current.id,{status:'Done'},{user:ids.sales}),e=>e.code==='42501');const next=await schedule(current.id,ids.sales);assert.equal(next.status,'Todo');assert.equal(next.version,prior.version);assert.equal(next.next_task,null);await configure(current.id,{recurrence:null},{user:ids.sales});await change(current.id,{status:'Done'},{user:ids.sales});}
 finally{await db.query("update nam_section_grants set can_create=true where workspace_id=$1 and user_id=$2 and section='sales'",[ids.w,ids.sales]);}
});

test('repeating production work retains its central task identity and project/image context even after the successor changes its rule',async()=>{
 const pid=await rpc(ids.founder,'nam_save_project',{w:ids.w,pid:null,expected_version:null,changes:{title:'Repeat production context',member_ids:[ids.artist]},retry_key:randomUUID()});
 const did=await rpc(ids.founder,'nam_save_deliverable',{w:ids.w,did:null,expected_version:null,changes:{project_id:pid,title:'Recurring image review',code:'REPEAT-01',artist_id:ids.artist},retry_key:randomUUID()});
 const current=await task('Production occurrence identity',{section:'projects',owner_id:ids.artist,project_id:pid,production_stage:'Internal review',deliverable_id:did});
 await configure(current.id,{recurrence:{frequency:'weekly'}},{user:ids.artist});await change(current.id,{status:'Done'},{user:ids.artist});let next=(await schedule(current.id,ids.artist)).next_task;
 const stored=(await db.query('select * from nam_tasks where id=$1',[next.id])).rows[0];assert.equal(stored.project_id,pid);assert.equal(stored.deliverable_id,did);assert.equal(stored.production_stage,'Internal review');assert.equal(stored.owner_id,ids.artist);assert.equal(stored.recurrence_predecessor_id,current.id);
 await configure(next.id,{recurrence:{frequency:'daily'}},{user:ids.artist});assert.equal((await schedule(current.id,ids.artist)).next_task.id,next.id);
 await change(current.id,{status:'Todo'},{user:ids.artist});await change(current.id,{status:'Done'},{user:ids.artist});assert.equal((await schedule(current.id,ids.artist)).next_task.id,next.id);
 const central=await rpc(ids.artist,'nam_task_page',{w:ids.w,filters:{project_id:pid}}),window=await rpc(ids.artist,'nam_task_calendar',{w:ids.w,from_date:'2027-01-01',to_date:'2027-02-28',filters:{project_id:pid}});assert.equal(central.total,2);assert.equal(window.total,2);assert.deepEqual(new Set(central.items.map(row=>row.id)),new Set(window.items.map(row=>row.id)));
 await rpc(ids.founder,'nam_task_action',{w:ids.w,tid:next.id,action:'delete',input:{expectedVersion:(await schedule(next.id)).version}});await change(current.id,{status:'Todo'},{user:ids.artist});await change(current.id,{status:'Done'},{user:ids.artist});assert.equal((await schedule(current.id,ids.artist)).next_task,null);assert.equal((await db.query('select count(*)::integer n from nam_tasks where recurrence_predecessor_id=$1',[current.id])).rows[0].n,1);
});

test('scheduling and calendar recheck grant revocation, current managed sessions and elected MFA on reads, writes and retries',async()=>{
 const current=await task('Revoked scheduling access'),key=randomUUID(),changes={recurrence:{frequency:'daily',interval:1,until:null}};await configure(current.id,changes,{user:ids.sales,key});
 await db.query("delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section='sales'",[ids.w,ids.sales]);
 try{await assert.rejects(schedule(current.id,ids.sales),denied);await assert.rejects(configure(current.id,changes,{user:ids.sales,key,version:1}),denied);assert.equal((await calendar(ids.sales,{search:'Revoked scheduling access'})).total,0);}finally{await grantFixtureAccess(db,ids.w,ids.sales);}
 await db.query('delete from auth.sessions where id=$1',[ids.sales]);try{await assert.rejects(schedule(current.id,ids.sales),denied);await assert.rejects(calendar(ids.sales),denied);await assert.rejects(configure(current.id,{recurrence:null},{user:ids.sales,version:2}),denied);}finally{await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.sales]);}
 assert((await calendar(ids.founder)).items.length>=0);await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);try{await assert.rejects(calendar(ids.founder),denied);await assert.rejects(schedule(current.id),denied);assert((await rpc(ids.founder,'nam_task_calendar',{w:ids.w,from_date:'2027-01-01',to_date:'2027-01-31',filters:{}},{aal:'aal2'})).items.length>=0);}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
});
