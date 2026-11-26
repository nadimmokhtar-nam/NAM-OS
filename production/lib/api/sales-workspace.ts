import 'server-only';
import {ApiError,json,readJSON,fields,requireFounder,type APIContext} from './context';
import {salesAccess,databaseFailure,integrationStatus,integrationFingerprints} from '../integrations/service';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS=['contacts','leads','companies','opportunities','pipeline','followups','campaigns','outreach','calls','performance','revenue'];
const KINDS:Record<string,string[]>={attio:['lead','company','deal'],lemlist:['campaign','campaign_report','outreach'],justcall:['call']};
function text(value:unknown,name:string,max:number,required=true){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,`${name} is required and must be at most ${max} characters.`);return value.trim();}
function identifier(value:unknown,name:string){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,`${name} is invalid.`);return value;}
function revision(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>2147483647)throw new ApiError(400,'Reload the current version before saving.');return Number(value);}
function calendarDate(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2200-12-31')throw new ApiError(400,'Choose a valid follow-up date.');const d=new Date(`${value}T12:00:00Z`);if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new ApiError(400,'Choose a valid follow-up date.');return value;}
function reference(input:Record<string,unknown>){const source=text(input.source,'Source',20),kind=text(input.kind,'Source record type',30),external_id=text(input.external_id,'Source record ID',300);if(!Object.hasOwn(KINDS,source)||!KINDS[source].includes(kind))throw new ApiError(400,'Choose an available source record.');return {source,kind,external_id};}
function target(input:Record<string,unknown>){fields(input,['owner_id','period','currency','amount','note','expectedVersion']);const owner_id=identifier(input.owner_id,'Sales owner'),period=text(input.period,'Target month',7),currency=text(input.currency,'Currency',3);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period<'1900-01'||period>'2200-12'||!/^[A-Z]{3}$/.test(currency))throw new ApiError(400,'Choose a valid month and three-letter currency.');
 const raw=input.amount;if(typeof raw!=='number'&&typeof raw!=='string')throw new ApiError(400,'Enter a positive revenue objective with at most two decimal places.');const amount=String(raw);if(!/^\d{1,13}(?:\.\d{1,2})?$/.test(amount)||Number(amount)<=0||Number(amount)>1e12)throw new ApiError(400,'Enter a positive revenue objective with at most two decimal places.');
 return {owner_id,period,currency,amount,note:text(input.note??'','Target note',1000,false),...(input.expectedVersion===undefined?{}:{expectedVersion:revision(input.expectedVersion)})};
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);if(error)databaseFailure(error);return data;}
function sourceFingerprint(ctx:APIContext,source:string){const fingerprint=integrationFingerprints(ctx)[source];if(!fingerprint)throw new ApiError(409,'Configure and sync this source before linking its records.');return fingerprint;}

export async function salesWorkspace(ctx:APIContext,url:URL){
 salesAccess(ctx);const input=Object.fromEntries(url.searchParams);for(const key of Object.keys(input))if(!['view','owner','q','period','limit','offset'].includes(key))throw new ApiError(400,'Unsupported sales filter.');
 const view=input.view||'contacts',owner=input.owner||'',q=input.q||'',period=input.period||new Date().toISOString().slice(0,7);
 if(!VIEWS.includes(view)||q.length>200||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period<'1900-01'||period>'2200-12')throw new ApiError(400,'Invalid sales filters.');if(owner)identifier(owner,'Sales owner');if(ctx.actor.role!=='founder'&&owner&&owner!==ctx.actor.id)throw new ApiError(403,'Open your assigned sales records.');
 const integer=(name:string,fallback:number,min:number,max:number)=>{const raw=input[name];if(raw===undefined)return fallback;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw new ApiError(400,`Invalid sales ${name}.`);return Number(raw);};
 const filters={view,owner,q,period,limit:integer('limit',30,1,100),offset:integer('offset',0,0,150000)};
 const [data,connections]=await Promise.all([rpc(ctx,'nam_sales_workspace_data',{w:ctx.workspaceId,fingerprints:integrationFingerprints(ctx),filters}),integrationStatus(ctx)]);
 return {...data,connections,source_of_truth:'Attio',definitions:{crm:'Attio holds CRM records. Edit contacts, companies, leads and opportunities in Attio; NAM OS keeps a read-only snapshot.',leads:'The lead view includes Attio people with a value in the configured lead-status attribute. People without this attribute remain contacts. Qualified status uses only the configured exact values.',forecast:'The month forecast includes explicitly mapped open opportunities with an Attio projected close date in the selected month. Weighted value requires a valid record probability and value on every included deal. Currencies remain separate.',revenue:'Objectives are entered in NAM OS. Progress is won deal value from Attio, using explicit stage categories and the configured closed-date attribute; it is not accounting revenue.',followups:'Follow-ups are central NAM tasks. Creating or linking one does not modify the source service.',outreach:'Lemlist activity and JustCall calls cover each saved snapshot period. Campaign reports are lifetime team totals. These events do not prove manual work.',conversion:'Current snapshot won / (won + lost) uses configured Attio stage categories. Historic funnel conversion requires source history and is unavailable here.'}};
}

/** Root dispatches this before the legacy sales handler. The shared API route
 * still owns managed-session, MFA, origin and CSRF validation. */
export async function dispatchSalesWorkspace(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path[0]!=='sales'||path[1]!=='workspace')return null;salesAccess(ctx);const method=request.method;
 if(path.length===2&&method==='GET')return json(await salesWorkspace(ctx,new URL(request.url)));
 if(path.length===3&&path[2]==='followups'&&method==='POST'){
  const input=await readJSON(request);fields(input,['source','kind','external_id','title','description','priority','due_date']);const ref=reference(input),priority=input.priority??'Normal';if(typeof priority!=='string'||!['Low','Normal','High','Urgent'].includes(priority))throw new ApiError(400,'Choose a follow-up priority.');
  const retry=request.headers.get('Idempotency-Key');if(!retry||!/^[A-Za-z0-9_-]{8,128}$/.test(retry))throw new ApiError(400,'A valid follow-up retry key is required.');
  const changes={title:text(input.title,'Follow-up title',200),description:text(input.description??'','Follow-up description',10000,false),priority,due_date:input.due_date?calendarDate(input.due_date):null};
  const row=await rpc(ctx,'nam_create_sales_followup',{w:ctx.workspaceId,s:ref.source,k:ref.kind,ref:ref.external_id,changes,retry_key:retry,source_fingerprint:sourceFingerprint(ctx,ref.source)});return json({task:row},201);
 }
 if(path.length===3&&path[2]==='links'&&method==='POST'){
  const input=await readJSON(request);fields(input,['source','kind','external_id','task_id','expectedVersion']);const ref=reference(input),id=identifier(input.task_id,'Follow-up task');await rpc(ctx,'nam_link_sales_followup',{w:ctx.workspaceId,tid:id,s:ref.source,k:ref.kind,ref:ref.external_id,expected_task_version:revision(input.expectedVersion),source_fingerprint:sourceFingerprint(ctx,ref.source)});return json({task_id:id});
 }
 if(path.length===3&&path[2]==='links'&&method==='DELETE'){
  const input=await readJSON(request);fields(input,['task_id','expectedVersion']);const id=identifier(input.task_id,'Follow-up task');await rpc(ctx,'nam_unlink_sales_followup',{w:ctx.workspaceId,tid:id,expected_task_version:revision(input.expectedVersion)});return json({task_id:id});
 }
 if(path.length===3&&path[2]==='targets'&&method==='POST'){
  requireFounder(ctx);return json({target:await rpc(ctx,'nam_set_sales_revenue_target',{w:ctx.workspaceId,payload:target(await readJSON(request))})});
 }
 throw new ApiError(405,'This sales action is not supported.');
}
