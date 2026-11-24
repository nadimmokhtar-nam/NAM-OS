import 'server-only';
import {randomUUID} from 'node:crypto';
import {ApiError,json,readJSON,fields,requireFounder,type APIContext} from './context';
import {connectedOverview,integrationStatus,syncIntegration,salesAccess,databaseFailure} from '../integrations/service';
import {SOURCES,type Source} from '../integrations/types';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=['Outreach','Reply','Meeting held','Proposal','Research'];
const METRICS=['Meetings held','Outreach','Proposal','Reply','Research'];
function identifier(value:unknown,name='Record ID'):string {if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,`${name} is invalid.`);return value;}
function text(value:unknown,name:string,max:number,required=true):string {if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,`${name} is required and must be at most ${max} characters.`);return value.trim();}
function date(value:unknown,name:string):string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new ApiError(400,`${name} is invalid.`);const d=new Date(`${value}T12:00:00Z`);if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new ApiError(400,`${name} is invalid.`);return value;}
function activity(input:Record<string,unknown>,partial=false){fields(input,['type','context','outcome','note','occurred_on']);const output:Record<string,unknown>={};if(!partial||input.type!==undefined){if(typeof input.type!=='string'||!TYPES.includes(input.type))throw new ApiError(400,'Choose an activity type.');output.type=input.type;}for(const [key,name,max] of [['context','Context',200],['outcome','Outcome',500],['note','Note',3000]] as const)if(!partial||input[key]!==undefined)output[key]=text(input[key]??(key==='note'?'':undefined),name,max,key!=='note');if(!partial||input.occurred_on!==undefined)output.occurred_on=date(input.occurred_on,'Activity date');return output;}
function queryInteger(url:URL,name:string,defaultValue:number,max:number){const raw=url.searchParams.get(name);if(raw===null)return defaultValue;if(!/^\d+$/.test(raw)||Number(raw)>max)throw new ApiError(400,`Invalid ${name}.`);return Number(raw);}
async function manualSales(ctx:APIContext){
 salesAccess(ctx);const [activities,reports,targets,counts]=await Promise.all([
  ctx.supabase.from('nam_sales_activities').select('id,owner_id,type,context,outcome,note,occurred_on,created_at,updated_at,version').eq('workspace_id',ctx.workspaceId).is('deleted_at',null).order('created_at',{ascending:false}).limit(500),
  ctx.supabase.from('nam_sales_reports').select('id,owner_id,week_start,outcomes,blockers,next_week,submitted_at,reviewed_at,reviewed_by').eq('workspace_id',ctx.workspaceId).order('week_start',{ascending:false}).limit(500),
  ctx.supabase.from('nam_sales_targets').select('id,owner_id,metric,period,target,version').eq('workspace_id',ctx.workspaceId).order('period',{ascending:false}).limit(1000),
  ctx.supabase.rpc('nam_sales_activity_counts',{w:ctx.workspaceId}),
 ]);for(const result of [activities,reports,targets,counts])if(result.error)databaseFailure(result.error);
 return {activities:activities.data||[],reports:reports.data||[],targets:targets.data||[],activity_total:Number(counts.data?.total||0),activity_counts:counts.data?.by_month||[],activities_limit:500,activities_truncated:Number(counts.data?.total||0)>500};
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const result=await ctx.supabase.rpc(name,args);if(result.error)databaseFailure(result.error);return result.data;}

export async function dispatchSales(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(!['sales','integrations'].includes(path[0]))return null;salesAccess(ctx);const method=request.method,url=new URL(request.url);
 if(path.length===1&&path[0]==='sales'&&method==='GET')return json(await manualSales(ctx));
 if(path.join('/')==='sales/connected'&&method==='GET'){
  const source=url.searchParams.get('source')||'',kind=url.searchParams.get('kind')||'',owner=url.searchParams.get('owner')||'',q=url.searchParams.get('q')||'';
  if(source&&!SOURCES.includes(source as Source))throw new ApiError(400,'Invalid source filter.');if(kind&&!['lead','company','deal','campaign','campaign_report','outreach','call'].includes(kind))throw new ApiError(400,'Invalid record type.');if(owner)identifier(owner,'Owner');if(q.length>200)throw new ApiError(400,'Search is too long.');const limit=queryInteger(url,'limit',20,500),offset=queryInteger(url,'offset',0,150000);if(!limit)throw new ApiError(400,'Record limit must be positive.');return json(await connectedOverview(ctx,{source,kind,owner,q,limit,offset}));
 }
 if(path.join('/')==='integrations'&&method==='GET')return json(await integrationStatus(ctx));
 if(path.length===3&&path[0]==='integrations'&&path[2]==='sync'&&method==='POST'){
  requireFounder(ctx);if(!SOURCES.includes(path[1] as Source))throw new ApiError(404,'Connection not found.');const input=await readJSON(request);fields(input,[]);return json(await syncIntegration(ctx,path[1] as Source));
 }
 if(path.join('/')==='integrations/owners'&&method==='POST'){
  requireFounder(ctx);const input=await readJSON(request);fields(input,['source','external_owner_id','member_id']);if(typeof input.source!=='string'||!SOURCES.includes(input.source as Source))throw new ApiError(400,'Invalid connection source.');const external=text(input.external_owner_id,'Provider member ID',300),member=identifier(input.member_id,'NAM member');await rpc(ctx,'nam_map_integration_owner',{w:ctx.workspaceId,s:input.source,external_owner:external,member});return json(await integrationStatus(ctx));
 }
 if(path.join('/')==='sales/activities'&&method==='POST'){
  const input=activity(await readJSON(request)),key=request.headers.get('idempotency-key')||randomUUID();if(key.length>128||!/^[A-Za-z0-9_-]+$/.test(key))throw new ApiError(400,'Invalid request key.');await rpc(ctx,'nam_save_sales_activity',{w:ctx.workspaceId,activity_id:null,expected_version:null,payload:input,p_request_key:key});return json(await manualSales(ctx),201);
 }
 if(path.join('/')==='sales/activities'&&method==='GET'){
  const limit=queryInteger(url,'limit',50,500),offset=queryInteger(url,'offset',0,150000);if(!limit)throw new ApiError(400,'Record limit must be positive.');const result=await ctx.supabase.from('nam_sales_activities').select('id,owner_id,type,context,outcome,note,occurred_on,created_at,updated_at,version',{count:'exact'}).eq('workspace_id',ctx.workspaceId).is('deleted_at',null).order('created_at',{ascending:false}).range(offset,offset+limit-1);if(result.error)databaseFailure(result.error);return json({items:result.data||[],total:result.count||0,limit,offset});
 }
 if(path.length===3&&path[0]==='sales'&&path[1]==='activities'&&['PATCH','DELETE'].includes(method)){
  const id=identifier(path[2]),input=await readJSON(request);fields(input,method==='PATCH'?['expectedVersion','changes']:['expectedVersion']);if(!Number.isInteger(input.expectedVersion)||Number(input.expectedVersion)<1)throw new ApiError(400,'An expected record version is required.');let changes:Record<string,unknown>={deleted:true};if(method==='PATCH'){if(!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw new ApiError(400,'Activity changes are required.');changes=activity(input.changes as Record<string,unknown>,true);}await rpc(ctx,'nam_save_sales_activity',{w:ctx.workspaceId,activity_id:id,expected_version:input.expectedVersion,payload:changes,p_request_key:null});return json(await manualSales(ctx));
 }
 if(path.join('/')==='sales/reports'&&method==='POST'){
  const input=await readJSON(request);fields(input,['week_start','outcomes','blockers','next_week']);const week=date(input.week_start,'Week start');if(new Date(`${week}T12:00:00Z`).getUTCDay()!==1)throw new ApiError(400,'Choose the Monday of the reporting week.');await rpc(ctx,'nam_submit_sales_report',{w:ctx.workspaceId,payload:{week_start:week,outcomes:text(input.outcomes,'Outcomes',5000),blockers:text(input.blockers??'','Blockers',5000,false),next_week:text(input.next_week,'Next week',5000)}});return json(await manualSales(ctx));
 }
 if(path.length===4&&path[0]==='sales'&&path[1]==='reports'&&path[3]==='review'&&method==='POST'){
  requireFounder(ctx);const input=await readJSON(request);fields(input,[]);await rpc(ctx,'nam_review_sales_report',{w:ctx.workspaceId,report_id:identifier(path[2])});return json(await manualSales(ctx));
 }
 if(path.join('/')==='sales/targets'&&method==='POST'){
  requireFounder(ctx);const input=await readJSON(request);fields(input,['owner_id','metric','period','target','expectedVersion']);if(input.expectedVersion!==undefined&&(!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<1||Number(input.expectedVersion)>2147483647))throw new ApiError(400,'The target revision is invalid.');identifier(input.owner_id,'Sales member');if(typeof input.metric!=='string'||!METRICS.includes(input.metric))throw new ApiError(400,'Invalid target metric.');if(typeof input.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period))throw new ApiError(400,'Choose a target month.');if(!Number.isInteger(input.target)||Number(input.target)<1||Number(input.target)>100000)throw new ApiError(400,'Target must be a positive whole number.');await rpc(ctx,'nam_set_sales_target',{w:ctx.workspaceId,payload:input});return json(await manualSales(ctx));
 }
 return null;
}
