import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import type {APIContext} from './context';
import {ApiError,fields,inputText,readJSON} from './security-helpers';

const BUCKET='nam-task-attachments',MAX_FILE=2*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME:Record<string,string[]>={'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg'],'text/plain':['txt']};
const COLUMNS='id,workspace_id,task_id,name,mime,byte_size,sha256,storage_path,status,created_by,created_at,ready_at,deleted_at,cleanup_error,attested_at,attested_by';
type FileRow={id:string;workspace_id:string;task_id:string;name:string;mime:string;byte_size:number;sha256:string;storage_path:string;status:'pending'|'ready'|'deleting'|'deleted';created_by:string;created_at:string;cleanup_error?:boolean;attested_at?:string;attested_by?:string};
type AttachmentAttester=(context:APIContext,attachmentId:string)=>Promise<FileRow>;
function check(ok:unknown,message:string,status=400):asserts ok{if(!ok)throw new ApiError(status,message);}
function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
function id(value:string){check(UUID.test(value),'Invalid attachment or task identifier.');return value;}
function hash(bytes:Uint8Array){return createHash('sha256').update(bytes).digest('hex');}
function dto(row:FileRow){return {id:row.id,task_id:row.task_id,name:row.name,mime:row.mime,size:row.byte_size,sha256:row.sha256,status:row.status,created_by:row.created_by,created_at:row.created_at,cleanupPending:row.status!=='ready'||!!row.cleanup_error};}
function founder(ctx:APIContext){check(ctx.actor.role==='founder'&&(!ctx.mfa.required||ctx.mfa.verified),'Verified founder access is required.',403);}
function dbError(error:{code?:string;message?:string}|null){if(!error)return;
 const code=error.code||'';
 if(code==='42501')throw new ApiError(403,'You no longer have access to this action.');
 if(code==='P0002'||code==='PGRST116')throw new ApiError(404,'Attachment or task not found.');
 if(code==='40001'||code==='23505')throw new ApiError(409,'The file changed or its upload is incomplete. Retry the same upload or remove the pending file.');
 if(code==='54000')throw new ApiError(413,'Current storage safeguard reached: 100 files / 20 MiB per task or the workspace allowance. Finish or remove pending files before retrying.');
 if(code.startsWith('22')||['23514','23502','23503'].includes(code))throw new ApiError(400,'The attachment details are invalid. Check the file name, type and size.');
 throw new ApiError(503,'Private file storage is temporarily unavailable. Please retry.');
}
function fileRow(data:unknown,ctx:APIContext):FileRow{const row=Array.isArray(data)?(data.length===1?data[0]:null):data;if(!row||typeof row!=='object'||!('id'in row)||typeof row.id!=='string'||!UUID.test(row.id)||!('workspace_id'in row)||row.workspace_id!==ctx.workspaceId)throw new ApiError(503,'The file service returned an invalid response. Please retry.');return row as FileRow;}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);dbError(error);return ['nam_reserve_attachment','nam_remove_attachment'].includes(name)?fileRow(data,ctx):data;}
function configuredAttester():AttachmentAttester{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new ApiError(503,'Trusted file verification has not been configured. Uploads are unavailable.','CONFIGURATION_REQUIRED');
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 // Narrow service exception: this client attests validated bytes only. All
 // Storage operations and normal metadata queries retain the user's JWT/RLS.
 return async(ctx,attachmentId)=>{const {data,error}=await service.rpc('nam_attest_attachment',{w:ctx.workspaceId,attachment_id:attachmentId,verified_actor:ctx.user.id,verified_session:ctx.sessionId,verified_aal2:ctx.mfa.verified});dbError(error);return fileRow(data,ctx);};
}
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function validatePNG(bytes:Buffer){check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The PNG content does not match its type.');let offset=8,count=0,header=false,data=false,end=false;while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),finish=offset+12+length;check(finish<=bytes.length&&++count<=10000,'The PNG structure is invalid.');check(crc32(bytes.subarray(offset+4,offset+8+length))===bytes.readUInt32BE(offset+8+length),'The PNG checksum is invalid.');if(count===1){check(type==='IHDR'&&length===13,'The PNG header is invalid.');const width=bytes.readUInt32BE(offset+8),height=bytes.readUInt32BE(offset+12);check(width>0&&height>0&&width<=16384&&height<=16384&&width*height<=40000000,'The image dimensions are too large.');header=true;}if(type==='IDAT')data=true;if(type==='IEND'){check(length===0&&finish===bytes.length,'The PNG ending is invalid.');end=true;break;}offset=finish;}check(header&&data&&end,'The PNG is incomplete.');}
function validateJPEG(bytes:Buffer){check(bytes.length>=20&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217,'The JPEG content does not match its type.');let offset=2,dimensions=false,scan=false;while(offset+4<bytes.length){check(bytes[offset]===255,'The JPEG structure is invalid.');while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217)break;if(marker===218){scan=true;break;}check(offset+2<=bytes.length,'The JPEG is incomplete.');const length=bytes.readUInt16BE(offset);check(length>=2&&offset+length<=bytes.length,'The JPEG segment is invalid.');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){check(length>=8,'The JPEG frame is invalid.');const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);check(width>0&&height>0&&width<=16384&&height<=16384&&width*height<=40000000,'The image dimensions are too large.');dimensions=true;}offset+=length;}check(dimensions&&scan,'The JPEG is incomplete.');}
function validateBytes(bytes:Buffer,mime:string){check(bytes.length>0&&bytes.length<=MAX_FILE,'Attachments must be between 1 byte and 2 MiB.',413);if(mime==='image/png')validatePNG(bytes);else if(mime==='image/jpeg')validateJPEG(bytes);else if(mime==='application/pdf')check(/^%PDF-(?:1\.[0-7]|2\.0)/.test(bytes.subarray(0,12).toString('ascii'))&&bytes.subarray(-1024).toString('latin1').includes('%%EOF'),'The PDF content does not match its type.');else if(mime==='text/plain'){let value:string;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ApiError(400,'Text files must contain valid UTF-8.');}check(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),'Text files cannot contain binary control characters.');check(!/^\s*(?:<!doctype\s+html|<html|<svg|<script|#!)/i.test(value),'Upload plain text, not executable or active content.');}}
function uploadInput(input:Record<string,unknown>){fields(input,['name','mime','content_base64']);const name=inputText(input.name,'File name',{max:150}),mime=inputText(input.mime,'File type',{max:80});check(!/[\x00-\x1f\x7f/\\]/.test(name)&&!name.startsWith('.')&&!name.endsWith('.')&&!name.includes('..'),'Choose a simple file name without paths.');check(Object.hasOwn(MIME,mime),'Only PDF, PNG, JPEG and plain text files are supported.');check(MIME[mime].includes(name.split('.').at(-1)!.toLowerCase()),'The file extension must match its type.');check(typeof input.content_base64==='string','The attachment encoding is invalid.');check(input.content_base64.length<=Math.ceil(MAX_FILE/3)*4,'Attachments cannot exceed 2 MiB.',413);check(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content_base64),'The attachment encoding is invalid.');const bytes=Buffer.from(input.content_base64,'base64');check(bytes.toString('base64')===input.content_base64,'The attachment encoding is invalid.');validateBytes(bytes,mime);return {name,mime,bytes,sha256:hash(bytes)};}
async function metadata(ctx:APIContext,attachmentId:string){const {data,error}=await ctx.supabase.from('nam_task_attachments').select(COLUMNS).eq('workspace_id',ctx.workspaceId).eq('id',id(attachmentId)).maybeSingle();dbError(error);if(!data)throw new ApiError(404,'Attachment not found.');return data as FileRow;}

/** Cleanup never releases quota until Storage confirms absence. A failed
 * cleanup stays visible and bounded; a later identical request can resume it. */
async function removePrivateFile(ctx:APIContext,file:FileRow){
 await rpc(ctx,'nam_remove_attachment',{w:ctx.workspaceId,attachment_id:file.id,phase:'prepare'});
 const {error}=await ctx.supabase.storage.from(BUCKET).remove([file.storage_path]);
 if(error){try{await rpc(ctx,'nam_remove_attachment',{w:ctx.workspaceId,attachment_id:file.id,phase:'failed'});}catch{/* the reservation still holds quota after revocation */}throw new ApiError(503,'Private storage cleanup is pending. Retry removing the file; its storage allowance remains reserved.','ATTACHMENT_CLEANUP_PENDING');}
 await rpc(ctx,'nam_remove_attachment',{w:ctx.workspaceId,attachment_id:file.id,phase:'complete'});
}
async function upload(ctx:APIContext,taskId:string,input:Record<string,unknown>,attest:AttachmentAttester){
 const file=uploadInput(input),args={w:ctx.workspaceId,tid:id(taskId),file_name:file.name,file_mime:file.mime,file_size:file.bytes.length,content_sha256:file.sha256};
 let reservation=await rpc(ctx,'nam_reserve_attachment',args) as FileRow;
 if(reservation.status==='ready')return dto(reservation);
 if(reservation.status==='deleting'){await removePrivateFile(ctx,reservation);reservation=await rpc(ctx,'nam_reserve_attachment',args) as FileRow;}
 check(reservation.status==='pending'&&reservation.created_by===ctx.user.id,'Another member has an upload pending. Ask them to retry or remove it.',409);
 let validated=false;
 try{
  const storage=ctx.supabase.storage.from(BUCKET),result=await storage.upload(reservation.storage_path,Uint8Array.from(file.bytes),{contentType:file.mime,upsert:false,cacheControl:'0'});
  // Always download the actual private object after upload, including after a
  // lost success response or duplicate-object result. Submitted base64 and
  // Storage metadata alone are not sufficient evidence of stored file bytes.
  const existing=await storage.download(reservation.storage_path);
  if(existing.error||!existing.data)throw new ApiError(503,result.error?'The file could not be uploaded. Please retry the same file.':'The stored file could not be verified. Please retry.');
  const bytes=Buffer.from(await existing.data.arrayBuffer());check(bytes.length===file.bytes.length&&hash(bytes)===file.sha256,'The pending file failed integrity validation.',409);validateBytes(bytes,file.mime);
  validated=true;
  return dto(await attest(ctx,reservation.id));
 }catch(error){
  // A concurrent retry may already have committed this same file. Never let a
  // failed retry delete a ready attachment created by the successful request.
  let current:FileRow|null=null;try{current=await metadata(ctx,reservation.id);}catch{/* access can be revoked while bytes are in flight */}
  if(current?.status==='ready'){if(validated)return dto(current);throw error;}
  try{await removePrivateFile(ctx,reservation);}catch{throw new ApiError(503,'The upload could not finish and private cleanup is pending. Retry the same upload or ask the founder to remove it.','ATTACHMENT_CLEANUP_PENDING');}
  throw error;
 }
}

/** Trusted byte attestation closes direct-user finalize bypass. File checks
 * remain format validation, not malware scanning. The optional attester is an
 * internal test seam; HTTP inputs never select it or supply a verified actor. */
export async function dispatchOperations(ctx:APIContext,path:string[],request:Request,internalAttester?:AttachmentAttester):Promise<Response|null>{
 const [area,recordId,action]=path,method=request.method;
 if(area==='tasks'&&path.length===3&&action==='attachments'){
  const taskId=id(recordId);
  if(method==='GET'){
   const {data:task,error:taskError}=await ctx.supabase.from('nam_tasks').select('id').eq('workspace_id',ctx.workspaceId).eq('id',taskId).is('deleted_at',null).maybeSingle();dbError(taskError);if(!task)throw new ApiError(404,'Task not found.');
   const {data,error}=await ctx.supabase.from('nam_task_attachments').select(COLUMNS).eq('workspace_id',ctx.workspaceId).eq('task_id',taskId).neq('status','deleted').order('created_at').limit(100);dbError(error);return json((data||[]).map(row=>dto(row as FileRow)));
  }
  if(method==='POST'){const attest=internalAttester||configuredAttester();return json(await upload(ctx,taskId,await readJSON(request,2820000),attest),201);}
  throw new ApiError(405,'Method not allowed.');
 }
 if(area==='attachments'&&path.length===2){
  const file=await metadata(ctx,recordId);
  if(method==='GET'){
   check(file.status==='ready','This attachment is pending upload or cleanup. Retry the operation before downloading.',409);
   const {data,error}=await ctx.supabase.storage.from(BUCKET).download(file.storage_path);if(error||!data)throw new ApiError(503,'The private file could not be downloaded. Please retry.');
   const bytes=Buffer.from(await data.arrayBuffer());check(bytes.length===file.byte_size&&hash(bytes)===file.sha256,'The file failed integrity validation. Ask the founder to review it.',503);validateBytes(bytes,file.mime);
   return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':file.mime,'Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="nam-attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  }
  if(method==='DELETE'){fields(await readJSON(request),[]);await removePrivateFile(ctx,file);return json({ok:true});}
  throw new ApiError(405,'Method not allowed.');
 }
 if(area==='operations'&&recordId==='reminders'&&action==='run'&&path.length===3){check(method==='POST','Method not allowed.',405);founder(ctx);fields(await readJSON(request),[]);const created=await rpc(ctx,'nam_process_reminders',{w:ctx.workspaceId});return json({created,delivery:'in_app',scope:'workspace',scheduled:false});}
 if(area==='export'&&path.length===1){check(method==='GET','Method not allowed.',405);founder(ctx);check(new URL(request.url).searchParams.get('attachments')!=='1','Business export contains attachment metadata. Download private files separately; this JSON is not a complete Storage backup.');const result=await rpc(ctx,'nam_export_business',{w:ctx.workspaceId});return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="NAM_OS_export.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 return null;
}
