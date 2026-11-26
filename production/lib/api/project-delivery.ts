import 'server-only';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder,requireLiveContext} from './context';
import {type ClientContext,requireClientLive,reviewRPC} from './client-context';

const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid project, round or delivery.');return value;}
function revision(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1)throw new ApiError(400,'A saved record version is required.');return Number(value);}
function key(request:Request,max=128){const value=request.headers.get('Idempotency-Key');if(!value||!new RegExp('^[A-Za-z0-9_-]{8,'+max+'}$').test(value))throw new ApiError(400,'A stable request identity is required.');return value;}
function failure(error:{code?:string;message?:string}){
 if(error.code==='42501')throw new ApiError(403,'You do not have access to this project action.');
 if(error.code==='P0002')throw new ApiError(404,'This project, round, delivery or image is not available.');
 if(['40001','23505'].includes(error.code||''))throw new ApiError(409,error.message?.startsWith('Resolve this round')?'Resolve the round’s tasks before closing it.':'This project changed. Reload its saved records before changing the request.');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,error.message?.startsWith('Mark each selected')?'Mark each selected image Final approval before issuing final delivery.':'Check the images, current versions, assigned artists, recipients and dates.');
 throw new ApiError(503,'The project could not confirm this request. Keep the original request and retry it.');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,{...args,w:ctx.workspaceId});if(error)failure(error);return data;}
function day(value:unknown){if(value===null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new ApiError(400,'Choose a valid revision deadline.');return value;}
function images(value:unknown,round:boolean){
 if(!Array.isArray(value)||value.length<1||value.length>100)throw new ApiError(400,'Select between 1 and 100 verified images.');
 const seen=new Set<string>();return value.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiError(400,'Choose valid image details.');const entry=raw as Record<string,unknown>;fields(entry,round?['deliverable_id','render_id','expected_version','instruction']:['deliverable_id','render_id','expected_version']);
  const did=id(entry.deliverable_id);if(seen.has(did))throw new ApiError(400,'Choose each image once.');seen.add(did);
  return {deliverable_id:did,render_id:id(entry.render_id),expected_version:revision(entry.expected_version),...(round?{instruction:inputText(entry.instruction,'Revision instruction',{max:5000})}:{})};
 });
}
function page(request:Request,allowed:string[]=[]){const query=new URL(request.url).searchParams;if([...query.keys()].some(k=>!['page',...allowed].includes(k)))throw new ApiError(400,'Unsupported project filter.');const page=Number(query.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw new ApiError(400,'Choose a valid page.');return {page,query};}
function manifest(value:unknown){return new Response(JSON.stringify(value,null,2)+'\n',{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="NAM-final-delivery.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});}

export async function dispatchProjectDelivery(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 const method=request.method;
 if(path[0]==='projects'&&path.length===3&&['revisions','deliveries','round-images'].includes(path[2])){
  const pid=id(path[1]),action=path[2];
  if(method==='GET'){
   const parsed=page(request,action==='round-images'?['search','final']:[]);
   if(action==='round-images'){
    requireFounder(ctx);const search=parsed.query.get('search')||'',final=parsed.query.get('final')||'0';if(search.length>200||!['0','1'].includes(final))throw new ApiError(400,'Choose valid image filters.');
    return json(await rpc(ctx,'nam_project_round_images',{pid,final_only:final==='1',search,page:parsed.page}));
   }
   return json(await rpc(ctx,action==='revisions'?'nam_revision_round_page':'nam_project_delivery_page',{pid,page:parsed.page}));
  }
  if(method==='POST'&&action!=='round-images'){
   requireFounder(ctx);const round=action==='revisions',input=await readJSON(request,round?2100000:64000);fields(input,round?['title','brief','due_date','review_request_id','items']:['title','message','items','recipients']);
   const payload:Record<string,unknown>={title:inputText(input.title,round?'Round title':'Delivery title',{max:200}),items:images(input.items,round)};
   if(round){payload.brief=inputText(input.brief??'','Shared round brief',{max:5000,required:false});payload.due_date=day(input.due_date??null);payload.review_request_id=input.review_request_id?id(input.review_request_id):null;}
   else{payload.message=inputText(input.message??'','Delivery message',{max:5000,required:false});if(!Array.isArray(input.recipients)||input.recipients.length<1||input.recipients.length>20)throw new ApiError(400,'Choose between 1 and 20 invited clients.');const recipients=input.recipients.map(id);if(new Set(recipients).size!==recipients.length)throw new ApiError(400,'Choose each recipient once.');payload.recipients=recipients;}
   const retry=key(request,round?128:110);await requireLiveContext(ctx,{founder:true});const rid=await rpc(ctx,round?'nam_open_revision_round':'nam_issue_project_delivery',{pid,payload,retry_key:retry});
   return json(await rpc(ctx,round?'nam_revision_round_detail':'nam_project_delivery_detail',{[round?'rid':'did']:rid}),201);
  }
  throw new ApiError(405,'Method not allowed.');
 }
 if(!['revision-rounds','final-deliveries'].includes(path[0])||![2,3].includes(path.length))return null;
 const round=path[0]==='revision-rounds',rid=id(path[1]),action=path[2]||'';
 if(method==='GET'&&!action)return json(await rpc(ctx,round?'nam_revision_round_detail':'nam_project_delivery_detail',{[round?'rid':'did']:rid}));
 if(method==='GET'&&action==='manifest'&&!round){
  const record=await rpc(ctx,'nam_project_delivery_detail',{did:rid});return manifest({format:'NAM Studio final delivery',version:1,title:record.title,number:record.number,status:record.status,issued_at:record.created_at,files:record.manifest});
 }
 if(method==='POST'&&action===(round?'close':'cancel')){
  requireFounder(ctx);const input=await readJSON(request);fields(input,['expectedVersion']);await requireLiveContext(ctx,{founder:true});await rpc(ctx,round?'nam_close_revision_round':'nam_cancel_project_delivery',{[round?'rid':'did']:rid,expected_version:revision(input.expectedVersion)});
  return json(await rpc(ctx,round?'nam_revision_round_detail':'nam_project_delivery_detail',{[round?'rid':'did']:rid}));
 }
 throw new ApiError(405,'Method not allowed.');
}
export async function dispatchClientDelivery(ctx:ClientContext,path:string[],request:Request):Promise<Response|null>{
 if(request.method!=='GET'||path.length!==4||path[0]!=='client'||path[1]!=='reviews'||path[3]!=='manifest')return null;
 if(new URL(request.url).search)throw new ApiError(400,'Unsupported manifest filter.');await requireClientLive(ctx);const value=await reviewRPC(ctx,'nam_client_delivery_manifest',{qid:id(path[2])});await requireClientLive(ctx);await reviewRPC(ctx,'nam_client_delivery_manifest',{qid:id(path[2])});return manifest(value);
}
