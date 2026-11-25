import 'server-only';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireLiveContext} from './context';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS=['sales','academy','projects','library','team','operations'];
const STATUSES=['Backlog','Todo','In progress','Blocked','Done','Canceled'];
const PRIORITIES=['Low','Normal','High','Urgent'];
const FOCUS=['open','attention','today','upcoming','blocked','overdue','unscheduled','completed'];
function check(value:unknown,message:string):asserts value{if(!value)throw new ApiError(400,message,'INVALID_SCHEDULE');}
function identifier(value:unknown){check(typeof value==='string'&&UUID.test(value),'Choose a valid task.');return value;}
function date(value:unknown,label:string){check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&value<='9999-12-31',`Choose a valid ${label}.`);const time=Date.parse(value+'T12:00:00Z');check(Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value,`Choose a valid ${label}.`);return value;}
function integer(value:unknown,maximum:number,label:string){check(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=maximum,`Choose a valid ${label}.`);return value;}
function failure(error:{code?:string;message?:string}){
 if(error.code==='42501')throw new ApiError(403,'Current task and creation access is required for this schedule.','SCHEDULE_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'The task or prerequisite is not available.','SCHEDULE_NOT_FOUND');
 if(error.code==='40001'||error.code==='23505')throw new ApiError(409,error.message?.startsWith('Complete the prerequisites')?'Complete the prerequisites before finishing this task.':error.message?.startsWith('Change the latest occurrence')?'Change the latest occurrence to adjust future repeats.':'This task changed elsewhere. Reload its saved schedule before changing it.','SCHEDULE_CONFLICT');
 if(error.code?.startsWith('22')||['23514','23502','23503'].includes(error.code||''))throw new ApiError(400,error.message?.startsWith('Task dependencies cannot')?'Tasks cannot depend on themselves or form a dependency cycle.':'Check the repeat dates, interval and prerequisite tasks.','INVALID_SCHEDULE');
 throw new ApiError(503,'The saved schedule could not be reached. Retry the same request.','SCHEDULE_UNAVAILABLE');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,{...args,w:ctx.workspaceId});if(error)failure(error);return data;}
export function taskCalendarQuery(query:URLSearchParams){
 const allowed=['from','to','page','pageSize','page_size','section','owner','status','priority','project_id','deliverable_id','search','mine','scope','archived','focus'];
 for(const key of query.keys())check(allowed.includes(key)&&query.getAll(key).length===1,'An unsupported or repeated calendar filter was supplied.');
 check(!(query.has('pageSize')&&query.has('page_size')),'Choose one calendar page size.');
 const from=date(query.get('from'),'calendar start date'),to=date(query.get('to'),'calendar end date');
 check(to>=from&&(Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000<=365,'Choose a calendar window of at most 366 days.');
 const filters:Record<string,unknown>={page:integer(Number(query.get('page')||1),100000,'calendar page'),pageSize:integer(Number(query.get('pageSize')||query.get('page_size')||100),200,'calendar page size')};
 for(const [key,options] of [['section',SECTIONS],['status',STATUSES],['priority',PRIORITIES],['focus',FOCUS]] as Array<[string,string[]]>){if(query.has(key)){const value=query.get(key);check(value&&options.includes(value),`Choose a valid ${key} filter.`);filters[key]=value;}}
 for(const key of ['owner','project_id','deliverable_id'])if(query.has(key))filters[key]=identifier(query.get(key));
 for(const key of ['mine','archived'])if(query.has(key)){const value=query.get(key);check(value==='0'||value==='1',`Choose a valid ${key} filter.`);filters[key]=value==='1';}
 if(query.has('scope')){const value=query.get('scope');check(value==='mine'||value==='studio','Choose a valid work scope.');check(!query.has('mine'),'Choose one work scope.');filters.mine=value==='mine';}
 if(query.has('search'))filters.search=inputText(query.get('search'),'Task search',{max:200,required:false});
 return {from_date:from,to_date:to,filters};
}
function scheduleChanges(value:unknown){
 check(value&&typeof value==='object'&&!Array.isArray(value),'Choose the scheduling fields to save.');const changes=value as Record<string,unknown>;fields(changes,['recurrence','prerequisite_ids']);check(Object.keys(changes).length>0,'Choose the scheduling fields to save.');
 if('recurrence' in changes&&changes.recurrence!==null){
  const value=changes.recurrence;check(value&&typeof value==='object'&&!Array.isArray(value),'Choose a valid repeat rule.');const rule=value as Record<string,unknown>;fields(rule,['frequency','interval','until']);check(['daily','weekly','monthly'].includes(String(rule.frequency)),'Choose a daily, weekly or monthly repeat.');
  changes.recurrence={frequency:rule.frequency,interval:rule.interval===undefined?1:integer(rule.interval,99,'repeat interval'),until:rule.until==null||rule.until===''?null:date(rule.until,'repeat end date')};
 }
 if('prerequisite_ids' in changes){check(Array.isArray(changes.prerequisite_ids)&&changes.prerequisite_ids.length<=100,'Choose at most 100 prerequisite tasks.');changes.prerequisite_ids=changes.prerequisite_ids.map(identifier);check(new Set(changes.prerequisite_ids as string[]).size===(changes.prerequisite_ids as string[]).length,'Choose each prerequisite once.');}
 return changes;
}

/** Mount before dispatchTasks, which interprets every second path part as UUID. */
export async function dispatchTaskScheduling(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path[0]!=='tasks')return null;
 if(path.length===2&&path[1]==='calendar'){
  if(request.method!=='GET')throw new ApiError(405,'Use GET for the task calendar.','METHOD_NOT_ALLOWED');
  const input=taskCalendarQuery(new URL(request.url).searchParams);await requireLiveContext(ctx);const data=await rpc(ctx,'nam_task_calendar',input);await requireLiveContext(ctx);
  const authorized=await rpc(ctx,'nam_task_calendar_authorized',{task_ids:(data.items||[]).map((row:Record<string,unknown>)=>row.id),observed_revision:data.access_revision,observed_sections:data.access_sections});if(authorized!==true)throw new ApiError(403,'Calendar access changed while loading. Reload your current task window.','SCHEDULE_ACCESS_DENIED');
  return json({...data,items:(data.items||[]).map((row:Record<string,unknown>)=>{const member=ctx.members.find(m=>m.id===row.owner_id);return {...row,owner_name:member?.name||'Studio member',owner_initials:member?.initials||'—'};})});
 }
 if(path.length!==3||path[2]!=='scheduling')return null;
 const tid=identifier(path[1]);
 if(request.method==='GET'){check(!new URL(request.url).search,'Scheduling details do not accept filters.');await requireLiveContext(ctx);await rpc(ctx,'nam_task_scheduling',{tid});await requireLiveContext(ctx);return json(await rpc(ctx,'nam_task_scheduling',{tid}));}
 if(request.method==='PATCH'){
  const input=await readJSON(request);fields(input,['expectedVersion','changes']);const expected_version=integer(input.expectedVersion,2147483647,'task version'),changes=scheduleChanges(input.changes),retry_key=request.headers.get('Idempotency-Key');check(retry_key&&/^[A-Za-z0-9_-]{8,128}$/.test(retry_key),'Keep a valid retry key for this schedule change.');
  if(Array.isArray(changes.prerequisite_ids))check(!changes.prerequisite_ids.includes(tid),'A task cannot depend on itself.');
  await requireLiveContext(ctx);await rpc(ctx,'nam_save_task_scheduling',{tid,expected_version,changes,retry_key});await requireLiveContext(ctx);return json(await rpc(ctx,'nam_task_scheduling',{tid}));
 }
 throw new ApiError(405,'Use GET or PATCH for task scheduling.','METHOD_NOT_ALLOWED');
}
