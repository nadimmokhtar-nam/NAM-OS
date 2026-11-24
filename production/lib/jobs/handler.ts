import 'server-only';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';

type RPCResult={data:unknown;error:{code?:string;message?:string}|null};
export type JobClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<RPCResult>};
export type JobDependencies={
 env:Record<string,string|undefined>;
 createClient:(url:string,key:string,options:{auth:{persistSession:false;autoRefreshToken:false;detectSessionInUrl:false}})=>JobClient;
 runIntegrations:(context:{supabase:JobClient;workspaceId:string})=>Promise<unknown>;
 now?:()=>Date;
};
class JobError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES=['attio','lemlist','justcall'] as const;
function reply(body:unknown,status=200,extra:Record<string,string>={}){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...extra}});}
function authorized(request:Request,secret:string){const supplied=request.headers.get('authorization')||'';if(supplied.length>2048)return false;const actual=createHash('sha256').update(supplied).digest(),expected=createHash('sha256').update(`Bearer ${secret}`).digest();return timingSafeEqual(actual,expected);}
function serviceKey(key:string|undefined){
 if(!key||key.length<32)return false;
 if(/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key))return true;
 // Detect accidental use of a publishable/anon JWT before sending any work.
 // Signature validity is independently checked by the Supabase API gateway.
 try{const parts=key.split('.');return parts.length===3&&!!parts[2]&&JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).role==='service_role';}catch{return false;}
}
function projectURL(value:string|undefined){try{const url=new URL(value||'');const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(local&&url.protocol==='http:')))throw new Error();return url.origin;}catch{throw new JobError(503,'The scheduled job database connection is not configured.');}}
async function noPayload(request:Request){
 if(new URL(request.url).searchParams.size)throw new JobError(400,'This job uses its fixed server workspace and accepts no query parameters.');
 if(request.method!=='POST'||!request.body)return;
 const reader=request.body.getReader();let length=0,raw='';for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>1024){await reader.cancel();throw new JobError(413,'This job does not accept a request payload.');}raw+=new TextDecoder().decode(next.value);}
 if(raw.trim()&&!/^\{\s*\}$/.test(raw.trim()))throw new JobError(400,'This job uses server configuration and accepts no request fields.');
}
function outcomes(value:unknown){
 const input=Array.isArray(value)?value:[];
 return SOURCES.map(source=>{const item=input.find(i=>i&&typeof i==='object'&&(i as Record<string,unknown>).source===source) as Record<string,unknown>|undefined;const status=typeof item?.status==='string'&&['connected','not_connected','retry_later','error'].includes(item.status)?item.status:'error';return {source,status,...(typeof item?.records==='number'&&Number.isSafeInteger(item.records)&&item.records>=0?{records:item.records}:{}),...(status==='error'?{error:'The source sync failed. Check its connection status.'}:{})};});
}

export function createJobsHandler(dependencies:JobDependencies){return async(request:Request):Promise<Response>=>{
 if(!['GET','POST'].includes(request.method))return reply({error:'Method not allowed.'},405,{Allow:'GET, POST'});
 const {env}=dependencies;
 try{
  const secret=env.NAM_CRON_SECRET;if(!secret||secret.length<32||secret.length>512||/\s/.test(secret))throw new JobError(503,'Scheduled jobs have not been configured.');
  if(!authorized(request,secret))throw new JobError(401,'This scheduled request is not authorized.');
  await noPayload(request);
  const workspaceId=env.NAM_INTEGRATIONS_WORKSPACE_ID;if(!workspaceId||!UUID.test(workspaceId))throw new JobError(503,'The scheduled job workspace has not been configured.');
  const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;if(!serviceKey(key))throw new JobError(503,'A server-only database secret is required for scheduled work.');
  const url=projectURL(env.NEXT_PUBLIC_SUPABASE_URL),started=(dependencies.now||(()=>new Date()))().toISOString(),invocationId=randomUUID();
  const supabase=dependencies.createClient(url,key!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let reminders:{status:string;created?:number;error?:string};
  try{const result=await supabase.rpc('nam_process_reminders',{w:workspaceId});if(result.error||typeof result.data!=='number'||!Number.isSafeInteger(result.data)||result.data<0)throw new Error();reminders={status:'completed',created:result.data};}catch{reminders={status:'error',error:'Task reminders could not be processed.'};}
  let integrations:ReturnType<typeof outcomes>;
  try{integrations=outcomes(await dependencies.runIntegrations({supabase,workspaceId}));}catch{integrations=outcomes(null);}
  const failed=reminders.status==='error'||integrations.some(result=>result.status==='error');
  return reply({ok:!failed,trigger:'authenticated_request',invocation_id:invocationId,workspace_id:workspaceId,started_at:started,finished_at:(dependencies.now||(()=>new Date()))().toISOString(),reminders,integrations,schedule:'Configured separately by the deployment operator.'},failed?502:200);
 }catch(error){return error instanceof JobError?reply({error:error.message},error.status):reply({error:'The scheduled request could not be processed.'},503);}
 };}
