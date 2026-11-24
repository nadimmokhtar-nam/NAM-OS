import 'server-only';
import {type APIContext,ApiError,fields,inputText,json,readJSON,requireFounder,requireLiveContext} from './context';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES=new Set(['sales_manager','sales','production_manager','artist','freelancer']);
const SECTIONS=new Set(['sales','academy','projects','library','team','operations']);
export type EffectiveAccess={sections:string[];create_sections:string[];revision:number|null;member_sections:Record<string,string[]>};
function databaseError(error:{code?:string}|null){
 if(!error)return;
 if(error.code==='42501')throw new ApiError(403,'Verified founder access is required for this change.','ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'Member not found.','MEMBER_NOT_FOUND');
 if(error.code==='40001')throw new ApiError(409,'Access changed elsewhere. Reload the member before saving.','ACCESS_CONFLICT');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Choose a supported role and eligible section grants.','INVALID_ACCESS');
 throw new ApiError(503,'Access administration is temporarily unavailable. Please retry.','ACCESS_UNAVAILABLE');
}
export async function effectiveAccess(context:APIContext):Promise<EffectiveAccess>{
 const {data,error}=await context.supabase.rpc('nam_effective_access',{w:context.workspaceId});databaseError(error);
 if(!data||!Array.isArray(data.sections)||!Array.isArray(data.create_sections)||data.sections.some((s:unknown)=>typeof s!=='string'||!SECTIONS.has(s))||data.create_sections.some((s:unknown)=>typeof s!=='string'||!data.sections.includes(s)))throw new ApiError(503,'Workspace section access could not be verified.','ACCESS_UNAVAILABLE');
 const memberSections=data.member_sections;
 if(!memberSections||typeof memberSections!=='object'||Array.isArray(memberSections)||Object.entries(memberSections).some(([id,value])=>!UUID.test(id)||!Array.isArray(value)||value.some(s=>typeof s!=='string'||!SECTIONS.has(s)))||!Array.isArray(memberSections[context.user.id]))throw new ApiError(503,'Member section access could not be verified.','ACCESS_UNAVAILABLE');
 const own=memberSections[context.user.id];if(own.length!==data.sections.length||own.some((s:string)=>!data.sections.includes(s)))throw new ApiError(503,'Workspace permissions are inconsistent.','ACCESS_UNAVAILABLE');
 return data;
}
export async function dispatchAccess(context:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path[0]!=='auth'||path[1]!=='access'||path.length!==3)return null;
 requireFounder(context);const id=path[2];if(!UUID.test(id))throw new ApiError(400,'Choose a valid member.','INVALID_MEMBER');
 if(request.method==='GET'){
  await requireLiveContext(context,{founder:true});const {data,error}=await context.supabase.rpc('nam_access_member',{w:context.workspaceId,target_user:id});databaseError(error);await requireLiveContext(context,{founder:true});return json(data);
 }
 if(request.method==='PATCH'){
  const input=await readJSON(request);fields(input,['expectedRevision','role','grants']);
  if(!Number.isInteger(input.expectedRevision)||(input.expectedRevision as number)<1)throw new ApiError(400,'Reload the current access version.','INVALID_ACCESS');
  const role=inputText(input.role,'Role',{max:40});if(!ROLES.has(role))throw new ApiError(400,'Choose a supported role template.','INVALID_ACCESS');
  if(!Array.isArray(input.grants)||input.grants.length>6)throw new ApiError(400,'Choose valid section grants.','INVALID_ACCESS');
  const seen=new Set<string>();const grants=input.grants.map((value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'Choose valid section grants.');const grant=value as Record<string,unknown>;fields(grant,['section','can_create']);if(typeof grant.section!=='string'||!SECTIONS.has(grant.section)||typeof grant.can_create!=='boolean'||seen.has(grant.section))throw new ApiError(400,'Choose each section once with a valid creation setting.','INVALID_ACCESS');seen.add(grant.section);return {section:grant.section,can_create:grant.can_create};});
  await requireLiveContext(context,{founder:true});const {data,error}=await context.supabase.rpc('nam_save_member_access',{w:context.workspaceId,target_user:id,expected_revision:input.expectedRevision,next_role:role,section_grants:grants});databaseError(error);await requireLiveContext(context,{founder:true});return json(data);
 }
 throw new ApiError(405,'Use GET or PATCH for member access.','METHOD_NOT_ALLOWED');
}
