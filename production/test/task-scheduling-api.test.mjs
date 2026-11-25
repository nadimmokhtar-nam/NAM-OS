import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,ids,grantFixtureAccess} from './database.mjs';
import {client,context,loadServerModule} from './support/runtime.mjs';

let db,dispatch,tasks,query;
before(async()=>{db=await database();({dispatchTaskScheduling:dispatch,taskCalendarQuery:query}=await loadServerModule('lib/api/task-scheduling.ts'));({dispatchTasks:tasks}=await loadServerModule('lib/api/tasks.ts'));});
after(async()=>{await db?.close();});
function request(path,method='GET',body,key=randomUUID()){return new Request('https://nam.api-test.invalid/api/'+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
async function call(ctx,path,method='GET',body,key){const result=await dispatch(ctx,path.split('?')[0].split('/'),request(path,method,body,key));assert(result);return {status:result.status,body:await result.json(),headers:result.headers};}
async function rpc(name,args,user=ids.founder){const result=await client(db,user).rpc(name,{w:ids.w,...args});if(result.error)throw result.error;return result.data;}
const create=title=>rpc('nam_create_task',{changes:{title,section:'sales',owner_id:ids.sales,due_date:'2027-04-15'},retry_key:randomUUID()});

test('calendar API uses the explicit SQL window, real filters and private response headers',async()=>{
 const current=await create('Calendar API current'),ctx=await context(db,ids.sales),result=await call(ctx,'tasks/calendar?from=2027-04-01&to=2027-04-30&page=1&page_size=1&search=Calendar%20API&status=Todo&scope=mine');
 assert.equal(result.status,200);assert.equal(result.body.items[0].id,current.id);assert.equal(result.body.items[0].owner_name,'Sales');assert.equal(result.body.total,1);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(result.body.timezone,'Europe/Paris');
 const value=query(new URLSearchParams('from=0001-01-01&to=0001-01-31&page_size=200&archived=0'));assert.equal(value.from_date,'0001-01-01');assert.equal(value.filters.pageSize,200);
 for(const suffix of ['', '?from=2027-04-01','?from=2027-02-30&to=2027-03-02','?from=2027-01-01&to=2028-01-02','?from=2027-04-01&to=2027-04-30&status=Todo&status=Done','?from=2027-04-01&to=2027-04-30&owner=invalid','?from=2027-04-01&to=2027-04-30&scope=all','?from=2027-04-01&to=2027-04-30&archived=true','?from=2027-04-01&to=2027-04-30&page_size=201','?from=2027-04-01&to=2027-04-30&unknown=x'])await assert.rejects(call(ctx,'tasks/calendar'+suffix),e=>e.status===400);
 assert.equal(await dispatch(ctx,['projects'],request('projects')),null);assert.equal(await dispatch(ctx,['tasks',current.id],request('tasks/'+current.id)),null);
});

test('scheduling API validates its exact mutation fields and persists dependency and repeat changes with retry identity',async()=>{
 const current=await create('Schedule API dependent'),prior=await create('Schedule API prerequisite'),ctx=await context(db,ids.sales),path='tasks/'+current.id+'/scheduling',body={expectedVersion:current.version,changes:{recurrence:{frequency:'weekly',interval:2,until:'2027-06-01'},prerequisite_ids:[prior.id]}},key=randomUUID();
 let result=await call(ctx,path,'PATCH',body,key);assert.equal(result.body.version,current.version+1);assert.equal(result.body.prerequisites[0].id,prior.id);assert.equal(result.body.can_complete,false);assert.equal(result.body.next_due_date,'2027-04-29');assert.equal((await call(ctx,path,'PATCH',body,key)).body.version,result.body.version);
 await assert.rejects(call(ctx,path,'PATCH',{...body,changes:{recurrence:null}},key),e=>e.status===409);
 for(const invalid of [{changes:{recurrence:null}},{expectedVersion:2,changes:{recurrence:{frequency:'hourly'}}},{expectedVersion:2,changes:{recurrence:{frequency:'weekly',interval:0}}},{expectedVersion:2,changes:{recurrence:{frequency:'weekly',until:'2027-02-30'}}},{expectedVersion:2,changes:{prerequisite_ids:[current.id]}},{expectedVersion:2,changes:{prerequisite_ids:[prior.id,prior.id]}},{expectedVersion:2,changes:{actor_id:ids.founder}}])await assert.rejects(call(ctx,path,'PATCH',invalid),e=>e.status===400);
 await assert.rejects(call(ctx,path,'PATCH',{expectedVersion:2,changes:{recurrence:null}},''),e=>e.status===400);
 await assert.rejects(call(ctx,path+'?scope=studio'),e=>e.status===400);
 await assert.rejects(call(ctx,path,'POST',{}),e=>e.status===405);
 result=await call(ctx,path);assert.equal(result.body.prerequisites.length,1);assert.equal(result.body.version,2);
});

test('task list API passes each supported sort to SQL and paginates the full sorted result instead of a loaded slice',async()=>{
 await db.query(`insert into nam_tasks(workspace_id,title,section,owner_id,created_by,due_date,priority,created_at)
 select $1,'Sort API fixture '||lpad((72-n)::text,3,'0'),'sales',$2,$3,date '2027-04-01'+(n%17),case when n%3=0 then 'Urgent' else 'Normal' end,timestamp '2027-01-01'+(n%5)*interval '1 day' from generate_series(1,71) n`,[ids.w,ids.sales,ids.founder]);
 const ctx=await context(db,ids.sales),all=[];
 for(let page=1;page<=8;page++){const response=await tasks(ctx,['tasks'],request('tasks?'+new URLSearchParams({page:String(page),page_size:'10',search:'Sort API fixture',sort:'title'})));const result=await response.json();assert.equal(result.total,71);assert.equal(result.sort,'title');all.push(...result.items);}
 assert.deepEqual(all.map(row=>row.title),Array.from({length:71},(_,n)=>'Sort API fixture '+String(n+1).padStart(3,'0')));assert.equal(new Set(all.map(row=>row.id)).size,71);
 for(const sort of ['due_date','priority','newest']){const response=await tasks(ctx,['tasks'],request('tasks?'+new URLSearchParams({page:'1',page_size:'10',search:'Sort API fixture',sort})));const result=await response.json();assert.equal(result.sort,sort);if(sort==='priority')assert(result.items.every(row=>row.priority==='Urgent'));if(sort==='newest')assert(result.items.every(row=>new Date(row.created_at).getUTCDate()===5));}
 await assert.rejects(tasks(ctx,['tasks'],request('tasks?page=1&sort=unsupported')),e=>e.status===400&&e.message==='Choose a valid task sort.');
});

test('overlapping completion requests yield one successor; overlapping reciprocal links yield an acyclic saved graph',async()=>{
 // The test transport serializes actual PostgreSQL transactions on PGlite's
 // one connection. Requests overlap at the API boundary; this is not a claim
 // that a single-backend WASM database tests cross-backend lock scheduling.
 const current=await create('Concurrent repeat API'),ctx=await context(db,ids.sales),path='tasks/'+current.id+'/scheduling';let saved=(await call(ctx,path,'PATCH',{expectedVersion:1,changes:{recurrence:{frequency:'daily'}}})).body;
 const complete=()=>tasks(ctx,['tasks',current.id],request('tasks/'+current.id,'PATCH',{expectedVersion:saved.version,changes:{status:'Done'}}));
 const outcomes=await Promise.allSettled([complete(),complete()]);assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);assert.equal(outcomes.find(result=>result.status==='rejected').reason.status,409);
 saved=(await call(ctx,path)).body;assert(saved.next_task);assert.equal((await db.query('select count(*)::int n from nam_tasks where recurrence_predecessor_id=$1',[current.id])).rows[0].n,1);
 const a=await create('Concurrent edge A'),b=await create('Concurrent edge B');const graph=await Promise.allSettled([call(ctx,'tasks/'+a.id+'/scheduling','PATCH',{expectedVersion:1,changes:{prerequisite_ids:[b.id]}}),call(ctx,'tasks/'+b.id+'/scheduling','PATCH',{expectedVersion:1,changes:{prerequisite_ids:[a.id]}})]);assert.equal(graph.filter(result=>result.status==='fulfilled').length,1);assert.equal(graph.find(result=>result.status==='rejected').reason.status,400);assert.equal((await db.query('select count(*)::int n from nam_task_dependencies where task_id in ($1,$2)',[a.id,b.id])).rows[0].n,1);
});

test('ordinary task API surfaces meaningful dependency conflicts and cannot bypass them with the subtask confirmation flag',async()=>{
 const current=await create('API gated task'),prior=await create('API gated prerequisite'),ctx=await context(db,ids.sales);let saved=(await call(ctx,'tasks/'+current.id+'/scheduling','PATCH',{expectedVersion:1,changes:{prerequisite_ids:[prior.id]}})).body;
 await assert.rejects(tasks(ctx,['tasks',current.id],request('tasks/'+current.id,'PATCH',{expectedVersion:saved.version,changes:{status:'Done',confirmOpenSubtasks:true}})),e=>e.status===409&&e.message==='Complete the prerequisites before finishing this task.');
 let result=await tasks(ctx,['tasks',prior.id],request('tasks/'+prior.id,'PATCH',{expectedVersion:1,changes:{status:'Done'}}));let prerequisite=await result.json();result=await tasks(ctx,['tasks',current.id],request('tasks/'+current.id,'PATCH',{expectedVersion:saved.version,changes:{status:'Done'}}));assert.equal((await result.json()).status,'Done');
 await assert.rejects(tasks(ctx,['tasks',prior.id],request('tasks/'+prior.id,'PATCH',{expectedVersion:prerequisite.version,changes:{status:'Todo'}})),e=>e.status===409&&e.message==='A completed task depends on this task. Reopen that task first.');
});

test('a revocation after the SQL read cannot release a previously read calendar or schedule through the API',async()=>{
 const current=await create('Never release after revoked read'),ctx=await context(db,ids.sales),original=ctx.supabase.rpc;let armed=false;
 ctx.supabase.rpc=async(name,args)=>{const result=await original(name,args);if(armed&&['nam_task_calendar','nam_task_scheduling'].includes(name)){armed=false;await db.query('delete from auth.sessions where id=$1',[ids.sales]);}return result;};
 for(const path of ['tasks/calendar?from=2027-04-01&to=2027-04-30','tasks/'+current.id+'/scheduling']){armed=true;try{await assert.rejects(call(ctx,path),e=>e.status===403);}finally{await db.query('insert into auth.sessions(id,user_id) values($1,$1) on conflict do nothing',[ids.sales]);}}
});

test('section revocation and reassignment after a read cannot release calendar titles or stale prerequisite titles',async()=>{
 const current=await create('Title revoked after first SQL read'),ctx=await context(db,ids.sales),original=ctx.supabase.rpc;let effect=null;
 ctx.supabase.rpc=async(name,args)=>{const result=await original(name,args);if(effect&&['nam_task_calendar','nam_task_scheduling'].includes(name)){const run=effect;effect=null;await run();}return result;};
 effect=()=>db.query("delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section='sales'",[ids.w,ids.sales]);
 try{await assert.rejects(call(ctx,'tasks/calendar?from=2027-04-01&to=2027-04-30'),e=>e.status===403&&e.code==='SCHEDULE_ACCESS_DENIED');}finally{await grantFixtureAccess(db,ids.w,ids.sales);}
 effect=()=>db.query('update nam_tasks set owner_id=$1 where id=$2',[ids.founder,current.id]);
 try{await assert.rejects(call(ctx,'tasks/calendar?from=2027-04-01&to=2027-04-30&search=Title%20revoked'),e=>e.status===403);}finally{await db.query('update nam_tasks set owner_id=$1 where id=$2',[ids.sales,current.id]);}
 const operations=await rpc('nam_create_task',{changes:{title:'Still permitted operations task',section:'operations',owner_id:ids.sales},retry_key:randomUUID()});
 await call(ctx,'tasks/'+operations.id+'/scheduling','PATCH',{expectedVersion:1,changes:{prerequisite_ids:[current.id]}});
 effect=()=>db.query("delete from nam_section_grants where workspace_id=$1 and user_id=$2 and section='sales'",[ids.w,ids.sales]);
 try{const result=await call(ctx,'tasks/'+operations.id+'/scheduling');assert.equal(result.body.unavailable_prerequisites,1);assert.equal(result.body.prerequisites.length,0);assert(!JSON.stringify(result.body).includes(current.title));assert(!JSON.stringify(result.body).includes(current.id));}finally{await grantFixtureAccess(db,ids.w,ids.sales);}
});
