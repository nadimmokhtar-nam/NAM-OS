import 'server-only';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder,requireLiveContext} from './context';
import {clientProvider} from './client-review-auth';
import {prepareRender,renderHash} from './render-media';

const BUCKET='nam-project-resources',MAX_BYTES=20*1024*1024;
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const COLUMNS='id,project_id,parent_id,kind,title,visibility,document,reference_url,archived,version,file_name,mime,byte_size,status,width,height,created_by,created_at,updated_at';
const kinds=['folder','file','note','meeting','reference','board'];
type Service=ReturnType<typeof clientProvider>;
type Dependencies={service?:Service;storageOrigin?:string};
type Ticket={id:string;project_id:string;version:number;status:string;path:string;mime:string;size:number;sha256:string;file_name:string};
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid project resource.');return value;}
function version(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>2147483647)throw new ApiError(400,'A saved resource version is required.');return Number(value);}
function retryKey(request:Request){const key=request.headers.get('Idempotency-Key');if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new ApiError(400,'A stable resource request key is required.');return key;}
function failure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'Current Founder or project access is required.','RESOURCE_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'This project resource is not available.','RESOURCE_NOT_FOUND');
 if(['40001','23505'].includes(error.code||''))throw new ApiError(409,'This resource changed or its upload is incomplete. Reload the saved version before applying your changes.','RESOURCE_CONFLICT');
 if(error.code==='54000')throw new ApiError(413,'The project resource or private storage allowance has been reached. Archive unfinished uploads before adding more.','RESOURCE_QUOTA');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the resource fields, image references, visibility and folder.','RESOURCE_VALIDATION');
 throw new ApiError(503,'Project resources are temporarily unavailable. Retry the same saved request.','RESOURCE_UNAVAILABLE');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,{w:ctx.workspaceId,...args});if(error)failure(error);return data;}
async function resource(ctx:APIContext,rid:string,pid?:string){
 let query=ctx.supabase.from('nam_project_resources').select(COLUMNS).eq('workspace_id',ctx.workspaceId).eq('id',rid);if(pid)query=query.eq('project_id',pid);
 const {data,error}=await query.maybeSingle();if(error)failure(error);if(!data)throw new ApiError(404,'This project resource is not available.','RESOURCE_NOT_FOUND');return data;
}
export function projectReferenceURL(value:unknown,required=false){
 const text=inputText(value,'Reference URL',{max:2000,required});if(!text)return '';
 let url:URL;try{url=new URL(text);}catch{throw new ApiError(400,'Enter a complete public HTTPS reference.');}
 // Links are never fetched, embedded or used as image sources. The same strict
 // host syntax exists in PostgreSQL so RPC callers cannot store other schemes.
 if(url.protocol!=='https:'||url.username||url.password||url.port||/[\s\\\x00-\x1f\x7f]/.test(text)||!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)||url.href.length>2000)throw new ApiError(400,'Enter a public HTTPS reference without credentials or a custom port.');
 return url.href;
}
function document(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>150000)throw new ApiError(400,'The resource content is invalid or too large.');
 return value as Record<string,unknown>;
}
function changes(value:unknown,create:boolean){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'Resource fields are required.');
 const payload={...value as Record<string,unknown>};fields(payload,create?['kind','title','parent_id','visibility','document','reference_url','archived','file_name','mime','byte_size','sha256']:['title','parent_id','visibility','document','reference_url','archived']);
 if(!Object.keys(payload).length)throw new ApiError(400,'Choose the resource fields to save.');
 if(create){if(!kinds.includes(String(payload.kind)))throw new ApiError(400,'Choose a supported resource type.');}
 if(create||'title' in payload){payload.title=inputText(payload.title,'Resource name',{max:150});if(/[\x00-\x1f\x7f]/.test(String(payload.title)))throw new ApiError(400,'Use a resource name without control characters.');}
 if('parent_id' in payload)payload.parent_id=payload.parent_id===null?null:id(payload.parent_id);
 if('visibility' in payload&&!['project','founder'].includes(String(payload.visibility)))throw new ApiError(400,'Choose Project team or Founder only visibility.');
 if('archived' in payload&&typeof payload.archived!=='boolean')throw new ApiError(400,'Choose a valid archive state.');
 if('reference_url' in payload)payload.reference_url=projectReferenceURL(payload.reference_url,payload.kind==='reference');
 if('document' in payload){
  const content=document(payload.document);payload.document=content;
  if('sections' in content){
   fields(content,['sections']);if(!Array.isArray(content.sections)||content.sections.length>20)throw new ApiError(400,'A pinboard can contain up to 20 sections.');let total=0;
   for(const raw of content.sections){const section=document(raw);fields(section,['id','title','items']);id(section.id);section.title=inputText(section.title,'Section title',{max:100});if(!Array.isArray(section.items)||(total+=section.items.length)>200)throw new ApiError(400,'A pinboard can contain up to 200 images.');
    for(const rawItem of section.items){const item=document(rawItem);fields(item,['id','file_id','caption','reference_url']);id(item.id);id(item.file_id);item.caption=inputText(item.caption,'Image caption',{max:500,required:false});item.reference_url=projectReferenceURL(item.reference_url);}
   }
  }
 }
 if(create&&payload.kind==='file'){
  const name=inputText(payload.file_name,'File name',{max:150}),mime=String(payload.mime),extension=mime==='image/jpeg'?/\.jpe?g$/i:mime==='image/png'?/\.png$/i:mime==='application/pdf'?/\.pdf$/i:mime==='text/plain'?/\.txt$/i:null;
  if(!extension||!extension.test(name)||/[\x00-\x1f\x7f/\\]/.test(name)||name.startsWith('.')||name.includes('..'))throw new ApiError(400,'Choose a JPEG, PNG, PDF or plain text file with a matching extension.');
  if(!Number.isSafeInteger(payload.byte_size)||Number(payload.byte_size)<1||Number(payload.byte_size)>MAX_BYTES)throw new ApiError(413,'Choose a file of at most 20 MiB.');
  if(typeof payload.sha256!=='string'||!/^[a-f0-9]{64}$/.test(payload.sha256))throw new ApiError(400,'The file fingerprint is missing.');payload.file_name=name;
 }
 return payload;
}
async function downloaded(service:Service,ticket:Ticket){
 const {data,error}=await service.storage.from(BUCKET).download(ticket.path);if(error||!data)throw new ApiError(409,'The private upload is incomplete. Retry the original file.','RESOURCE_UPLOAD_INCOMPLETE');
 if(data.size!==Number(ticket.size)||data.size<1||data.size>MAX_BYTES)throw new ApiError(409,'The stored file size differs from its reservation.','RESOURCE_INTEGRITY');
 const bytes=Buffer.from(await data.arrayBuffer());if(renderHash(bytes)!==ticket.sha256)throw new ApiError(409,'The stored file fingerprint differs. Archive this upload and choose the original file again.','RESOURCE_INTEGRITY');return bytes;
}
async function uploadPlan(ctx:APIContext,rid:string,service:Service,origin:string){
 const ticket=await rpc(ctx,'nam_project_resource_ticket',{rid,variant:'upload'}) as Ticket;
 if(ticket.status==='ready')return {id:rid,status:'ready',resource:await resource(ctx,rid)};
 let uploaded=false;try{await downloaded(service,ticket);uploaded=true;}catch(error){if(!(error instanceof ApiError)||error.code!=='RESOURCE_UPLOAD_INCOMPLETE')throw error;}
 const reserved={id:rid,status:'pending',mime:ticket.mime,sha256:ticket.sha256,size:Number(ticket.size),fileName:ticket.file_name,expectedVersion:ticket.version};
 if(uploaded)return {...reserved,uploaded:true};
 await requireLiveContext(ctx,{founder:true});
 const {data,error}=await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(ticket.path,{upsert:false});if(error||!data?.signedUrl)throw new ApiError(503,'The private file upload could not be opened. Keep the original file and retry.');
 let target:URL,expected:URL;try{target=new URL(data.signedUrl);expected=new URL(origin);}catch{throw new ApiError(503,'The private upload destination is invalid.');}
 if(target.origin!==expected.origin||target.username||target.password||!(target.protocol==='https:'||target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname)))throw new ApiError(503,'The private upload destination is invalid.');
 return {...reserved,uploaded:false,uploadUrl:target.href};
}
async function verifyFile(bytes:Buffer,mime:string){
 if(mime==='image/jpeg'||mime==='image/png'){const image=await prepareRender(bytes,mime);return {sha256:image.sha256,width:image.width,height:image.height,preview:image.preview};}
 if(mime==='text/plain'){
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ApiError(400,'Choose a complete UTF-8 plain text file.');}
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw new ApiError(400,'The file contains unsupported plain text control characters.');
 }else if(mime==='application/pdf'){
  if(!/^%PDF-(1\.[0-7]|2\.0)(?:\r|\n)/.test(bytes.subarray(0,20).toString('latin1'))||!/%%EOF[\t\r\n ]*$/.test(bytes.subarray(-2048).toString('latin1')))throw new ApiError(400,'Choose a complete PDF file.');
 }else throw new ApiError(400,'This resource file format is not supported.');
 return {sha256:renderHash(bytes),width:null,height:null,preview:null};
}

export async function dispatchProjectResources(ctx:APIContext,path:string[],request:Request,internal:Dependencies={}):Promise<Response|null>{
 const method=request.method,query=new URL(request.url).searchParams;
 if(path[0]==='projects'&&path[2]==='resources'&&(path.length===3||path.length===4)){
  const pid=id(path[1]),rid=path.length===4?id(path[3]):null;
  if(method==='GET'){
   if(rid){if([...query.keys()].length)throw new ApiError(400,'This resource does not accept filters.');await requireLiveContext(ctx);return json(await resource(ctx,rid,pid));}
   if([...query.keys()].some(k=>!['page','folder','kind','search','sort','archived'].includes(k))||query.has('archived')&&!['0','1'].includes(query.get('archived')||''))throw new ApiError(400,'Choose a valid resource view.');
   const page=Number(query.get('page')||1),folder=query.get('folder')||null,kind=query.get('kind')||'files',search=query.get('search')||'',sort=query.get('sort')||'name';
   if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>150||!['all','files','notes','boards','images','references'].includes(kind)||!['name','created'].includes(sort))throw new ApiError(400,'Choose a valid resource page or filter.');
   if(folder)id(folder);return json(await rpc(ctx,'nam_project_resource_page',{pid,filters:{page,folder,kind,search,sort,archived:query.get('archived')==='1'}}));
  }
  if(!rid&&method==='POST'||rid&&method==='PATCH'){
   requireFounder(ctx);if([...query.keys()].length)throw new ApiError(400,'Resource writes do not accept filters.');const input=await readJSON(request,180000);fields(input,rid?['expectedVersion','changes']:['changes']);
   const expected=rid?version(input.expectedVersion):null,payload=changes(input.changes,!rid),key=retryKey(request);
   // Verify that a trusted verifier exists before reserving private storage.
   const service=payload.kind==='file'?(internal.service||clientProvider(true)):null;await requireLiveContext(ctx,{founder:true});
   const saved=await rpc(ctx,'nam_save_project_resource',{pid,rid,expected_version:expected,payload,retry_key:key});
   if(service)return json(await uploadPlan(ctx,saved,service,internal.storageOrigin||process.env.NEXT_PUBLIC_SUPABASE_URL||''),201);
   return json(await resource(ctx,saved,pid),rid?200:201);
  }
  throw new ApiError(405,'Method not allowed.');
 }
 if(path[0]!=='project-resources')return null;
 if(path.length!==3)throw new ApiError(405,'Method not allowed.');const rid=id(path[1]),action=path[2];
 if(action==='upload'&&method==='POST'){
  requireFounder(ctx);fields(await readJSON(request),[]);retryKey(request);await requireLiveContext(ctx,{founder:true});return json(await uploadPlan(ctx,rid,internal.service||clientProvider(true),internal.storageOrigin||process.env.NEXT_PUBLIC_SUPABASE_URL||''));
 }
 if(action==='finish'&&method==='POST'){
  requireFounder(ctx);const input=await readJSON(request);fields(input,['expectedVersion']);const expected=version(input.expectedVersion),key=retryKey(request),service=internal.service||clientProvider(true);await requireLiveContext(ctx,{founder:true});
  const ticket=await rpc(ctx,'nam_project_resource_ticket',{rid,variant:'upload'}) as Ticket;if(ticket.status==='ready')return json(await resource(ctx,rid));
  const bytes=await downloaded(service,ticket),verified=await verifyFile(bytes,ticket.mime);await requireLiveContext(ctx,{founder:true});
  if(verified.preview){
   // Never overwrite a derivative after a lost finish response. An existing
   // object is accepted only when its exact bytes match this decoded image.
   await service.storage.from(BUCKET).upload(ticket.path+'.preview.webp',Uint8Array.from(verified.preview),{contentType:'image/webp',upsert:false,cacheControl:'0'});
   await downloaded(service,{...ticket,path:ticket.path+'.preview.webp',size:verified.preview.length,sha256:renderHash(verified.preview)});
  }
  await requireLiveContext(ctx,{founder:true});
  const {error}=await service.rpc('nam_attest_project_resource',{w:ctx.workspaceId,rid,expected_version:expected,verified_actor:ctx.user.id,verified_session:ctx.sessionId,verified_aal2:ctx.mfa.verified,evidence:{sha256:verified.sha256,width:verified.width,height:verified.height,preview_size:verified.preview?.length??null,preview_sha256:verified.preview?renderHash(verified.preview):null},retry_key:key});if(error)failure(error);
  return json(await resource(ctx,rid));
 }
 if(action==='content'&&method==='GET'){
  const variant=query.get('variant')||'original';if([...query.keys()].some(k=>k!=='variant')||!['original','preview'].includes(variant))throw new ApiError(400,'Choose a valid file view.');
  await requireLiveContext(ctx);const ticket=await rpc(ctx,'nam_project_resource_ticket',{rid,variant}) as Ticket,bytes=await downloaded(internal.service||clientProvider(true),ticket);
  await requireLiveContext(ctx);const current=await rpc(ctx,'nam_project_resource_ticket',{rid,variant}) as Ticket;if(current.path!==ticket.path||current.sha256!==ticket.sha256)throw new ApiError(409,'The file changed while it was loading. Reload the project.');
  const name=encodeURIComponent(ticket.file_name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':ticket.mime,'Content-Length':String(bytes.length),'Content-Disposition':variant==='preview'?'inline':"attachment; filename*=UTF-8''"+name,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
 }
 throw new ApiError(405,'Method not allowed.');
}
