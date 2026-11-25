import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {cookies} from 'next/headers';
import {supabaseServer} from '@/lib/supabase/server';
import {ApiError,applicationOrigin,fields,inputText,json,readJSON,validateOrigin} from './context';
import {CLIENT_UUID,clientWorkspace,getClientContext,reviewRPC} from './client-context';

export function clientProvider(admin=false){
 const raw=process.env.NEXT_PUBLIC_SUPABASE_URL,key=admin?process.env.SUPABASE_SERVICE_ROLE_KEY:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!raw||!key)throw new ApiError(503,'Client sign-in has not been configured.','CONFIGURATION_REQUIRED');
 let url:URL;try{url=new URL(raw);}catch{throw new ApiError(503,'Client sign-in configuration is invalid.');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new ApiError(503,'Client sign-in configuration is invalid.');
 return createClient(raw,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'implicit'}});
}
export function clientEmail(value:unknown){const address=inputText(value,'Email',{max:254}).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw new ApiError(400,'Enter a valid email address.');return address;}
export async function sendClientSignIn(email:string,origin:string){
 const {error}=await clientProvider().auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:origin+'/review'}});
 // No authentication URL, OTP or bearer credential is returned to studio users.
 return !error;
}
function status(context:Awaited<ReturnType<typeof getClientContext>>){return {authenticated:true,id:context.userId,name:context.name,csrf:context.csrf,mfaRequired:context.mfaRequired&&!context.mfaVerified,factorId:context.factors.find(f=>f.status==='verified'&&f.factor_type==='totp')?.id};}
export async function publicClientAuth(request:Request,path:string[]):Promise<Response|null>{
 if(path[0]!=='client'||path[1]!=='auth'||path.length>3)return null;
 const action=path[2]||'',method=request.method;
 if(action===''&&method==='GET'){
  const server=await supabaseServer(),{data:{user},error}=await server.auth.getUser();
  if(error||!user)return json({authenticated:false});
  return json(status(await getClientContext(request,{allowMfaPending:true})));
 }
 if(method!=='POST')throw new ApiError(405,'Method not allowed.');validateOrigin(request);
 const input=await readJSON(request);
 if(action==='logout'){
  fields(input,[]);const server=await supabaseServer(),{error}=await server.auth.signOut({scope:'local'});
  if(error&&error.name!=='AuthSessionMissingError')throw new ApiError(503,'Sign-out could not be completed.');
  (await cookies()).delete('nam_client_csrf');return json({ok:true});
 }
 if(action==='link'){
  fields(input,['email']);const email=clientEmail(input.email),service=clientProvider(true),workspaceId=clientWorkspace();
  const {data:uid,error}=await service.rpc('nam_client_account_for_email',{address:email});
  if(error)throw new ApiError(503,'Client sign-in could not be requested. Please retry.');
  if(uid){const {data:allowed,error:grantError}=await service.rpc('nam_client_can_email',{w:workspaceId,uid});if(grantError)throw new ApiError(503,'Client sign-in could not be requested. Please retry.');if(allowed===true)await sendClientSignIn(email,applicationOrigin(request));}
  return json({ok:true,message:'If this email has an active invitation, a sign-in link has been requested. Check your inbox and spam folder.'},202);
 }
 if(action==='session'){
  fields(input,['access_token','refresh_token','code']);const server=await supabaseServer();
  let error;
  if(typeof input.code==='string'&&input.code.length>0&&input.code.length<=2048&&!input.access_token&&!input.refresh_token){({error}=await server.auth.exchangeCodeForSession(input.code));}
  else{
   if(typeof input.access_token!=='string'||input.access_token.length<20||input.access_token.length>16000||typeof input.refresh_token!=='string'||input.refresh_token.length<10||input.refresh_token.length>4000)throw new ApiError(400,'This sign-in link is invalid or incomplete.');
   ({error}=await server.auth.setSession({access_token:input.access_token,refresh_token:input.refresh_token}));
  }
  if(error)throw new ApiError(401,'This sign-in link is invalid or expired. Request a new link.','SIGN_IN_REQUIRED');
  try{return json(status(await getClientContext(request,{allowMfaPending:true})));}
  catch(problem){await server.auth.signOut({scope:'local'});throw problem;}
 }
 if(action==='mfa'){
  fields(input,['factor_id','code']);const context=await getClientContext(request,{allowMfaPending:true});
  if(typeof input.factor_id!=='string'||!CLIENT_UUID.test(input.factor_id)||!context.factors.some(f=>f.id===input.factor_id&&f.status==='verified'&&f.factor_type==='totp')||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))throw new ApiError(400,'Enter the six-digit code from your authenticator.');
  const {error}=await context.supabase.auth.mfa.challengeAndVerify({factorId:input.factor_id,code:input.code});if(error)throw new ApiError(error.status===429?429:401,'The authenticator code is invalid or expired.');
  const updated=await getClientContext(request);await reviewRPC(updated,'nam_client_identity',{});return json(status(updated));
 }
 throw new ApiError(404,'This sign-in action is not available.');
}
