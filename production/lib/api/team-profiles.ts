import 'server-only';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder,requireLiveContext} from './context';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS=['assignment','due','overdue'];
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid member or department.','INVALID_TEAM_ID');return value;}
function failure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'Current verified workspace access is required.','TEAM_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'This active member or department is unavailable.','TEAM_NOT_FOUND');
 if(error.code==='40001')throw new ApiError(409,'These settings changed elsewhere. Reload their saved values before editing.','TEAM_CONFLICT');
 if(error.code==='23505')throw new ApiError(409,'A department already uses that name.','TEAM_NAME_CONFLICT');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the supported profile, department or notification fields.','INVALID_TEAM_METADATA');
 throw new ApiError(503,'The saved team settings could not be reached. Retry the same change.','TEAM_UNAVAILABLE');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>={}){const {data,error}=await ctx.supabase.rpc(name,{...args,w:ctx.workspaceId});if(error)failure(error);return data;}
function page(query:URLSearchParams,allowed:string[]){
 if([...query.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>query.getAll(key).length>1))throw new ApiError(400,'Choose a supported settings filter.');
 const value=query.get('page')||'1';if(!/^[1-9][0-9]{0,5}$/.test(value)||Number(value)>100000)throw new ApiError(400,'Choose a valid settings page.');return Number(value);
}
function text(value:unknown,label:string,max:number,required=true){const result=inputText(value,label,{max,required});if(/[\u0000-\u001f\u007f]/.test(result))throw new ApiError(400,`${label} must fit on one line.`);return result;}
async function save(ctx:APIContext,request:Request,operation:string,target:string|null,create=false){
 const input=await readJSON(request);fields(input,create?['changes']:['expectedRevision','changes']);
 const revision=create?0:input.expectedRevision;if(!Number.isSafeInteger(revision)||Number(revision)<0)throw new ApiError(400,'A valid saved settings revision is required.');
 const value=input.changes;if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'The settings fields are required.');
 const changes=value as Record<string,unknown>;
 if(operation==='profile'){
  fields(changes,['name','job_title']);changes.name=text(changes.name,'Name',100);changes.job_title=text(changes.job_title,'Job title',100,false);
 }else if(operation==='notifications'){
  fields(changes,EVENTS);if(EVENTS.some(event=>typeof changes[event]!=='boolean'))throw new ApiError(400,'Choose each supported task inbox event.');
 }else if(operation==='department'){
  fields(changes,['name','archived']);changes.name=text(changes.name,'Department name',80);if(typeof changes.archived!=='boolean')throw new ApiError(400,'Choose a valid department archive state.');
 }else{
  fields(changes,['department_id']);if(changes.department_id!==null)id(changes.department_id);
 }
 const retry=request.headers.get('Idempotency-Key');if(!retry||!/^[A-Za-z0-9_-]{8,128}$/.test(retry))throw new ApiError(400,'A stable settings request key is required.');
 await requireLiveContext(ctx,{founder:['department','member_department'].includes(operation)});
 return rpc(ctx,'nam_save_team_metadata',{operation,target_id:target,expected_version:revision,payload:changes,retry_key:retry});
}

/** Ordinary metadata uses only the original caller's Supabase client. The
 * enclosing route retains its existing Origin/CSRF protection for all writes. */
export async function dispatchTeamProfiles(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path[0]!=='team'||!['profile','preferences','directory','departments','members','history'].includes(path[1]))return null;
 const method=request.method,area=path[1],query=new URL(request.url).searchParams;
 if(area==='profile'&&path.length===2&&method==='GET'){
  page(query,[]);await requireLiveContext(ctx);return json(await rpc(ctx,'nam_team_profile'));
 }
 if(['profile','preferences'].includes(area)&&path.length===2&&method==='PATCH'){
  if(query.size)throw new ApiError(400,'Settings updates do not accept query filters.');
  return json(await save(ctx,request,area==='profile'?'profile':'notifications',ctx.user.id));
 }
 if(area==='directory'&&path.length===2&&method==='GET'){
  requireFounder(ctx);const number=page(query,['page','search','department']),search=query.get('search')||'',department=query.get('department');if(search.length>100)throw new ApiError(400,'Search must be at most 100 characters.');if(department)id(department);
  await requireLiveContext(ctx,{founder:true});return json(await rpc(ctx,'nam_team_directory',{page:number,search,department:department||null}));
 }
 if(area==='departments'&&path.length===2&&method==='GET'){
  requireFounder(ctx);const number=page(query,['page','archived']);if(query.has('archived')&&!['0','1'].includes(query.get('archived')||''))throw new ApiError(400,'Choose a valid department archive filter.');
  await requireLiveContext(ctx,{founder:true});return json(await rpc(ctx,'nam_team_departments',{page:number,include_archived:query.get('archived')==='1'}));
 }
 if(area==='departments'&&((path.length===2&&method==='POST')||(path.length===3&&method==='PATCH'))){
  requireFounder(ctx);if(query.size)throw new ApiError(400,'Department updates do not accept query filters.');return json(await save(ctx,request,'department',path.length===3?id(path[2]):null,path.length===2),path.length===2?201:200);
 }
 if(area==='members'&&path.length===4&&path[3]==='department'&&method==='PATCH'){
  requireFounder(ctx);if(query.size)throw new ApiError(400,'Department updates do not accept query filters.');return json(await save(ctx,request,'member_department',id(path[2])));
 }
 if(area==='history'&&path.length===2&&method==='GET'){
  const number=page(query,['page']);await requireLiveContext(ctx);return json(await rpc(ctx,'nam_team_history',{page:number}));
 }
 throw new ApiError(405,'Method not allowed.');
}
