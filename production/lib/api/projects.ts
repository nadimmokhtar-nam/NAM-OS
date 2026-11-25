import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder} from './context';

const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function identifier(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid project or participant.');return value;}
function failure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'You do not have access to this project action.','PROJECT_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'Project not found.','PROJECT_NOT_FOUND');
 if(error.code==='40001'||error.code==='23505')throw new ApiError(409,'This project changed elsewhere. Reload before saving.','PROJECT_CONFLICT');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the project fields and eligible participants.','PROJECT_VALIDATION');
 throw new ApiError(503,'Projects could not reach their saved records. Please retry.','PROJECT_UNAVAILABLE');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);if(error)failure(error);return data;}
function changes(input:Record<string,unknown>,create=false){
 fields(input,['title','brief','outcome','reference_url','start_date','due_date','client_name','project_type','location','cover_render_id','lead_id','member_ids','archived']);
 if(create||'title' in input)input.title=inputText(input.title,'Project name',{max:200});
 for(const [field,max] of [['brief',10000],['outcome',5000]] as const)if(field in input)input[field]=inputText(input[field],field==='brief'?'Creative brief':'Definition of done',{max,required:false});
 if('reference_url' in input){
  const value=inputText(input.reference_url,'Reference link',{max:2000,required:false});
  if(value){let url:URL;try{url=new URL(value);}catch{throw new ApiError(400,'Use a complete HTTPS reference link.');}if(url.protocol!=='https:'||url.username||url.password)throw new ApiError(400,'Use an HTTPS reference link without embedded credentials.');}
  input.reference_url=value;
 }
 for(const key of ['start_date','due_date'])if(key in input&&input[key]!==null&&input[key]!==''){
  const value=input[key];if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||value<'0001-01-01')throw new ApiError(400,'Choose valid project dates.');
 }
 for(const [key,max] of [['client_name',200],['project_type',100],['location',200]] as const)if(key in input)input[key]=inputText(input[key],key==='client_name'?'Client / company':key==='project_type'?'Project type':'Location',{max,required:false});
 if('cover_render_id' in input){if(input.cover_render_id===null||input.cover_render_id==='')input.cover_render_id=null;else identifier(input.cover_render_id);}
 if('lead_id' in input)identifier(input.lead_id);
 if('member_ids' in input){if(!Array.isArray(input.member_ids)||input.member_ids.length>100)throw new ApiError(400,'Choose at most 100 project participants.');input.member_ids=[...new Set(input.member_ids.map(identifier))];}
 if('archived' in input&&typeof input.archived!=='boolean')throw new ApiError(400,'Choose a valid project archive state.');
 return input;
}
export async function dispatchProjects(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path[0]!=='projects')return null;
 if(path.length===1&&request.method==='GET'){
  const archived=new URL(request.url).searchParams.get('archived');
  if(archived!==null&&!['0','1'].includes(archived))throw new ApiError(400,'Invalid project archive filter.');
  return json({items:await rpc(ctx,'nam_project_list',{w:ctx.workspaceId,include_archived:archived==='1'}),limit:200,task_scope:ctx.actor.role==='founder'?'studio':'assigned'});
 }
 if(path.length===1&&request.method==='POST'){
  requireFounder(ctx);const input=changes(await readJSON(request),true),key=request.headers.get('Idempotency-Key');
  if(key!==null&&!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new ApiError(400,'Invalid project retry key.');
  const id=await rpc(ctx,'nam_save_project',{w:ctx.workspaceId,pid:null,expected_version:null,changes:input,retry_key:key});
  return json(await rpc(ctx,'nam_project_detail',{w:ctx.workspaceId,pid:id}),201);
 }
 if(path.length!==2)return null;
 const id=identifier(path[1]);
 if(request.method==='GET')return json(await rpc(ctx,'nam_project_detail',{w:ctx.workspaceId,pid:id}));
 if(request.method==='PATCH'){
  requireFounder(ctx);const input=await readJSON(request);fields(input,['expectedVersion','changes']);
  if(!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<1||!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw new ApiError(400,'A project revision and fields are required.');
  await rpc(ctx,'nam_save_project',{w:ctx.workspaceId,pid:id,expected_version:input.expectedVersion,changes:changes(input.changes as Record<string,unknown>),retry_key:null});
  return json(await rpc(ctx,'nam_project_detail',{w:ctx.workspaceId,pid:id}));
 }
 throw new ApiError(405,'Method not allowed.');
}
