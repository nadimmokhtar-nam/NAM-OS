import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder} from './context';
import {productionStages} from '../../public/production-stages.js';
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid project or deliverable.');return value;}
function failure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'You do not have access to this deliverable action.','DELIVERABLE_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'This project or deliverable is not available.','DELIVERABLE_NOT_FOUND');
 if(error.code==='40001')throw new ApiError(409,'This deliverable changed elsewhere. Reload before saving.','DELIVERABLE_CONFLICT');
 if(error.code==='23505')throw new ApiError(409,'That camera code already exists in this project. Check active and archived deliverables.','DELIVERABLE_DUPLICATE');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the camera code, production stage, date and assigned project artist.','DELIVERABLE_VALIDATION');
 throw new ApiError(503,'Deliverables could not reach their saved records. Please retry.','DELIVERABLE_UNAVAILABLE');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);if(error)failure(error);return data;}
function changes(input:Record<string,unknown>,create=false){
 fields(input,['code','title','kind','stage','artist_id','due_date','camera_notes','archived']);
 if(!Object.keys(input).length)throw new ApiError(400,'Choose fields to update.');
 if(create||'code' in input){const code=inputText(input.code,'Camera code',{max:40}).toUpperCase();if(!/^[A-Z0-9][A-Z0-9._ -]{0,39}$/.test(code))throw new ApiError(400,'Use letters, numbers, spaces, dots, underscores or hyphens in the camera code.');input.code=code;}
 if(create||'title' in input)input.title=inputText(input.title,'Deliverable name',{max:200});
 if('kind' in input&&(typeof input.kind!=='string'||!['still','animation','panorama'].includes(input.kind)))throw new ApiError(400,'Choose a deliverable type.');
 if('stage' in input&&(typeof input.stage!=='string'||!productionStages().includes(input.stage)))throw new ApiError(400,'Choose a production stage.');
 if('artist_id' in input)input.artist_id=input.artist_id===null||input.artist_id===''?null:id(input.artist_id);
 if('camera_notes' in input)input.camera_notes=inputText(input.camera_notes,'Camera brief',{max:5000,required:false});
 if('archived' in input&&typeof input.archived!=='boolean')throw new ApiError(400,'Choose a valid archive state.');
 if('due_date' in input){if(input.due_date===null||input.due_date==='')input.due_date=null;else{const value=input.due_date;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new ApiError(400,'Choose a valid target date.');}}
 return input;
}
export async function dispatchDeliverables(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 const method=request.method;
 if(path.length===3&&path[0]==='projects'&&path[2]==='deliverables'){
  const projectId=id(path[1]);
  if(method==='GET'){
   const params=new URL(request.url).searchParams;for(const key of params.keys())if(!['page','page_size','search','sort','kind','stage','archived'].includes(key))throw new ApiError(400,'Unsupported deliverable filter.');
   const page=Number(params.get('page')||1),pageSize=Number(params.get('page_size')||100),archived=params.get('archived');
   if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||archived!==null&&!['0','1'].includes(archived))throw new ApiError(400,'Choose a valid deliverable page.');
   const search=inputText(params.get('search')||'','Search',{max:200,required:false}),sort=params.get('sort')||'code',kind=params.get('kind')||'',stage=params.get('stage')||'';
   if(!['code','title','due_date','stage'].includes(sort)||kind&&!['still','animation','panorama'].includes(kind)||stage&&!productionStages().includes(stage))throw new ApiError(400,'Choose valid deliverable filters.');
   return json(await rpc(ctx,'nam_deliverable_page',{w:ctx.workspaceId,pid:projectId,filters:{page,pageSize,archived:archived==='1',search,sort,kind,stage}}));
  }
  if(method==='POST'){
   requireFounder(ctx);const input=changes(await readJSON(request),true),key=request.headers.get('Idempotency-Key');
   if(key!==null&&!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new ApiError(400,'Invalid request key.');
   const deliverableId=await rpc(ctx,'nam_save_deliverable',{w:ctx.workspaceId,did:null,expected_version:null,changes:{...input,project_id:projectId},retry_key:key});
   return json(await rpc(ctx,'nam_deliverable_detail',{w:ctx.workspaceId,did:deliverableId}),201);
  }
 }
 if(path.length===2&&path[0]==='deliverables'){
  const deliverableId=id(path[1]);
  if(method==='GET')return json(await rpc(ctx,'nam_deliverable_detail',{w:ctx.workspaceId,did:deliverableId}));
  if(method==='PATCH'){
   const input=await readJSON(request);fields(input,['expectedVersion','changes']);
   if(!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<1||!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw new ApiError(400,'A deliverable version and changed fields are required.');
   const edit=changes(input.changes as Record<string,unknown>);
   if(ctx.actor.role!=='founder'&&Object.keys(edit).some(key=>!['stage','camera_notes'].includes(key)))throw new ApiError(403,'Only the project owner can change assignment or delivery details.');
   await rpc(ctx,'nam_save_deliverable',{w:ctx.workspaceId,did:deliverableId,expected_version:input.expectedVersion,changes:edit,retry_key:null});
   return json(await rpc(ctx,'nam_deliverable_detail',{w:ctx.workspaceId,did:deliverableId}));
  }
 }
 return null;
}
