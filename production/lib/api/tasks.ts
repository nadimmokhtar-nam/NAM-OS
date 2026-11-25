import {type APIContext,ApiError,json,readJSON} from './context';
import {isProductionStage} from '../../public/production-stages.js';

export type TaskDTO=Record<string,unknown>&{id:string;owner_id:string;section:string;title:string;status:string;version:number;can_archive:boolean};
const SECTIONS=['sales','academy','projects','library','team','operations'];
const STATUSES=['Backlog','Todo','In progress','Blocked','Done','Canceled'];
const PRIORITIES=['Low','Normal','High','Urgent'];
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function check(ok:unknown,message:string):asserts ok{if(!ok)throw new ApiError(400,message);}
function object(value:unknown):Record<string,unknown>{check(value&&typeof value==='object'&&!Array.isArray(value),'Invalid request.');return value as Record<string,unknown>;}
function keys(value:Record<string,unknown>,allowed:string[]){check(Object.keys(value).every(k=>allowed.includes(k)),'An unsupported field was supplied.');}
function uuid(value:unknown){check(typeof value==='string'&&UUID.test(value),'Invalid record identifier.');return value;}
function version(value:unknown){check(Number.isInteger(value)&&Number(value)>0,'A valid record version is required.');return Number(value);}
function text(value:unknown,name:string,max:number,required=true){check(typeof value==='string',`${name} must be text.`);const result=value.trim();check(result.length<=max&&(!required||result.length>0),`${name} is required and must be at most ${max} characters.`);return result;}
function dbError(error:{code?:string;message?:string}|null){if(!error)return;
 const code=error.code||'';
 if(code==='42501')throw new ApiError(403,'You do not have access to this action.');
 if(code==='P0002'||code==='PGRST116')throw new ApiError(404,'Task not found.');
 if(code==='40001'){const message=error.message?.startsWith('This task has open subtasks')?'This task has open subtasks. Complete them or confirm finishing the parent.':error.message?.startsWith('Complete the prerequisites')?'Complete the prerequisites before finishing this task.':error.message?.startsWith('A completed task depends')?'A completed task depends on this task. Reopen that task first.':error.message?.startsWith('Change the latest occurrence')?'Change the latest occurrence to adjust future repeats.':'This record changed elsewhere. Reload before saving.';throw new ApiError(409,message);}
 if(code==='23505')throw new ApiError(409,'This record already exists.');
 if(code.startsWith('22')||code==='23514'||code==='23502'||code==='23503')throw new ApiError(400,'Some fields are invalid. Check the owner, dates and required values.');
 throw new ApiError(503,'The task service is temporarily unavailable. Please retry.');
}
function decorate(ctx:APIContext,row:Record<string,unknown>){const owner=ctx.members.find(m=>m.id===row.owner_id);return {...row,owner_name:owner?.name||'Studio member',owner_initials:owner?.initials||'—',can_archive:ctx.actor.role==='founder'&&(!ctx.mfa.required||ctx.mfa.verified===true)};}
function changes(input:Record<string,unknown>,create=false){keys(input,['title','description','section','status','priority','due_date','owner_id','archived','confirmOpenSubtasks','project_id','production_stage','deliverable_id']);const out={...input};
 if(create||'title'in out)out.title=text(out.title,'Task name',200);
 if('description'in out)out.description=text(out.description,'Description',10000,false);
 if(create||'section'in out)check(SECTIONS.includes(String(out.section)),'Choose a studio section.');
 if('status'in out)check(STATUSES.includes(String(out.status)),'Invalid task status.');
 if('priority'in out)check(PRIORITIES.includes(String(out.priority)),'Invalid priority.');
 if('owner_id'in out)out.owner_id=uuid(out.owner_id);
 if('project_id'in out)out.project_id=out.project_id===null||out.project_id===''?null:uuid(out.project_id);
 if('deliverable_id'in out)out.deliverable_id=out.deliverable_id===null||out.deliverable_id===''?null:uuid(out.deliverable_id);
 if('production_stage'in out)check(out.production_stage===null||isProductionStage(out.production_stage),'Choose a valid production stage.');
 if('archived'in out)check(typeof out.archived==='boolean','Invalid archive state.');
 if('confirmOpenSubtasks'in out)check(typeof out.confirmOpenSubtasks==='boolean','Confirm the open subtask decision.');
 if('due_date'in out){if(out.due_date===''||out.due_date===null)out.due_date=null;else{check(typeof out.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(out.due_date),'Invalid due date.');const parsed=new Date(`${out.due_date}T12:00:00Z`);check(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===out.due_date,'Invalid due date.');}}
 return out;
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);dbError(error);return data;}
export async function taskPage(ctx:APIContext,input:URLSearchParams|Record<string,unknown>={}){
 const source=input instanceof URLSearchParams?Object.fromEntries(input):input;
 const page=Number(source.page||1),pageSize=Number(source.pageSize||source.page_size||200);
 check(Number.isInteger(page)&&page>=1&&page<=100000&&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=200,'Invalid task page.');
 const filters:Record<string,unknown>={page,pageSize,archived:source.archived===true||source.archived==='1',mine:source.mine===true||source.scope==='mine'};
 for(const [field,allowed] of [['section',SECTIONS],['status',STATUSES],['priority',PRIORITIES]] as Array<[string,string[]]>){if(source[field]){check(allowed.includes(String(source[field])),`Invalid ${field} filter.`);filters[field]=source[field];}}
 if(source.owner)filters.owner=uuid(source.owner);
 if(source.project_id)filters.project_id=uuid(source.project_id);
 if(source.deliverable_id)filters.deliverable_id=uuid(source.deliverable_id);
 if(source.sort){check(['due_date','priority','newest','title'].includes(String(source.sort)),'Choose a valid task sort.');filters.sort=source.sort;}
 if(source.focus){check(['open','attention','today','upcoming','blocked','overdue','unscheduled','completed'].includes(String(source.focus)),'Invalid work view.');filters.focus=source.focus;}
 if(source.search)filters.search=text(source.search,'Search',200,false);
 const result=await rpc(ctx,'nam_task_page',{w:ctx.workspaceId,filters});
 return {...result,items:(result?.items||[]).map((row:Record<string,unknown>)=>decorate(ctx,row))};
}
export async function taskStats(ctx:APIContext){return rpc(ctx,'nam_task_stats',{w:ctx.workspaceId});}
export async function notifications(ctx:APIContext){const {data,error}=await ctx.supabase.from('nam_notifications').select('id,recipient_id,task_id,body,kind,created_at,read_at').eq('workspace_id',ctx.workspaceId).eq('recipient_id',ctx.user.id).order('created_at',{ascending:false}).limit(200);dbError(error);return data||[];}
async function detail(ctx:APIContext,id:string){
 const {data:task,error}=await ctx.supabase.from('nam_tasks').select('*').eq('workspace_id',ctx.workspaceId).eq('id',id).is('deleted_at',null).maybeSingle();dbError(error);if(!task)throw new ApiError(404,'Task not found.');
 const results=await Promise.all([
  ctx.supabase.from('nam_task_comments').select('*').eq('task_id',id).order('created_at',{ascending:false}).limit(200),
  ctx.supabase.from('nam_task_subtasks').select('*').eq('task_id',id).order('created_at').limit(200),
  ctx.supabase.from('nam_task_events').select('*').eq('task_id',id).order('id',{ascending:false}).limit(50),
  ctx.supabase.from('nam_task_attachments').select('id,task_id,name,mime,byte_size,sha256,status,cleanup_error,created_by,created_at').eq('workspace_id',ctx.workspaceId).eq('task_id',id).neq('status','deleted').is('deleted_at',null).limit(200),
  task.project_id?ctx.supabase.from('nam_projects').select('id,title,brief,outcome,reference_url,due_date').eq('workspace_id',ctx.workspaceId).eq('id',task.project_id).maybeSingle():Promise.resolve({data:null,error:null}),
  task.deliverable_id?ctx.supabase.from('nam_deliverables').select('id,project_id,code,title,kind,stage,archived').eq('workspace_id',ctx.workspaceId).eq('id',task.deliverable_id).maybeSingle():Promise.resolve({data:null,error:null})
 ]);for(const result of results)dbError(result.error);
 const names=new Map(ctx.members.map(m=>[m.id,m]));
 return {...decorate(ctx,task),project:results[4].data,deliverable:results[5].data,attachments:(results[3].data||[]).map(file=>({id:file.id,task_id:file.task_id,name:file.name,mime:file.mime,size:file.byte_size,sha256:file.sha256,status:file.status,created_by:file.created_by,created_at:file.created_at,cleanupPending:file.status!=='ready'||!!file.cleanup_error})),comments:(results[0].data||[]).reverse().map(c=>({...c,author_name:names.get(c.author_id)?.name||'Studio member',initials:names.get(c.author_id)?.initials||'—'})),subtasks:results[1].data||[],events:(results[2].data||[]).map(e=>({...e,actor_name:names.get(e.actor_id)?.name||'Studio member',body:typeof e.body==='string'?e.body:typeof e.body?.message==='string'?e.body.message:Object.entries(e.body||{}).map(([k,v])=>`${k.replaceAll('_',' ')}: ${v??'not set'}`).join(' · ')}))};
}

export async function dispatchTasks(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 const [area,id,action]=path,method=request.method;
 if(area==='notifications'){
  if(path.length===1&&method==='GET')return json(await notifications(ctx));
  if(path.length===2&&id==='read'&&method==='POST'){keys(await readJSON(request),[]);await rpc(ctx,'nam_read_notifications',{w:ctx.workspaceId});return json(await notifications(ctx));}
  return null;
 }
 if(area!=='tasks')return null;
 if(path.length===1){
  if(method==='GET'){const query=new URL(request.url).searchParams;const page=await taskPage(ctx,query);return json(query.has('page')?page:page.items);}
  if(method==='POST'){const input=changes(await readJSON(request),true),key=request.headers.get('Idempotency-Key');if(key!==null)check(/^[a-zA-Z0-9_-]{8,128}$/.test(key),'Invalid retry key.');const created=await rpc(ctx,'nam_create_task',{w:ctx.workspaceId,changes:input,retry_key:key});return json(await detail(ctx,Array.isArray(created)?created[0].id:created.id),201);}
  throw new ApiError(405,'Method not allowed.');
 }
 if(path.length===2&&id==='deleted'&&method==='GET'){
  if(ctx.actor.role!=='founder')throw new ApiError(403,'Founder access is required.');
  const {data,error}=await ctx.supabase.from('nam_tasks').select('id,number,title,section,status,priority,owner_id,due_date,deleted_at,version').eq('workspace_id',ctx.workspaceId).not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(200);dbError(error);return json((data||[]).map(t=>decorate(ctx,t)));
 }
 uuid(id);
 if(path.length===2){
  if(method==='GET')return json(await detail(ctx,id));
  if(method==='PATCH'){const input=await readJSON(request);keys(input,['expectedVersion','changes']);const expected=version(input.expectedVersion),fields=changes(object(input.changes));await rpc(ctx,'nam_save_task',{w:ctx.workspaceId,task_id:id,expected_version:expected,changes:fields});return json(await detail(ctx,id));}
  if(method==='DELETE'){const input=await readJSON(request);keys(input,['expectedVersion']);version(input.expectedVersion);await rpc(ctx,'nam_task_action',{w:ctx.workspaceId,tid:id,action:'delete',input});return json({ok:true,id});}
 }
 if(path.length===3&&method==='POST'){
  const input=await readJSON(request);
  if(action==='restore'){keys(input,[]);await rpc(ctx,'nam_task_action',{w:ctx.workspaceId,tid:id,action:'restore',input});return json(await detail(ctx,id));}
  if(action==='comments'){keys(input,['body']);input.body=text(input.body,'Comment',5000);await rpc(ctx,'nam_task_action',{w:ctx.workspaceId,tid:id,action:'comment',input});return json(await detail(ctx,id),201);}
  if(action==='subtasks'){keys(input,['id','title','completed']);if(input.id){uuid(input.id);check(typeof input.completed==='boolean','Invalid subtask state.');}else input.title=text(input.title,'Subtask',200);await rpc(ctx,'nam_task_action',{w:ctx.workspaceId,tid:id,action:'subtask',input});return json(await detail(ctx,id));}
 }
 return null;
}
