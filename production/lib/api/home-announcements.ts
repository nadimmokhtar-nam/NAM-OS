import 'server-only';
import {type APIContext,ApiError,fields,json,readJSON,requireFounder,requireLiveContext} from './context';

const ROLES=['founder','sales_manager','sales','production_manager','artist','freelancer'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function identifier(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'Choose a valid announcement.','HOME_INVALID');return value;}
function revision(value:unknown,create=false){if(!Number.isSafeInteger(value)||Number(value)<(create?0:1)||Number(value)>2147483646)throw new ApiError(400,'Reload the announcement before saving.','HOME_INVALID');return Number(value);}
function date(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2200-12-31')throw new ApiError(400,'Choose a valid announcement date.','HOME_INVALID');const parsed=new Date(value+'T12:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new ApiError(400,'Choose a valid announcement date.','HOME_INVALID');return value;}
function changes(input:unknown,create=false){if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'Announcement fields are required.','HOME_INVALID');const value=input as Record<string,unknown>;fields(value,['title','body','audience_roles','starts_on','ends_on','archived']);if(!Object.keys(value).length)throw new ApiError(400,'Choose an announcement change.','HOME_INVALID');const result:Record<string,unknown>={};
 for(const [key,max] of [['title',200],['body',8000]] as const)if(create||key in value){if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>max||(key==='title'&&/[\u0000-\u001f\u007f]/.test(value[key])))throw new ApiError(400,`${key==='title'?'Title':'Message'} is required and must be at most ${max} characters.`,'HOME_INVALID');result[key]=value[key].trim();}
 if(create||'audience_roles' in value){const roles=value.audience_roles;if(!Array.isArray(roles)||roles.length>6||new Set(roles).size!==roles.length||roles.some(role=>typeof role!=='string'||!ROLES.includes(role)))throw new ApiError(400,'Choose distinct NAM role audiences.','HOME_INVALID');result.audience_roles=[...roles].sort();}
 if(create||'starts_on' in value)result.starts_on=date(value.starts_on);
 if(create||'ends_on' in value)result.ends_on=value.ends_on===null?null:date(value.ends_on);
 if(result.starts_on&&result.ends_on&&String(result.ends_on)<String(result.starts_on))throw new ApiError(400,'The end date must follow the start date.','HOME_INVALID');
 if('archived' in value){if(typeof value.archived!=='boolean')throw new ApiError(400,'Choose a valid archive state.','HOME_INVALID');result.archived=value.archived;}
 return result;
}
function query(url:URL,history:true):{offset:number};
function query(url:URL,history?:false):{mode:string;state:string;q:string;limit:number;offset:number;scope:string};
function query(url:URL,history=false){const values:Record<string,string>={};for(const [key,value] of url.searchParams){if(Object.hasOwn(values,key)||!(history?['offset']:['mode','state','q','limit','offset','scope']).includes(key))throw new ApiError(400,'Unsupported Home filter.','HOME_INVALID');values[key]=value;}
 const integer=(key:string,fallback:number,min:number,max:number)=>{if(values[key]===undefined)return fallback;const raw=values[key];if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw new ApiError(400,'Choose a valid announcement page.','HOME_INVALID');return Number(raw);};
 if(history)return {offset:integer('offset',0,0,100000)};
 const mode=values.mode||'active',state=values.state||'all',q=values.q||'',scope=values.scope||'';if(!['active','manage'].includes(mode)||!['all','current','scheduled','expired','archived'].includes(state)||q.length>200||scope&&!['mine','studio'].includes(scope))throw new ApiError(400,'Choose a valid Home view.','HOME_INVALID');return {mode,state,q,limit:integer('limit',20,1,50),offset:integer('offset',0,0,100000),scope};
}
function failure(error:{code?:string}|null):never{if(error?.code==='42501')throw new ApiError(403,'Current NAM access is required for this Home action.','HOME_FORBIDDEN');if(error?.code==='P0002')throw new ApiError(404,'The announcement is unavailable.','HOME_NOT_FOUND');if(error?.code==='40001')throw new ApiError(409,'This announcement changed or its retry key belongs to another change. Reload the saved record.','HOME_CONFLICT');if(error?.code?.startsWith('22')||error?.code?.startsWith('23'))throw new ApiError(400,'Check the announcement title, message, audience and dates.','HOME_INVALID');throw new ApiError(503,'Home announcements could not be loaded or saved. Retry the original change to check its result.','HOME_UNAVAILABLE');}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,{w:ctx.workspaceId,...args});if(error)failure(error);return data;}
async function liveRead(ctx:APIContext){await requireLiveContext(ctx,{founder:ctx.actor.role==='founder'});const role=await rpc(ctx,'nam_role',{});if(role!==ctx.actor.role)throw new ApiError(403,'Workspace access changed while Home was loading. Reload the workspace.','HOME_FORBIDDEN');}

/** The shared route continues to own session/origin/CSRF checks. Every RPC
 * independently checks current assured membership and tenant visibility. */
export async function dispatchHomeAnnouncements(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path[0]!=='home'||path[1]!=='announcements')return null;if(!ROLES.includes(ctx.actor.role))throw new ApiError(403,'NAM membership is required.','HOME_FORBIDDEN');const method=request.method;
 if(path.length===2&&method==='GET'){
  const input=query(new URL(request.url));if(input.mode==='manage')requireFounder(ctx);const scope=input.scope||(ctx.actor.role==='founder'?'studio':'mine');if(scope==='studio'&&ctx.actor.role!=='founder')throw new ApiError(403,'Founder access is required for the studio view.','HOME_FORBIDDEN');
  const {scope:_,...filters}=input;const [page,focus]=await Promise.all([rpc(ctx,'nam_home_announcements_page',{filters}),input.mode==='manage'?Promise.resolve(null):rpc(ctx,'nam_home_work_context',{scope})]);await liveRead(ctx);return json({...page,focus});
 }
 if(path.length===4&&path[3]==='history'&&method==='GET'){
  requireFounder(ctx);const input=query(new URL(request.url),true),history=await rpc(ctx,'nam_home_announcement_history',{aid:identifier(path[2]),page_offset:input.offset});await liveRead(ctx);return json(history);
 }
 if((path.length===2&&method==='POST')||(path.length===3&&method==='PATCH')){
  requireFounder(ctx);if(new URL(request.url).search)throw new ApiError(400,'Unsupported announcement filter.','HOME_INVALID');const creating=path.length===2,input=await readJSON(request);fields(input,['expectedVersion','changes']);const expected=revision(input.expectedVersion,creating);if(creating&&expected!==0)throw new ApiError(400,'New announcements start at revision zero.','HOME_INVALID');const payload=changes(input.changes,creating),aid=creating?null:identifier(path[2]);
  const retry=request.headers.get('Idempotency-Key');if(!retry||!/^[A-Za-z0-9_-]{8,128}$/.test(retry))throw new ApiError(400,'A stable announcement retry key is required.','HOME_INVALID');await requireLiveContext(ctx,{founder:true});return json(await rpc(ctx,'nam_save_home_announcement',{aid,expected_version:expected,changes:payload,retry_key:retry}),creating?201:200);
 }
 throw new ApiError(405,'This Home action is not supported.','HOME_METHOD');
}
