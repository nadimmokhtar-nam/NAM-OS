import {ApiError,assertMutation,getContext,json} from '@/lib/api/context';
import {publicAuth,authAPI} from '@/lib/api/auth';
import {bootstrap} from '@/lib/api/bootstrap';
import {dispatchTasks} from '@/lib/api/tasks';
import {dispatchAcademy} from '@/lib/api/academy';
import {dispatchSales} from '@/lib/api/sales';
import {dispatchOperations} from '@/lib/api/operations';
import {dispatchAccess} from '@/lib/api/access';
import {dispatchProjects} from '@/lib/api/projects';
import {dispatchDaily} from '@/lib/api/daily';
import {dispatchAcademyVideo} from '@/lib/api/academy-video';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type RouteContext={params:Promise<{path?:string[]}>};
async function route(request:Request,parameters:RouteContext):Promise<Response>{
 try{
  const path=(await parameters.params).path||[];
  const open=await publicAuth(request,'/'+path.join('/'));if(open)return open;
  const context=await getContext(request,{allowMfaPending:path[0]==='auth'||path.join('/')==='bootstrap'});
  if(!['GET','HEAD'].includes(request.method))assertMutation(context,request);
  if(path.length===1&&path[0]==='bootstrap'&&request.method==='GET')return json(await bootstrap(context,new URL(request.url).searchParams.get('scope')||undefined));
  const auth=await authAPI(context,request,'/'+path.join('/'));if(auth)return auth;
  // File URLs overlap task paths. Resolve the authorized private file routes
  // first; every dispatcher returns null for paths it does not own.
  for(const dispatch of [dispatchAccess,dispatchDaily,dispatchProjects,dispatchOperations,dispatchTasks,dispatchAcademyVideo,dispatchAcademy,dispatchSales]){const response=await dispatch(context,path,request);if(response)return response;}
  if(path[0]==='resources'&&path.length===1&&request.method==='GET')throw new ApiError(409,'This section currently supports tasks. Resource records are scheduled for the next milestone.','MODULE_NOT_AVAILABLE');
  throw new ApiError(404,'This page or record was not found.','NOT_FOUND');
 }catch(error){
  if(error instanceof ApiError)return json({error:error.message,code:error.code},error.status);
  // Supabase errors can contain query details or upstream identifiers. They
  // belong in bounded server diagnostics, never an API response or client log.
  console.error('NAM OS request failed',{type:error instanceof Error?error.name:'UnknownError'});
  return json({error:'The request could not be completed. Refresh to check your saved data before retrying.',code:'REQUEST_FAILED'},500);
 }
}
export const GET=route;
export const POST=route;
export const PATCH=route;
export const DELETE=route;
