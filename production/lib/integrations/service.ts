import 'server-only';
import {createHash} from 'node:crypto';
import {ApiError,requireFounder,type APIContext} from '../api/context';
import {attioSnapshot,lemlistSnapshot,justcallSnapshot} from './adapters.mjs';
import {IntegrationError} from './http.mjs';
import {SOURCES,LABELS,type Source,type ProviderConfig,type SavedConnection,type OwnerMapping,type ConnectedData,type TransportOptions} from './types';

const ADAPTERS={attio:attioSnapshot,lemlist:lemlistSnapshot,justcall:justcallSnapshot};
const EMPTY:ConnectedData={counts:[],reply_events:0,pipeline:[],records:[],records_total:0,external_owners:[]};
type Query={kind?:string;source?:string;owner?:string;q?:string;limit?:number;offset?:number};
type JobContext=Pick<APIContext,'supabase'|'workspaceId'>;
export function databaseFailure(error:{code?:string;message?:string}|null):never {
 if(error?.code==='42501')throw new ApiError(403,'You do not have permission to perform this sales action.');
 if(error?.code==='40001')throw new ApiError(409,'This record changed elsewhere. Reload it before saving.');
 if(error?.code==='55000')throw new ApiError(error.message?.includes('Retry time')?429:409,error.message?.includes('Retry time')?'The service requested a delay. Retry after the displayed time.':'This source is syncing, or its job lease expired. Refresh the connection status.');
 if(error?.code==='P0002')throw new ApiError(404,'The sales record was not found.');
 if(error?.code?.startsWith('22')||error?.code?.startsWith('23')||error?.code==='P0001')throw new ApiError(400,'The sales data is invalid. Check the values and try again.');
 throw new ApiError(503,'Sales data could not be saved or loaded. Try again.');
}
export function salesAccess(ctx:APIContext){if(!['founder','sales_manager','sales'].includes(ctx.actor.role))throw new ApiError(403,'Sales access is not granted.');}
function configuration(ctx:JobContext,source:Source):ProviderConfig|null {
 // The same server may serve more than one workspace. Explicit binding keeps a
 // workspace's API credentials from being used by another authenticated tenant.
 if(process.env.NAM_INTEGRATIONS_WORKSPACE_ID!==ctx.workspaceId)return null;
 if(source==='attio')return process.env.ATTIO_API_KEY?{token:process.env.ATTIO_API_KEY,dealsObject:process.env.ATTIO_DEALS_OBJECT||'deals',...(process.env.ATTIO_REPORTING_SCHEMA?{attioSchema:process.env.ATTIO_REPORTING_SCHEMA}:{})}:null;
 if(source==='lemlist')return process.env.LEMLIST_API_KEY?{key:process.env.LEMLIST_API_KEY}:null;
 return process.env.JUSTCALL_API_KEY&&process.env.JUSTCALL_API_SECRET?{key:process.env.JUSTCALL_API_KEY,secret:process.env.JUSTCALL_API_SECRET}:null;
}
function fingerprints(ctx:JobContext){return Object.fromEntries(SOURCES.map(source=>{const config=configuration(ctx,source);return [source,config?createHash('sha256').update(JSON.stringify(config)).digest('hex'):null];}));}
// Server-only binding for additional sales reads. Never serialize these hashes.
export function integrationFingerprints(ctx:JobContext){return fingerprints(ctx);}
async function savedConnections(ctx:APIContext){const {data,error}=await ctx.supabase.rpc('nam_integration_connection_state',{w:ctx.workspaceId,fingerprints:fingerprints(ctx)});if(error)databaseFailure(error);return (data||[]) as SavedConnection[];}
async function connectedData(ctx:APIContext,query:Query={}){const {data,error}=await ctx.supabase.rpc('nam_connected_sales_data',{w:ctx.workspaceId,fingerprints:fingerprints(ctx),record_limit:query.limit||20,record_offset:query.offset||0,filters:{kind:query.kind||'',source:query.source||'',owner:query.owner||'',q:query.q||''}});if(error)databaseFailure(error);return (data||EMPTY) as ConnectedData;}
async function mappings(ctx:APIContext){const {data,error}=await ctx.supabase.from('nam_integration_owner_map').select('source,external_owner_id,member_id,updated_at').eq('workspace_id',ctx.workspaceId);if(error)databaseFailure(error);return (data||[]) as OwnerMapping[];}
function connectionDTO(ctx:APIContext,saved:SavedConnection[],map:OwnerMapping[],rows:ConnectedData){return SOURCES.map(source=>{
 const c=saved.find(s=>s.source===source),configured=!!configuration(ctx,source),current=configured&&!!c?.snapshot_current,active=!!c?.lease_until&&new Date(c.lease_until)>new Date(),interrupted=c?.status==='syncing'&&!active;
 const status=!configured?'not_connected':active?'syncing':interrupted?'error':c?.status==='connected'&&!current?'ready_to_sync':c?.status||'ready_to_sync';
 return {source,label:LABELS[source],enabled:true,configured,status,last_attempt_at:c?.last_attempt_at||null,last_synced_at:current?c?.last_success_at||null:null,error_code:!configured?null:interrupted?'interrupted':c?.error_code||null,error_message:!configured?'Server credentials or the workspace binding have not been configured.':interrupted?'The previous sync was interrupted. Retry to refresh this connection.':!current&&c?.status==='connected'?'Connection credentials changed. Sync before viewing data.':c?.error_message||null,retry_at:c?.retry_at||null,coverage:current?c?.coverage||{}:{},warnings:current?c?.warnings||[]:[],stale:!!c?.last_success_at&&Date.now()-new Date(c.last_success_at).getTime()>30*60000,...(ctx.actor.role==='founder'?{owner_mappings:current?map.filter(m=>m.source===source):[],external_owners:current?rows.external_owners.filter(r=>r.source===source).map(r=>r.external_owner_id):[]}:{})};
 });}
export async function integrationStatus(ctx:APIContext){salesAccess(ctx);const [saved,map,rows]=await Promise.all([savedConnections(ctx),mappings(ctx),connectedData(ctx,{limit:1})]);return connectionDTO(ctx,saved,map,rows);}
export async function connectedOverview(ctx:APIContext,query:Query={}){
 salesAccess(ctx);const [saved,map,rows]=await Promise.all([savedConnections(ctx),mappings(ctx),connectedData(ctx,query)]),connections=connectionDTO(ctx,saved,map,rows);
 const metric=(id:string,title:string,source:Source,value:number|null,period:string,detail='')=>{const c=connections.find(c=>c.source===source)!,available=c.configured&&!!c.last_synced_at&&value!==null;return {id,title,source,value:available?value:null,available,last_synced_at:c.last_synced_at,connection_status:c.status,stale:c.stale||!['connected','syncing'].includes(c.status),period,detail:available?detail:c.error_message||detail||'Awaiting a successful source sync.'};};
 const count=(source:Source,kind:string)=>Number(rows.counts.find(c=>c.source===source&&c.kind===kind)?.n||0),attio=connections.find(c=>c.source==='attio')!;
 return {mode:'connected_data',connections,metrics:[metric('leads','CRM people','attio',count('attio','lead'),'Current CRM snapshot','People are not automatically qualified leads.'),metric('companies','Companies','attio',count('attio','company'),'Current CRM snapshot'),metric('deals','Deals','attio',attio.coverage.deals_available===false?null:count('attio','deal'),'Current CRM snapshot'),metric('campaigns','Campaigns','lemlist',ctx.actor.role==='founder'?count('lemlist','campaign'):null,'Current campaign snapshot','Campaign totals are team-level, not individual work.'),metric('outreach','Outreach events','lemlist',count('lemlist','outreach'),'Last 30 days','Provider events can include automation, opens and replies; not a count of manual work.'),metric('replies','Reply events','lemlist',Number(rows.reply_events),'Last 30 days','Attributed to sending user when supplied.'),metric('calls','Calls','justcall',count('justcall','call'),'Last 30 days')],records:rows.records,records_total:Number(rows.records_total),records_limit:query.limit||20,records_offset:query.offset||0,pipeline:rows.pipeline.map(p=>({...metric(`pipeline-${p.currency}-${p.stage}`,'Deal value by stage','attio',Number(p.amount),'Current CRM snapshot','Currencies and stages remain separate.'),currency:p.currency,stage:p.stage})),ownership_note:'Individual reports include only explicitly mapped external owners. Unmapped or shared records remain founder-only. Name and email matching never grants access.',deduplication_note:'Stable provider IDs deduplicate each source. CRM people, campaign events and calls remain separate; cross-source person matching is not assumed.'};
}
export async function syncIntegration(ctx:APIContext,source:Source,options:TransportOptions={}){
 requireFounder(ctx);return performSync(ctx,source,options);
}
async function performSync(ctx:JobContext,source:Source,options:TransportOptions={}){
 const config=configuration(ctx,source);if(!config)throw new ApiError(409,`Configure ${LABELS[source]} credentials and the NAM workspace binding on the server before syncing.`);
 const hash=fingerprints(ctx)[source];const begin=await ctx.supabase.rpc('nam_begin_integration_sync',{w:ctx.workspaceId,s:source,fingerprint:hash});if(begin.error)databaseFailure(begin.error);const token=begin.data as string;let renewed=Date.now();
 const renew=async()=>{const r=await ctx.supabase.rpc('nam_renew_integration_lease',{w:ctx.workspaceId,s:source,token});if(r.error)databaseFailure(r.error);renewed=Date.now();};
 const fetchImpl:typeof fetch=async(input,init)=>{if(Date.now()-renewed>15000)await renew();return (options.fetchImpl||fetch)(input,init);};
 try{
  const snapshot=await ADAPTERS[source](config,{...options,fetchImpl});
  if(fingerprints(ctx)[source]!==hash)throw new IntegrationError('credentials_changed','Connection credentials changed during sync. Retry with the current connection.');
  const unique=new Map<string,typeof snapshot.records[number]>();for(const r of snapshot.records){const key=`${r.kind}\0${r.external_id}`;if(!unique.has(key))unique.set(key,r);}if(unique.size>50000)throw new IntegrationError('limit_exceeded','The source exceeded the supported snapshot size. No partial result was published.');
  await renew();const finished=await ctx.supabase.rpc('nam_finish_integration_sync',{w:ctx.workspaceId,s:source,token,records:[...unique.values()],coverage:{...snapshot.coverage,duplicate_records_ignored:snapshot.records.length-unique.size},warnings:snapshot.warnings});if(finished.error)databaseFailure(finished.error);
  return {source,status:'connected',records:Number(finished.data),duplicates_ignored:snapshot.records.length-unique.size};
 }catch(error){const safe=error instanceof IntegrationError?error:new IntegrationError('sync_failed',`${LABELS[source]} could not sync. The previous successful snapshot is retained.`),retry=safe.retryAt||(safe.code==='unavailable'||safe.code==='sync_failed'?new Date(Date.now()+60000).toISOString():null);await ctx.supabase.rpc('nam_fail_integration_sync',{w:ctx.workspaceId,s:source,token,code:safe.code,message:safe.message,retry_time:retry});throw new ApiError(safe.code==='expired'?424:safe.code==='rate_limited'?429:502,safe.message);}
}
// Server-only scheduled runner. The caller must verify its cron secret and use
// a service-role Supabase client. RPC authorization independently enforces this;
// a normal sales JWT cannot acquire a job by calling this helper indirectly.
export async function runScheduledIntegrations(ctx:JobContext,options:TransportOptions={}){
 if(!process.env.NAM_INTEGRATIONS_WORKSPACE_ID||ctx.workspaceId!==process.env.NAM_INTEGRATIONS_WORKSPACE_ID)throw new ApiError(409,'The integration workspace binding is not configured.');
 const outcomes:Array<{source:Source;status:string;error?:string;records?:number}>=[];
 for(const source of SOURCES){if(!configuration(ctx,source)){outcomes.push({source,status:'not_connected'});continue;}try{const result=await performSync(ctx,source,options);outcomes.push({source,status:result.status,records:result.records});}catch(error){outcomes.push({source,status:error instanceof ApiError&&error.status===429?'retry_later':'error',error:error instanceof ApiError?error.message:'The scheduled source sync failed.'});}}
 return outcomes;
}
