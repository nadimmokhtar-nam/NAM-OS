import {randomUUID} from 'node:crypto';
import {asUser} from '../database.mjs';
import {serial} from './runtime.mjs';
import {videoRange} from '../../lib/api/video-media.ts';

// Byte storage is isolated in memory. Every read/insert uses actual storage
// object RLS. This models the HTTP/object boundary, not a hosted Storage pass.
export function privateStorage(db,origin='http://127.0.0.1:3111'){
 const objects=new Map(),uploads=new Map();
 const execute=(user,run)=>serial(db,()=>asUser(db,user,run,{aal:'aal1'}));
 async function put(user,path,bytes,mime){
  if(objects.has(path))throw Object.assign(new Error('An immutable object already exists'),{code:'23505',status:409});
  await execute(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('nam-academy-videos',$1,$2,$3)",[path,user,JSON.stringify({size:bytes.length,mimetype:mime})]));
  objects.set(path,{bytes:Buffer.from(bytes),mime});
 }
 function storage(user){return {from(bucket){if(bucket!=='nam-academy-videos')throw Error('Unknown private test bucket');return {
  async createSignedUploadUrl(path){const result=await execute(user,()=>db.query("select nam_video_storage_access($1,'insert') as permitted",[path]));if(!result.rows[0].permitted)return {data:null,error:{code:'42501'}};const token=randomUUID();uploads.set(token,{user,path,expires:Date.now()+7200000});return {data:{signedUrl:origin+'/_fixture/upload/'+token},error:null};},
  async download(path){try{const result=await execute(user,()=>db.query("select name from storage.objects where bucket_id='nam-academy-videos' and name=$1",[path]));const object=result.rows.length?objects.get(path):null;return object?{data:new Blob([object.bytes],{type:object.mime}),error:null}:{data:null,error:{code:'42501'}};}catch(error){return {data:null,error};}},
 };}};}
 async function stream(ctx,video,rangeValue){const result=await storage(ctx.user.id).from('nam-academy-videos').download(video.storage_path);if(result.error)return new Response(null,{status:403});const bytes=Buffer.from(await result.data.arrayBuffer()),range=videoRange(rangeValue,bytes.length);return new Response(Uint8Array.from(bytes.subarray(range.start,range.end+1)),{status:range.partial?206:200,headers:{'Content-Type':video.mime,'Content-Length':String(range.length),...(range.partial?{'Content-Range':`bytes ${range.start}-${range.end}/${bytes.length}`}:{})}});}
 async function acceptUpload(token,bytes,mime){const reservation=uploads.get(token);if(!reservation||reservation.expires<Date.now())throw Object.assign(new Error('Invalid fixture upload'),{status:403});await put(reservation.user,reservation.path,bytes,mime);}
 return {storage,put,stream,acceptUpload,objects,origin};
}
