import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder,requireLiveContext} from './context';
import {MAX_VIDEO_BYTES,validateVideo,videoStreamRange,VideoValidationError} from './video-media';

const BUCKET='nam-academy-videos';
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const COLUMNS='id,workspace_id,course_id,source_lesson_id,title,file_name,mime,byte_size,caption_vtt,storage_path,status,expected_sha256,sha256,created_by';
type Video={id:string;workspace_id:string;course_id:string;source_lesson_id:string;title:string;file_name:string;mime:string;byte_size:number;caption_vtt:string;storage_path:string;status:string;expected_sha256:string;sha256:string;created_by:string;course_revision?:number};
type Attester=(ctx:APIContext,video:Video,revision:number,digest:string)=>Promise<unknown>;
type Dependencies={attest?:Attester;storageOrigin?:string;fetchStorage?:(ctx:APIContext,video:Video,range:string|null,signal:AbortSignal)=>Promise<Response>};
function id(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid course, lesson or video.');return value;}
function revision(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>2147483647)throw new ApiError(400,'A valid course revision is required.');return Number(value);}
function failure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'Your current account cannot perform this video action.','VIDEO_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'This private video or working lesson is not available.','VIDEO_NOT_FOUND');
 if(['40001','23505'].includes(error.code||''))throw new ApiError(409,'The course changed or the upload is incomplete. Review the latest draft, then retry verification.','VIDEO_CONFLICT');
 if(error.code==='54000')throw new ApiError(413,'The private video storage safeguard was reached (50 MiB per file, 512 MiB reserved per workspace, at most 3 pending uploads per course).','VIDEO_QUOTA');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the video type, size, caption file and working lesson.','VIDEO_VALIDATION');
 throw new ApiError(503,'Private video storage could not complete this request. Please retry.','VIDEO_UNAVAILABLE');
}
function row(value:unknown,ctx:APIContext):Video{
 const result=Array.isArray(value)&&value.length===1?value[0]:value;
 if(!result||typeof result!=='object'||!('id'in result)||typeof result.id!=='string'||!UUID.test(result.id)||!('workspace_id'in result)||result.workspace_id!==ctx.workspaceId)throw new ApiError(503,'The video service returned an invalid response.');
 return result as Video;
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);if(error)failure(error);return data;}
async function metadata(ctx:APIContext,vid:string){const {data,error}=await ctx.supabase.from('nam_academy_videos').select(COLUMNS).eq('workspace_id',ctx.workspaceId).eq('id',id(vid)).maybeSingle();if(error)failure(error);if(!data)throw new ApiError(404,'This video is not available in your assigned course publication.','VIDEO_NOT_FOUND');return row(data,ctx);}
function configuredAttester():Attester{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new ApiError(503,'Trusted private video verification has not been configured.','CONFIGURATION_REQUIRED');
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 return async(ctx,video,expectedRevision,digest)=>{
  const {data,error}=await service.rpc('nam_attest_academy_video',{w:ctx.workspaceId,vid:video.id,expected_revision:expectedRevision,verified_actor:ctx.user.id,verified_session:ctx.sessionId,verified_aal2:ctx.mfa.verified,content_sha256:digest});
  if(error)failure(error);return data;
 };
}
function uploadFields(input:Record<string,unknown>){
 fields(input,['course_id','lesson_id','expectedRevision','title','file_name','mime','byte_size','caption_vtt','sha256']);
 id(input.course_id);id(input.lesson_id);revision(input.expectedRevision);
 const title=inputText(input.title,'Video title',{max:200}),name=inputText(input.file_name,'Video file name',{max:150});
 if(/[\x00-\x1f\x7f/\\]/.test(name)||name.startsWith('.')||name.includes('..'))throw new ApiError(400,'Choose a simple video file name without paths.');
 const mime=input.mime;if(!['video/mp4','video/webm'].includes(String(mime))||!(mime==='video/mp4'?/\.mp4$/i:/\.webm$/i).test(name))throw new ApiError(400,'Choose an MP4 or WebM file whose extension matches its type.');
 if(!Number.isSafeInteger(input.byte_size)||Number(input.byte_size)<1||Number(input.byte_size)>MAX_VIDEO_BYTES)throw new ApiError(413,'Choose a video of at most 50 MiB.');
 const captions=typeof input.caption_vtt==='string'?input.caption_vtt.replace(/^\uFEFF/,''):input.caption_vtt===undefined?'':null;
 if(captions===null||captions.length>100000)throw new ApiError(400,'WebVTT captions must contain at most 100,000 characters.');
 if(captions&&!/^WEBVTT(?:\r?\n|\s)/.test(captions))throw new ApiError(400,'Caption text must be a WebVTT file beginning with WEBVTT.');
 if(typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256))throw new ApiError(400,'The selected video fingerprint is missing. Select the file again.');
 return {title,file_name:name,mime,byte_size:input.byte_size,caption_vtt:captions,sha256:input.sha256};
}
async function uploadPlan(ctx:APIContext,video:Video,origin:string,courseRevision:number){
 if(video.status==='ready')return {id:video.id,status:'ready',courseRevision};
 const {data,error}=await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(video.storage_path,{upsert:false});
 if(error||!data?.signedUrl)throw new ApiError(503,'An upload could not be opened. Keep this form and retry.','VIDEO_UPLOAD_UNAVAILABLE');
 const target=new URL(data.signedUrl);
 if(target.origin!==new URL(origin).origin||!(target.protocol==='https:'||(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname))))throw new ApiError(503,'The private upload destination is invalid.');
 return {id:video.id,status:'pending',uploadUrl:target.href,courseRevision,maxBytes:MAX_VIDEO_BYTES,fileName:video.file_name,mime:video.mime,size:Number(video.byte_size),sha256:video.expected_sha256};
}
async function fetchStorage(ctx:APIContext,video:Video,range:string|null,signal:AbortSignal){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new ApiError(503,'Private video playback has not been configured.','CONFIGURATION_REQUIRED');
 const {data,error}=await ctx.supabase.auth.getSession(),session=data.session;
 if(error||!session?.access_token||session.user.id!==ctx.user.id)throw new ApiError(401,'Sign in again to play this private video.','SIGN_IN_REQUIRED');
 const path=video.storage_path.split('/').map(encodeURIComponent).join('/');
 return fetch(new URL('/storage/v1/object/authenticated/'+BUCKET+'/'+path,url),{headers:{apikey:key,Authorization:'Bearer '+session.access_token,...(range?{Range:range}:{})},signal,redirect:'error',cache:'no-store'});
}

/** The main router owns verified context plus Origin/CSRF mutation checks.
 * Dependencies are only injectable by isolated server tests, never HTTP input. */
export async function dispatchAcademyVideo(ctx:APIContext,path:string[],request:Request,internal:Dependencies={}):Promise<Response|null>{
 if(path[0]!=='academy'||path[1]!=='videos')return null;
 try{
  if(path.length===2&&request.method==='POST'){
   requireFounder(ctx);const input=await readJSON(request,140000),payload=uploadFields(input),key=request.headers.get('Idempotency-Key');
   if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new ApiError(400,'A stable upload retry key is required.');
   // Fail before reserving storage when trusted verification is unavailable.
   if(!internal.attest)configuredAttester();
   await requireLiveContext(ctx,{founder:true});
   const video=row(await rpc(ctx,'nam_reserve_academy_video',{w:ctx.workspaceId,c_id:input.course_id,l_id:input.lesson_id,expected_revision:input.expectedRevision,payload,retry_key:key}),ctx);
   return json(await uploadPlan(ctx,video,internal.storageOrigin||process.env.NEXT_PUBLIC_SUPABASE_URL||'',Number(video.course_revision)),video.status==='ready'?200:201);
  }
  if(path.length!==4)return null;
  const vid=id(path[2]),action=path[3];
  if(action==='upload'&&request.method==='POST'){
   requireFounder(ctx);fields(await readJSON(request),[]);if(!internal.attest)configuredAttester();await requireLiveContext(ctx,{founder:true});
   const video=await metadata(ctx,vid);if(!video.source_lesson_id)throw new ApiError(409,'This video is no longer linked to a working lesson.');
   const course=await rpc(ctx,'nam_academy_admin_course',{w:ctx.workspaceId,c_id:video.course_id});
   return json(await uploadPlan(ctx,video,internal.storageOrigin||process.env.NEXT_PUBLIC_SUPABASE_URL||'',course.revision));
  }
  if(action==='finish'&&request.method==='POST'){
   requireFounder(ctx);const input=await readJSON(request);fields(input,['expectedRevision']);const expected=revision(input.expectedRevision),attest=internal.attest||configuredAttester();
   const video=await metadata(ctx,vid);
   const {data,error}=await ctx.supabase.storage.from(BUCKET).download(video.storage_path);
   if(error||!data)throw new ApiError(409,'The private upload is incomplete. Retry the same upload before verification.','VIDEO_UPLOAD_INCOMPLETE');
   if(data.size!==Number(video.byte_size)||data.size>MAX_VIDEO_BYTES)throw new ApiError(409,'The stored video size does not match its reservation.','VIDEO_INTEGRITY');
   const digest=validateVideo(Buffer.from(await data.arrayBuffer()),video.mime);
   if(digest!==video.expected_sha256)throw new ApiError(409,'The stored bytes do not match the video you selected. Retry the original file.','VIDEO_INTEGRITY');
   await requireLiveContext(ctx,{founder:true});
   const result=row(await attest(ctx,video,expected,digest),ctx);
   return json({id:result.id,status:result.status,courseRevision:result.course_revision});
  }
  if(action==='unlink'&&request.method==='POST'){
   requireFounder(ctx);const input=await readJSON(request);fields(input,['expectedRevision']);await requireLiveContext(ctx,{founder:true});
   await rpc(ctx,'nam_unlink_academy_video',{w:ctx.workspaceId,vid,expected_revision:revision(input.expectedRevision)});return json({ok:true,publishedHistoryRetained:true});
  }
  if(['content','captions'].includes(action)&&request.method==='GET'){
   const video=await metadata(ctx,vid);if(video.status!=='ready')throw new ApiError(409,'This video has not finished private verification.');
   await requireLiveContext(ctx);
   if(action==='captions'){
    if(!video.caption_vtt)throw new ApiError(404,'No captions were uploaded for this video.');
    return new Response(video.caption_vtt,{headers:{'Content-Type':'text/vtt; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
   }
   const size=Number(video.byte_size);let range;
   try{range=videoStreamRange(request.headers.get('range'),size);}catch(error){if(error instanceof VideoValidationError&&error.status===416)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Cache-Control':'private, no-store'}});throw error;}
   const upstream=await (internal.fetchStorage||fetchStorage)(ctx,video,range.partial?`bytes=${range.start}-${range.end}`:null,request.signal);
   const expectedStatus=range.partial?206:200;
   if(upstream.status!==expectedStatus||Number(upstream.headers.get('content-length'))!==range.length||(range.partial&&upstream.headers.get('content-range')!==`bytes ${range.start}-${range.end}/${size}`)){
    await upstream.body?.cancel();throw new ApiError(503,'The private video stream could not be verified. Please retry.','VIDEO_STREAM_UNAVAILABLE');
   }
   return new Response(upstream.body,{status:expectedStatus,headers:{'Content-Type':video.mime,'Content-Length':String(range.length),'Accept-Ranges':'bytes',...(range.partial?{'Content-Range':`bytes ${range.start}-${range.end}/${size}`}:{ }),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
  }
  throw new ApiError(405,'Method not allowed.');
 }catch(error){if(error instanceof VideoValidationError)throw new ApiError(error.status,error.message,'VIDEO_VALIDATION');throw error;}
}
