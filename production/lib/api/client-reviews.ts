import 'server-only';
import {createHash} from 'node:crypto';
import {type APIContext,ApiError,applicationOrigin,fields,inputText,json,readJSON,requireFounder,requireLiveContext} from './context';
import {type ClientContext,CLIENT_UUID,assertClientMutation,getClientContext,requireClientLive,reviewFailure,reviewRPC} from './client-context';
import {clientEmail,clientProvider,publicClientAuth,sendClientSignIn} from './client-review-auth';

function id(value:unknown){if(typeof value!=='string'||!CLIENT_UUID.test(value))throw new ApiError(400,'Choose a valid project, client or issued image.');return value;}
function revision(value:unknown,zero=false){if(!Number.isSafeInteger(value)||Number(value)<(zero?0:1)||Number(value)>2147483646)throw new ApiError(400,'Reload the saved record before retrying.');return Number(value);}
function key(request:Request){const value=request.headers.get('Idempotency-Key');if(!value||!/^[A-Za-z0-9_-]{8,128}$/.test(value))throw new ApiError(400,'A stable retry key is required.');return value;}
function page(request:Request,allowSearch=false){const query=new URL(request.url).searchParams;if([...query.keys()].some(k=>!['page',...(allowSearch?['search']:[])].includes(k)))throw new ApiError(400,'Unsupported review filter.');const n=Number(query.get('page')||1);if(!Number.isSafeInteger(n)||n<1||n>100000)throw new ApiError(400,'Choose a valid page.');return {page:n,...(allowSearch?{search:inputText(query.get('search')||'','Search',{max:200,required:false})}:{})};}

export async function dispatchStudioReviews(context:APIContext,path:string[],request:Request):Promise<Response|null>{
 const method=request.method;
 if(path[0]==='renders'&&path.length===3&&path[2]==='client-feedback'&&method==='GET')return json({items:await reviewRPC(context,'nam_staff_client_feedback',{rid:id(path[1])})});
 if(path[0]==='projects'&&path.length===3&&['clients','reviews','review-images'].includes(path[2])){
  requireFounder(context);const pid=id(path[1]),kind=path[2];
  if(method==='GET'){
   const input=page(request,kind==='review-images');return json(await reviewRPC(context,kind==='clients'?'nam_project_client_page':kind==='reviews'?'nam_staff_reviews_page':'nam_review_images_page',{pid,...input}));
  }
  if(method!=='POST'||kind==='review-images')throw new ApiError(405,'Method not allowed.');
  const input=await readJSON(request);
  if(kind==='reviews'){
   fields(input,['title','message','allow_download','items','recipients']);
   input.title=inputText(input.title,'Request title',{max:200});input.message=inputText(input.message??'','Message',{max:5000,required:false});
   if(typeof input.allow_download!=='boolean'||!Array.isArray(input.items)||input.items.length<1||input.items.length>100||!Array.isArray(input.recipients)||input.recipients.length<1||input.recipients.length>20)throw new ApiError(400,'Choose up to 100 images and 20 recipients.');
   input.items=input.items.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError(400,'Choose a verified render.');fields(item,['deliverable_id','render_id','expected_version']);return {deliverable_id:id(item.deliverable_id),render_id:id(item.render_id),expected_version:revision(item.expected_version)};});
   input.recipients=input.recipients.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError(400,'Choose an invited client.');fields(item,['user_id','can_decide']);if(typeof item.can_decide!=='boolean')throw new ApiError(400,'Choose explicit client decision permissions.');return {user_id:id(item.user_id),can_decide:item.can_decide};});
   await requireLiveContext(context,{founder:true});const qid=await reviewRPC(context,'nam_issue_client_review',{pid,payload:input,retry_key:key(request)});
   return json(await reviewRPC(context,'nam_staff_review_detail',{qid}),201);
  }
  fields(input,['name','email','can_approve','active','expectedVersion','user_id']);
  const name=inputText(input.name,'Client name',{max:100}),email=clientEmail(input.email);
  if(typeof input.can_approve!=='boolean'||typeof input.active!=='boolean')throw new ApiError(400,'Choose explicit client access permissions.');
  const retry=key(request),expected=input.expectedVersion==null?null:revision(input.expectedVersion);
  await requireLiveContext(context,{founder:true});
  // Provisioning does not send email or create a studio membership. The
  // founder-authorized RPC grants access before any sign-in email is requested.
  const service=clientProvider(true);let uid:string;
  if(input.user_id!==undefined)uid=id(input.user_id);
  else{
   const found=await service.rpc('nam_client_account_for_email',{address:email});if(found.error)reviewFailure(found.error);uid=found.data;
   if(!uid){const {data,error}=await service.auth.admin.createUser({email,email_confirm:false});if(error||!data.user)throw new ApiError(503,'The client account could not be prepared. Check existing access before retrying.');uid=data.user.id;}
  }
  await requireLiveContext(context,{founder:true});
  const result=await reviewRPC(context,'nam_save_client_access',{pid,uid,expected_version:expected,payload:{name,email,active:input.active,can_approve:input.can_approve},retry_key:retry});
  return json({...result,name,email},expected===null?201:200);
 }
 if(path[0]==='projects'&&path.length===5&&path[2]==='clients'&&path[4]==='invite'){
  if(method!=='POST')throw new ApiError(405,'Method not allowed.');requireFounder(context);fields(await readJSON(request),[]);
  const pid=id(path[1]),uid=id(path[3]);await requireLiveContext(context,{founder:true});
  const {data:grant,error}=await context.supabase.from('nam_client_project_access').select('user_id,active').eq('workspace_id',context.workspaceId).eq('project_id',pid).eq('user_id',uid).maybeSingle();if(error)reviewFailure(error);if(!grant?.active)throw new ApiError(404,'This client invitation is not active.');
  const {data:contact,error:personError}=await context.supabase.from('nam_client_contacts').select('email').eq('workspace_id',context.workspaceId).eq('user_id',uid).maybeSingle();if(personError)reviewFailure(personError);if(!contact)throw new ApiError(404,'Client contact not found.');
  await requireLiveContext(context,{founder:true});const sent=await sendClientSignIn(contact.email,applicationOrigin(request));
  if(!sent)throw new ApiError(503,'Email delivery could not be confirmed. Ask the client to check their inbox before requesting another link.','EMAIL_NOT_CONFIRMED');
  return json({requested:true},202);
 }
 if(path[0]==='reviews'&&path.length===2){
  requireFounder(context);const qid=id(path[1]);
  if(method==='GET')return json(await reviewRPC(context,'nam_staff_review_detail',{qid}));
  if(method==='PATCH'){const input=await readJSON(request);fields(input,['expectedVersion','status']);if(!['closed','cancelled'].includes(String(input.status)))throw new ApiError(400,'Choose Close or Cancel for this review.');await requireLiveContext(context,{founder:true});return json(await reviewRPC(context,'nam_close_client_review',{qid,expected_version:revision(input.expectedVersion),next_status:input.status}));}
  throw new ApiError(405,'Method not allowed.');
 }
 return null;
}

type MediaDependencies={storage?:ReturnType<typeof clientProvider>['storage']};
export async function dispatchClientReviews(context:ClientContext,path:string[],request:Request,internal:MediaDependencies={}):Promise<Response|null>{
 const method=request.method;
 if(path.length===2&&path[0]==='client'&&path[1]==='reviews'&&method==='GET')return json({items:await reviewRPC(context,'nam_client_review_list',{})});
 if(path[0]!=='client'||path[1]!=='reviews'||path.length<3)return null;
 const qid=id(path[2]);
 if(path.length===3&&method==='GET')return json(await reviewRPC(context,'nam_client_review_detail',{qid}));
 if(path.length!==6||path[3]!=='items')return null;
 const iid=id(path[4]),action=path[5];
 if(action==='response'&&method==='POST'){
  const input=await readJSON(request);fields(input,['expectedVersion','decision','message']);
  if(!['accepted','rejected'].includes(String(input.decision)))throw new ApiError(400,'Choose Accept or Reject.');
  const body={decision:input.decision,message:inputText(input.message??'','Review comment',{max:5000,required:false})};
  await requireClientLive(context);return json(await reviewRPC(context,'nam_decide_client_review',{qid,iid,expected_version:revision(input.expectedVersion,true),payload:body,retry_key:key(request)}),201);
 }
 if(action==='content'&&method==='GET'){
  const query=new URL(request.url).searchParams,variant=query.get('variant')||'preview';if([...query.keys()].some(k=>k!=='variant')||!['preview','thumbnail','original'].includes(variant))throw new ApiError(400,'Choose a valid issued image variant.');
  await requireClientLive(context);const ticket=await reviewRPC(context,'nam_client_review_media',{qid,iid,variant});
  const storage=internal.storage||clientProvider(true).storage,{data,error}=await storage.from('nam-render-versions').download(ticket.path);
  if(error||!data)throw new ApiError(503,'The issued image could not load. Please retry.');
  if(data.size!==Number(ticket.size)||data.size>52428800)throw new ApiError(503,'The issued image could not be verified.');
  const bytes=Buffer.from(await data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==ticket.sha256)throw new ApiError(503,'The issued image could not be verified.');
  // Revocation/closure must be checked after a possibly slow private read.
  await requireClientLive(context);await reviewRPC(context,'nam_client_review_media',{qid,iid,variant});
  const file=encodeURIComponent(ticket.file_name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':ticket.mime,'Content-Length':String(bytes.length),'Content-Disposition':variant==='original'?"attachment; filename*=UTF-8''"+file:'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
 }
 return null;
}
export async function clientReviewEntry(request:Request,path:string[]):Promise<Response|null>{
 if(path[0]!=='client')return null;
 const publicResponse=await publicClientAuth(request,path);if(publicResponse)return publicResponse;
 const context=await getClientContext(request);
 if(!['GET','HEAD'].includes(request.method))assertClientMutation(context,request);
 const response=await dispatchClientReviews(context,path,request);if(response)return response;
 throw new ApiError(404,'This client review action is not available.');
}
