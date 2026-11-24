import 'server-only';
import {cookies} from 'next/headers';
import type {SupabaseClient} from '@supabase/supabase-js';
import {supabaseServer} from '@/lib/supabase/server';
import {ApiError,constantEqual,cookieValue,expectedOrigin,issueCsrf,requireSecret,validCsrf} from './security-helpers';
export {ApiError,readJSON,fields,inputText,safeNext} from './security-helpers';

export type Member={id:string;name:string;initials:string;role:string};
export type APIContext={supabase:SupabaseClient;user:{id:string;email?:string};sessionId:string;actor:Member;workspaceId:string;members:Member[];csrf:string;mfa:{currentLevel:string;nextLevel:string;required:boolean;verified:boolean;factors:Array<{id:string;status:string;factor_type:string;friendly_name?:string}>}};
const ROLES=new Set(['founder','sales_manager','sales','production_manager','artist','freelancer']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asMember=(row:{user_id:string;name:string;role:string}):Member=>({id:row.user_id,name:row.name,role:row.role,initials:row.name.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()});
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export function applicationOrigin(request:Request){return expectedOrigin(process.env.NAM_APP_ORIGIN||process.env.NEXT_PUBLIC_APP_URL||process.env.APP_ORIGIN,request.url);}
export function validateOrigin(request:Request){const origin=request.headers.get('origin');if(!origin||origin!==applicationOrigin(request))throw new ApiError(403,'This request origin is not allowed.','ORIGIN_REJECTED');}
export async function getContext(request?:Request,{allowMfaPending=false}:{allowMfaPending?:boolean}={}):Promise<APIContext>{
  const supabase=await supabaseServer();const {data:{user},error}=await supabase.auth.getUser();if(error||!user)throw new ApiError(401,'Sign in to open the studio workspace.','SIGN_IN_REQUIRED');
  // Both current account validity and cryptographically verified JWT claims are checked.
  const {data:claimData,error:claimError}=await supabase.auth.getClaims();if(claimError||claimData?.claims.sub!==user.id)throw new ApiError(401,'Your session could not be verified.','SIGN_IN_REQUIRED');
  const sessionId=claimData.claims.session_id;if(typeof sessionId!=='string'||!UUID.test(sessionId))throw new ApiError(401,'Your session could not be verified.','SIGN_IN_REQUIRED');
  const {data:memberships,error:membershipError}=await supabase.from('nam_memberships').select('workspace_id,user_id,name,role,active').eq('user_id',user.id).eq('active',true);if(membershipError)throw new ApiError(503,'Workspace access could not be checked.','MEMBERSHIP_UNAVAILABLE');
  const target=process.env.NAM_WORKSPACE_ID;const available=(memberships||[]).filter(m=>ROLES.has(m.role));if(target&&!UUID.test(target))throw new ApiError(503,'Workspace configuration is invalid.','CONFIGURATION_REQUIRED');const chosen=target?available.find(m=>m.workspace_id===target):available.length===1?available[0]:null;if(!chosen)throw new ApiError(403,available.length>1?'The workspace must be selected by the operator.':'Your account has no active NAM membership.','MEMBERSHIP_REQUIRED');
  const {data:factors,error:factorError}=await supabase.auth.mfa.listFactors();if(factorError)throw new ApiError(503,'Authenticator status could not be checked.','MFA_UNAVAILABLE');
  const factorList=(factors?.all||[]).map(f=>({id:f.id,status:f.status,factor_type:f.factor_type,friendly_name:f.friendly_name}));const verified=claimData.claims.aal==='aal2';const required=chosen.role==='founder'||factorList.some(f=>f.status==='verified');if(required&&!verified&&!allowMfaPending)throw new ApiError(403,'Verify two-factor authentication before opening the workspace.','MFA_REQUIRED');
  const {data:rows,error:memberError}=await supabase.from('nam_memberships').select('user_id,name,role').eq('workspace_id',chosen.workspace_id).eq('active',true).order('name');if(memberError)throw new ApiError(503,'Team membership could not be loaded.');
  const jar=await cookies(),secret=requireSecret(process.env.NAM_CSRF_SECRET);let csrf=jar.get('nam_csrf')?.value;
  if(!validCsrf(csrf,user.id,chosen.workspace_id,secret)){csrf=issueCsrf(user.id,chosen.workspace_id,secret);if(request)jar.set('nam_csrf',csrf,{httpOnly:true,secure:applicationOrigin(request).startsWith('https:'),sameSite:'strict',path:'/',maxAge:43200});}
  return {supabase,user:{id:user.id,email:user.email},sessionId,actor:asMember(chosen),workspaceId:chosen.workspace_id,members:(rows||[]).filter(m=>ROLES.has(m.role)).map(asMember),csrf:csrf!,mfa:{currentLevel:verified?'aal2':'aal1',nextLevel:factorList.some(f=>f.status==='verified')?'aal2':'aal1',required,verified,factors:factorList}};
}
export function assertMutation(context:APIContext,request:Request){validateOrigin(request);const token=request.headers.get('x-csrf-token'),cookie=cookieValue(request.headers.get('cookie'),'nam_csrf');if(!token||!cookie||!constantEqual(token,cookie)||!constantEqual(token,context.csrf)||!validCsrf(token,context.user.id,context.workspaceId,requireSecret(process.env.NAM_CSRF_SECRET)))throw new ApiError(403,'Refresh the workspace before making this change.','CSRF_REJECTED');}
export function requireFounder(context:APIContext){if(context.actor.role!=='founder'||!context.mfa.verified)throw new ApiError(403,'Verified founder access is required.','FOUNDER_REQUIRED');}

/** Recheck the original request identity immediately before privileged effects.
 * Rebuilding context from an ambient/new session would authorize a different
 * request. The user-JWT RPC checks current membership and managed session rows. */
export async function requireLiveContext(context:APIContext,{founder=false,allowMfaPending=false}:{founder?:boolean;allowMfaPending?:boolean}={}){
  if(founder)requireFounder(context);
  const {data,error}=await context.supabase.auth.getClaims();
  if(error||data?.claims.sub!==context.user.id||data.claims.session_id!==context.sessionId)throw new ApiError(401,'The original request session has ended. Sign in again.','SIGN_IN_REQUIRED');
  if(founder){if(data.claims.aal!=='aal2')throw new ApiError(403,'Verified founder access is required.','FOUNDER_REQUIRED');const {data:permitted,error:checkError}=await context.supabase.rpc('nam_founder',{w:context.workspaceId});if(checkError)throw new ApiError(503,'Current founder access could not be verified.','AUTHORIZATION_UNAVAILABLE');if(permitted!==true)throw new ApiError(403,'Founder access was revoked before this action.','FOUNDER_REQUIRED');return;}
  const {data:role,error:roleError}=await context.supabase.rpc('nam_role',{w:context.workspaceId});if(roleError)throw new ApiError(503,'Current workspace access could not be verified.','AUTHORIZATION_UNAVAILABLE');if(typeof role!=='string'||!ROLES.has(role))throw new ApiError(403,'Workspace access was revoked before this action.','MEMBERSHIP_REQUIRED');
  if(!allowMfaPending){const {data:assured,error:assuranceError}=await context.supabase.rpc('nam_assured');if(assuranceError)throw new ApiError(503,'Current authentication assurance could not be verified.','AUTHORIZATION_UNAVAILABLE');if(assured!==true||(role==='founder'&&data.claims.aal!=='aal2'))throw new ApiError(403,'Verify two-factor authentication before this action.','MFA_REQUIRED');}
}
