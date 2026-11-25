import 'server-only';
import {cookies} from 'next/headers';
import type {SupabaseClient} from '@supabase/supabase-js';
import {supabaseServer} from '@/lib/supabase/server';
import {ApiError,applicationOrigin,validateOrigin} from './context';
import {constantEqual,cookieValue,issueCsrf,requireSecret,validCsrf} from './security-helpers';

export const CLIENT_UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export type ClientContext={supabase:SupabaseClient;workspaceId:string;userId:string;sessionId:string;name:string;csrf:string;mfaRequired:boolean;mfaVerified:boolean;factors:Array<{id:string;status:string;factor_type:string}>};
export function clientWorkspace(){const value=process.env.NAM_WORKSPACE_ID;if(!value||!CLIENT_UUID.test(value))throw new ApiError(503,'Client review has not been configured.','CONFIGURATION_REQUIRED');return value;}
export function reviewFailure(error:{code?:string}){
 if(error.code==='42501')throw new ApiError(403,'This account cannot perform this review action.','REVIEW_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,'This review or issued image is no longer available.','REVIEW_NOT_FOUND');
 if(['40001','23505'].includes(error.code||''))throw new ApiError(409,'This record changed elsewhere. Reload the saved details before retrying.','REVIEW_CONFLICT');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'Check the selected images, recipients and review fields.','REVIEW_VALIDATION');
 throw new ApiError(503,'Review records could not be reached. Check the saved response before retrying.','REVIEW_UNAVAILABLE');
}
export async function reviewRPC(context:{supabase:SupabaseClient;workspaceId:string},name:string,args:Record<string,unknown>){const input=name==='nam_assured'?{}:{...args,w:context.workspaceId};const {data,error}=await context.supabase.rpc(name,input);if(error)reviewFailure(error);return data;}
export async function getClientContext(request:Request,{allowMfaPending=false}={}):Promise<ClientContext>{
 const supabase=await supabaseServer(),workspaceId=clientWorkspace();
 const {data:{user},error}=await supabase.auth.getUser();if(error||!user)throw new ApiError(401,'Sign in to review your project.','SIGN_IN_REQUIRED');
 const {data:verified,error:claimError}=await supabase.auth.getClaims();
 if(claimError||verified?.claims.sub!==user.id||typeof verified.claims.session_id!=='string'||!CLIENT_UUID.test(verified.claims.session_id))throw new ApiError(401,'Your sign-in session could not be verified.','SIGN_IN_REQUIRED');
 const raw=user.factors===undefined?[]:user.factors;
 if(!Array.isArray(raw)||raw.some(f=>!f||typeof f.id!=='string'||!['verified','unverified'].includes(f.status)||typeof f.factor_type!=='string'))throw new ApiError(503,'Authenticator status could not be checked.');
 const factors=raw.map(f=>({id:f.id,status:f.status,factor_type:f.factor_type})),mfaRequired=factors.some(f=>f.status==='verified'),mfaVerified=verified.claims.aal==='aal2';
 const identity=await reviewRPC({supabase,workspaceId},'nam_client_identity',{});
 if(!identity||identity.id!==user.id)throw new ApiError(403,'Your client invitation is no longer active.');
 if(!allowMfaPending&&await reviewRPC({supabase,workspaceId},'nam_assured',{})!==true)throw new ApiError(403,'Verify your authenticator before opening the review.','MFA_REQUIRED');
 const jar=await cookies(),secret=requireSecret(process.env.NAM_CSRF_SECRET),purpose='client:'+workspaceId;let csrf=jar.get('nam_client_csrf')?.value;
 if(!validCsrf(csrf,user.id,purpose,secret)){csrf=issueCsrf(user.id,purpose,secret);jar.set('nam_client_csrf',csrf,{httpOnly:true,secure:applicationOrigin(request).startsWith('https:'),sameSite:'strict',path:'/',maxAge:43200});}
 return {supabase,workspaceId,userId:user.id,sessionId:verified.claims.session_id,name:identity.name,csrf:csrf!,mfaRequired,mfaVerified,factors};
}
export function assertClientMutation(context:ClientContext,request:Request){
 validateOrigin(request);const token=request.headers.get('x-csrf-token'),cookie=cookieValue(request.headers.get('cookie'),'nam_client_csrf');
 if(!token||!cookie||!constantEqual(token,cookie)||!constantEqual(token,context.csrf)||!validCsrf(token,context.userId,'client:'+context.workspaceId,requireSecret(process.env.NAM_CSRF_SECRET)))throw new ApiError(403,'Refresh your review before saving a response.','CSRF_REJECTED');
}
export async function requireClientLive(context:ClientContext){
 const {data,error}=await context.supabase.auth.getClaims();
 if(error||data?.claims.sub!==context.userId||data.claims.session_id!==context.sessionId)throw new ApiError(401,'The original review session ended. Sign in again.','SIGN_IN_REQUIRED');
 await reviewRPC(context,'nam_client_identity',{});
 if(await reviewRPC(context,'nam_assured',{})!==true)throw new ApiError(403,'Verify your authenticator before continuing.','MFA_REQUIRED');
}
