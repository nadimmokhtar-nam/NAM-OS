import 'server-only';
import {createHash} from 'node:crypto';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder,requireLiveContext} from './context';
import {clientProvider} from './client-review-auth';

const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const stages=['Briefing','Modelling','Camera approval','Materials and lighting','Draft production','Internal review','Client review','Revisions','Final approval','Delivery'];
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid project or phase.');return value;}
function failure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'You do not have access to this project action.');
 if(error.code==='P0002')throw new ApiError(404,'This project, phase or cover is not available.');
 if(['40001','23505'].includes(error.code||''))throw new ApiError(409,'This plan changed elsewhere. Reload its saved records before changing it.');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the phase dates, status and project fields.');
 throw new ApiError(503,'The project plan could not reach its saved records. Retry the same request.');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,{...args,w:ctx.workspaceId});if(error)failure(error);return data;}
function changes(value:Record<string,unknown>,create:boolean){
 fields(value,['title','production_stage','start_date','end_date','status','note','position','archived']);
 if(!Object.keys(value).length)throw new ApiError(400,'Choose the phase fields to save.');
 if(create||'title' in value)value.title=inputText(value.title,'Phase title',{max:100});
 if('note' in value)value.note=inputText(value.note,'Shared phase notes',{max:5000,required:false});
 if('production_stage' in value){if(value.production_stage===''||value.production_stage===null)value.production_stage=null;else if(!stages.includes(String(value.production_stage)))throw new ApiError(400,'Choose a supported production stage.');}
 for(const key of ['start_date','end_date'])if(key in value&&value[key]!==null&&value[key]!==''){
  const date=value[key];if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'0001-01-01'||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new ApiError(400,'Choose valid phase dates.');
 }
 if('status' in value&&!['planned','in_progress','complete','cancelled'].includes(String(value.status)))throw new ApiError(400,'Choose a valid phase status.');
 if('position' in value&&(!Number.isSafeInteger(value.position)||Number(value.position)<1||Number(value.position)>1000))throw new ApiError(400,'Phase order must be between 1 and 1000.');
 if('archived' in value&&typeof value.archived!=='boolean')throw new ApiError(400,'Choose a valid phase archive state.');
 return value;
}
type Storage=ReturnType<typeof clientProvider>['storage'];
export async function dispatchProjectPlanning(ctx:APIContext,path:string[],request:Request,internal:{storage?:Storage}={}):Promise<Response|null>{
 if(path[0]!=='projects'||path.length<3||!['plan','phases','cover','cover-choices'].includes(path[2]))return null;
 const pid=id(path[1]),action=path[2],method=request.method,query=new URL(request.url).searchParams;
 if(action==='plan'&&path.length===3&&method==='GET'){
  if([...query.keys()].some(k=>k!=='archived')||query.has('archived')&&!['0','1'].includes(query.get('archived')||''))throw new ApiError(400,'Choose a valid phase view.');
  return json(await rpc(ctx,'nam_project_plan',{pid,include_archived:query.get('archived')==='1'}));
 }
 if(action==='phases'&&((path.length===3&&method==='POST')||(path.length===4&&method==='PATCH'))){
  requireFounder(ctx);const input=await readJSON(request);fields(input,path.length===3?['changes']:['expectedVersion','changes']);
  if(!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw new ApiError(400,'Phase fields are required.');
  const expected=path.length===3?null:input.expectedVersion;if(expected!==null&&(!Number.isSafeInteger(expected)||Number(expected)<1))throw new ApiError(400,'A valid saved phase version is required.');
  const retry=request.headers.get('Idempotency-Key');if(!retry||!/^[A-Za-z0-9_-]{8,128}$/.test(retry))throw new ApiError(400,'A stable phase request key is required.');
  const payload=changes(input.changes as Record<string,unknown>,path.length===3);await requireLiveContext(ctx,{founder:true});
  const phaseId=await rpc(ctx,'nam_save_project_phase',{pid,phase_id:path.length===4?id(path[3]):null,expected_version:expected,payload,retry_key:retry});
  return json({id:phaseId,plan:await rpc(ctx,'nam_project_plan',{pid,include_archived:payload.archived===true})},path.length===3?201:200);
 }
 if(action==='cover-choices'&&path.length===3&&method==='GET'){
  requireFounder(ctx);if([...query.keys()].some(k=>!['search','page'].includes(k)))throw new ApiError(400,'Choose a valid cover image page.');
  const page=Number(query.get('page')||1),search=query.get('search')||'';if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>200)throw new ApiError(400,'Choose a valid cover image page.');
  return json(await rpc(ctx,'nam_review_images_page',{pid,page,search}));
 }
 if(action==='cover'&&path.length===3&&method==='GET'){
  const variant=query.get('variant')||'preview';if([...query.keys()].some(k=>k!=='variant')||!['preview','thumbnail'].includes(variant))throw new ApiError(400,'Choose a valid project cover view.');
  await requireLiveContext(ctx);const ticket=await rpc(ctx,'nam_project_cover_media',{pid,variant}),storage=internal.storage||clientProvider(true).storage;
  const {data,error}=await storage.from('nam-render-versions').download(ticket.path);if(error||!data)throw new ApiError(503,'The project cover could not load. Please retry.');
  if(data.size!==Number(ticket.size)||data.size>52428800)throw new ApiError(503,'The project cover could not be verified.');
  const bytes=Buffer.from(await data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==ticket.sha256)throw new ApiError(503,'The project cover could not be verified.');
  await requireLiveContext(ctx);const current=await rpc(ctx,'nam_project_cover_media',{pid,variant});if(current.path!==ticket.path||current.sha256!==ticket.sha256)throw new ApiError(409,'The project cover changed while loading. Reload the project.');
  return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'image/webp','Content-Length':String(bytes.length),'Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
 }
 throw new ApiError(405,'Method not allowed.');
}
