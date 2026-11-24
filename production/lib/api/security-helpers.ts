import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export class ApiError extends Error {
  status:number;code:string;
  constructor(status:number,message:string,code='REQUEST_FAILED'){super(message);this.name='ApiError';this.status=status;this.code=code;}
}
export function constantEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function requireSecret(value:string|undefined){if(!value||value.length<32)throw new ApiError(503,'Request protection has not been configured.','CONFIGURATION_REQUIRED');return value;}
export function issueCsrf(userId:string,workspaceId:string,secret:string,now=Date.now(),ttlSeconds=43200){
  requireSecret(secret);if(!Number.isInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>43200)throw new ApiError(500,'Invalid token expiry.');const body=['1',userId,workspaceId,String(Math.floor(now/1000)+ttlSeconds),randomBytes(24).toString('hex')].join('.');
  return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
export function validCsrf(token:string|undefined,userId:string,workspaceId:string,secret:string,now=Date.now()){
  requireSecret(secret);if(!token||token.length>512)return false;const parts=token.split('.');if(parts.length!==6||parts[0]!=='1'||parts[1]!==userId||parts[2]!==workspaceId||!/^\d+$/.test(parts[3])||!/^[a-f0-9]{48}$/.test(parts[4]))return false;
  const expiry=Number(parts[3]),seconds=Math.floor(now/1000);if(expiry<=seconds||expiry>seconds+43200)return false;const expected=createHmac('sha256',secret).update(parts.slice(0,5).join('.')).digest('base64url');return constantEqual(parts[5],expected);
}
export function cookieValue(header:string|null,name:string){const value=(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`));if(!value)return undefined;try{return decodeURIComponent(value.slice(name.length+1));}catch{return undefined;}}
export function safeNext(value:string|null|undefined,fallback='/workspace'){if(!value||!value.startsWith('/'))return fallback;let decoded:string;try{decoded=decodeURIComponent(value);}catch{return fallback;}if([value,decoded].some(v=>v.startsWith('//')||v.includes('\\')||/[\u0000-\u001f\u007f]/.test(v)))return fallback;return value;}
export function expectedOrigin(configured:string|undefined,requestURL:string){
  const fallback=new URL(requestURL);if(!configured&&!['localhost','127.0.0.1','[::1]'].includes(fallback.hostname))throw new ApiError(503,'The application origin is not configured.','CONFIGURATION_REQUIRED');
  let origin:URL;try{origin=new URL(configured||fallback.origin);}catch{throw new ApiError(503,'The application origin is invalid.','CONFIGURATION_REQUIRED');}
  if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw new ApiError(503,'The application origin is invalid.','CONFIGURATION_REQUIRED');return origin.origin;
}
export async function readJSON(request:Request,maxBytes=40000):Promise<Record<string,unknown>>{
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new ApiError(415,'Use a JSON request.');
  const length=request.headers.get('content-length');if(length&&Number(length)>maxBytes)throw new ApiError(413,'The request is too large.');
  const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let total=0;
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new ApiError(413,'The request is too large.');}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{throw new ApiError(400,'Enter a valid JSON object.');}
}
export function fields(input:Record<string,unknown>,allowed:string[]){if(Object.keys(input).some(key=>!allowed.includes(key)))throw new ApiError(400,'An unsupported field was supplied.');}
export function inputText(value:unknown,name:string,{max=5000,required=true}:{max?:number;required?:boolean}={}){if(typeof value!=='string')throw new ApiError(400,`${name} must be text.`);const text=value.trim();if((required&&!text)||text.length>max)throw new ApiError(400,`${name} is invalid.`);return text;}
