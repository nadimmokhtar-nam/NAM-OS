import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireLiveContext} from './context';
import {MAX_RENDER_BYTES,prepareRender,renderHash} from './render-media';

const BUCKET='nam-render-versions',UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const COLUMNS='id,workspace_id,deliverable_id,number,file_name,mime,byte_size,expected_sha256,sha256,width,height,note,stage,status,storage_path,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,created_by,created_at,verified_at';
type Render=Record<string,unknown>&{id:string;workspace_id:string;deliverable_id:string;number:number|null;file_name:string;mime:string;byte_size:number;expected_sha256:string;sha256:string;storage_path:string;status:string;preview_size:number;preview_sha256:string;thumbnail_size:number;thumbnail_sha256:string};
type Attester=(ctx:APIContext,render:Render,version:number,evidence:Record<string,unknown>)=>Promise<unknown>;
type Dependencies={attest?:Attester;storageOrigin?:string};
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid image or render version.');return value;}
function version(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>2147483647)throw new ApiError(400,'A valid image version is required.');return Number(value);}
function failure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'Your account cannot perform this render action.','RENDER_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'This image or render version is not available.','RENDER_NOT_FOUND');
 if(['40001','23505'].includes(error.code||''))throw new ApiError(409,'The image changed or the upload is incomplete. Reload image details before retrying.','RENDER_CONFLICT');
 if(error.code==='54000')throw new ApiError(413,'Finish or discard pending uploads before adding another render. The reserved storage allowance may also have been reached.','RENDER_QUOTA');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the render name, file type, size and feedback.','RENDER_VALIDATION');
 throw new ApiError(503,'Private render storage is temporarily unavailable. Retry with the original file.','RENDER_UNAVAILABLE');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);if(error)failure(error);return data;}
async function metadata(ctx:APIContext,rid:string):Promise<Render>{
 const {data,error}=await ctx.supabase.from('nam_render_versions').select(COLUMNS).eq('workspace_id',ctx.workspaceId).eq('id',id(rid)).maybeSingle();
 if(error)failure(error);if(!data)throw new ApiError(404,'This render version is not available.','RENDER_NOT_FOUND');return data as Render;
}
function dto(row:Render){const {id,deliverable_id,number,file_name,mime,byte_size,width,height,note,stage,status,created_by,created_at,verified_at}=row;return {id,deliverable_id,number,file_name,mime,byte_size,width,height,note,stage,status,created_by,created_at,verified_at};}
function configuredAttester():Attester{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new ApiError(503,'Trusted render verification has not been configured.','CONFIGURATION_REQUIRED');
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 return async(ctx,render,expectedVersion,evidence)=>{const {data,error}=await service.rpc('nam_attest_render',{w:ctx.workspaceId,rid:render.id,expected_version:expectedVersion,verified_actor:ctx.user.id,verified_session:ctx.sessionId,verified_aal2:ctx.mfa.verified,verified_image:evidence});if(error)failure(error);return data;};
}
function retryKey(request:Request){const key=request.headers.get('Idempotency-Key');if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new ApiError(400,'A stable upload or feedback retry key is required.');return key;}
async function plan(ctx:APIContext,render:Render,origin:string){
 if(render.status==='ready')return {id:render.id,status:'ready',render:dto(render)};
 if(render.status!=='pending')throw new ApiError(409,'Discard the incomplete upload before starting another.','RENDER_CLEANUP_PENDING');
 if(await rpc(ctx,'nam_render_write',{w:ctx.workspaceId,did:render.deliverable_id})!==true)throw new ApiError(403,'Only the assigned image artist or Founder can upload a render.');
 const reserved={id:render.id,status:'pending',sha256:render.expected_sha256,size:Number(render.byte_size),mime:render.mime,fileName:render.file_name};
 // An immutable object can already exist after a lost response or version conflict.
 // Verify those bytes before asking Storage for another upload capability.
 try{await downloaded(ctx,render.storage_path,render.byte_size,render.expected_sha256);return {...reserved,uploaded:true};}
 catch(error){if(!(error instanceof ApiError)||error.code!=='RENDER_UPLOAD_INCOMPLETE')throw error;}
 const {data,error}=await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(render.storage_path,{upsert:false});
 if(error||!data?.signedUrl)throw new ApiError(503,'The private upload could not be opened. Keep your original file and retry.');
 const target=new URL(data.signedUrl);
 if(target.origin!==new URL(origin).origin||!(target.protocol==='https:'||(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname))))throw new ApiError(503,'The private upload destination is invalid.');
 return {...reserved,uploaded:false,uploadUrl:target.href};
}
async function downloaded(ctx:APIContext,path:string,size:number,digest:string){
 const {data,error}=await ctx.supabase.storage.from(BUCKET).download(path);
 if(error||!data)throw new ApiError(409,'The private upload is incomplete. Retry the original file.','RENDER_UPLOAD_INCOMPLETE');
 if(data.size!==Number(size)||data.size>MAX_RENDER_BYTES)throw new ApiError(409,'Stored file size differs from its reservation.','RENDER_INTEGRITY');
 const bytes=Buffer.from(await data.arrayBuffer());if(renderHash(bytes)!==digest)throw new ApiError(409,'Stored file bytes differ from the selected render. Discard this pending upload and select the original file again.','RENDER_INTEGRITY');return bytes;
}
async function derivative(ctx:APIContext,path:string,bytes:Buffer){
 const store=ctx.supabase.storage.from(BUCKET);await store.upload(path,Uint8Array.from(bytes),{contentType:'image/webp',upsert:false,cacheControl:'0'});
 await downloaded(ctx,path,bytes.length,renderHash(bytes));
}
/** Upload and content access use the user's JWT/RLS. A narrow service RPC
 * attests only server-decoded original bytes and verified preview derivatives. */
export async function dispatchRenders(ctx:APIContext,path:string[],request:Request,internal:Dependencies={}):Promise<Response|null>{
 const method=request.method;
 if(path.length===3&&path[0]==='deliverables'&&path[2]==='renders'){
  const did=id(path[1]);
  if(method==='GET'){
   const query=new URL(request.url).searchParams;if([...query.keys()].some(key=>key!=='before'))throw new ApiError(400,'Unsupported render filter.');
   const before=query.has('before')?version(Number(query.get('before'))):null;
   return json(await rpc(ctx,'nam_render_page',{w:ctx.workspaceId,did,before_number:before}));
  }
  if(method==='POST'){
   if(await rpc(ctx,'nam_render_write',{w:ctx.workspaceId,did})!==true)throw new ApiError(403,'Only the assigned image artist or Founder can upload a render.');
   const input=await readJSON(request);fields(input,['expectedVersion','file_name','mime','byte_size','sha256','note']);
   const expectedVersion=version(input.expectedVersion),file_name=inputText(input.file_name,'File name',{max:150}),note=inputText(input.note??'','Version note',{max:2000,required:false}),mime=String(input.mime);
   if(/[\x00-\x1f\x7f/\\]/.test(file_name)||file_name.startsWith('.')||file_name.includes('..')||!(mime==='image/png'?/\.png$/i:mime==='image/jpeg'?/\.jpe?g$/i:/$^/).test(file_name))throw new ApiError(400,'Choose a JPEG or PNG file with a matching name and file type.');
   if(!Number.isSafeInteger(input.byte_size)||Number(input.byte_size)<1||Number(input.byte_size)>MAX_RENDER_BYTES)throw new ApiError(413,'Choose a render of at most 50 MiB.');
   if(typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256))throw new ApiError(400,'The selected file fingerprint is missing.');
   const key=retryKey(request);if(!internal.attest)configuredAttester();await requireLiveContext(ctx);
   const rid=await rpc(ctx,'nam_reserve_render',{w:ctx.workspaceId,did,expected_version:expectedVersion,payload:{file_name,mime,byte_size:input.byte_size,sha256:input.sha256,note},retry_key:key});
   const render=await metadata(ctx,rid);return json(await plan(ctx,render,internal.storageOrigin||process.env.NEXT_PUBLIC_SUPABASE_URL||''),render.status==='ready'?200:201);
  }
 }
 if(path[0]!=='renders'||path.length!==3)return null;
 const rid=id(path[1]),action=path[2];
 if(action==='upload'&&method==='POST'){
  fields(await readJSON(request),[]);if(!internal.attest)configuredAttester();await requireLiveContext(ctx);return json(await plan(ctx,await metadata(ctx,rid),internal.storageOrigin||process.env.NEXT_PUBLIC_SUPABASE_URL||''));
 }
 if(action==='finish'&&method==='POST'){
  const input=await readJSON(request);fields(input,['expectedVersion']);const expectedVersion=version(input.expectedVersion),attest=internal.attest||configuredAttester(),render=await metadata(ctx,rid);
  if(render.status==='ready'){await requireLiveContext(ctx);return json(dto(render));}
  if(render.status!=='pending'||await rpc(ctx,'nam_render_write',{w:ctx.workspaceId,did:render.deliverable_id})!==true)throw new ApiError(403,'Current image upload access is required.');
  const bytes=await downloaded(ctx,render.storage_path,render.byte_size,render.expected_sha256),image=await prepareRender(bytes,render.mime);
  await requireLiveContext(ctx);
  await derivative(ctx,render.storage_path+'.preview.webp',image.preview);await derivative(ctx,render.storage_path+'.thumbnail.webp',image.thumbnail);
  await requireLiveContext(ctx);
  await attest(ctx,render,expectedVersion,{sha256:image.sha256,width:image.width,height:image.height,preview_size:image.preview.length,preview_sha256:renderHash(image.preview),thumbnail_size:image.thumbnail.length,thumbnail_sha256:renderHash(image.thumbnail)});
  return json(dto(await metadata(ctx,rid)));
 }
 if(action==='cancel'&&method==='POST'){
  fields(await readJSON(request),[]);await requireLiveContext(ctx);const render=await metadata(ctx,rid);
  await rpc(ctx,'nam_cancel_render',{w:ctx.workspaceId,rid,phase:'prepare'});
  const {error}=await ctx.supabase.storage.from(BUCKET).remove([render.storage_path,render.storage_path+'.preview.webp',render.storage_path+'.thumbnail.webp']);
  if(error){try{await rpc(ctx,'nam_cancel_render',{w:ctx.workspaceId,rid,phase:'failed'});}catch{/* Keep the quota reservation if access changed during cleanup. */}throw new ApiError(503,'Cleanup is pending. Retry discarding this upload; storage remains reserved.','RENDER_CLEANUP_PENDING');}
  await rpc(ctx,'nam_cancel_render',{w:ctx.workspaceId,rid,phase:'complete'});return json({cancelled:true});
 }
 if(action==='content'&&method==='GET'){
  const query=new URL(request.url).searchParams,variant=query.get('variant')||'preview';if([...query.keys()].some(key=>key!=='variant')||!['preview','thumbnail','original'].includes(variant))throw new ApiError(400,'Choose a valid render view.');
  const render=await metadata(ctx,rid);if(render.status!=='ready')throw new ApiError(409,'This render has not finished verification.');
  await requireLiveContext(ctx);const original=variant==='original',size=original?render.byte_size:variant==='preview'?render.preview_size:render.thumbnail_size,digest=original?render.sha256:variant==='preview'?render.preview_sha256:render.thumbnail_sha256;
  const bytes=await downloaded(ctx,render.storage_path+(original?'':'.'+variant+'.webp'),Number(size),digest);await requireLiveContext(ctx);if(await rpc(ctx,'nam_render_access',{w:ctx.workspaceId,rid})!==true)throw new ApiError(403,'Access to this render changed while it was loading.');
  const encoded=encodeURIComponent(render.file_name).replace(/[!'()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());
  return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':original?render.mime:'image/webp','Content-Length':String(bytes.length),'Content-Disposition':original?"attachment; filename*=UTF-8''"+encoded:'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
 }
 if(action==='comments'){
  const query=new URL(request.url).searchParams,page=method==='POST'?1:Number(query.get('page')||1);
  if([...query.keys()].some(key=>key!=='page')||!Number.isSafeInteger(page)||page<1||page>100000)throw new ApiError(400,'Choose a valid feedback page.');
  const render=await metadata(ctx,rid);if(render.status!=='ready')throw new ApiError(409,'Choose a verified render version.');
  if(method==='POST'){
   const input=await readJSON(request);fields(input,['body','point_x','point_y']);const body=inputText(input.body,'Feedback',{max:5000});
   const x=input.point_x??null,y=input.point_y??null;
   if((x===null)!==(y===null)||x!==null&&(typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1))throw new ApiError(400,'Choose a point within the render image.');
   await rpc(ctx,'nam_post_render_comment',{w:ctx.workspaceId,rid,message:body,x,y,retry_key:retryKey(request)});
  }else if(method!=='GET')throw new ApiError(405,'Method not allowed.');
  const {data,error,count}=await ctx.supabase.from('nam_render_comments').select('id,render_id,author_id,number,body,point_x,point_y,created_at',{count:'exact'}).eq('workspace_id',ctx.workspaceId).eq('render_id',rid).order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*100,page*100-1);if(error)failure(error);
  return json({items:(data||[]).map(comment=>({...comment,author_name:ctx.members.find(member=>member.id===comment.author_id)?.name||'Studio member'})),total:count||0,page,hasMore:page*100<(count||0)},method==='POST'?201:200);
 }
 return null;
}
