import {type APIContext,ApiError,json,readJSON,requireFounder,fields,inputText} from './context';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPICS=new Set(['interior','exterior','lighting_composition','materials_texturing','post_production','ai_workflows','nam_standards_sops','onboarding']);
type DBError={code?:string;message?:string};
function identifier(value:unknown,label:string){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,`${label} identifier is invalid.`,'LEARNING_PATH_VALIDATION');return value;}
function revision(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw new ApiError(400,'Reload the saved revision before making this change.','LEARNING_PATH_VALIDATION');return value;}
function topics(value:unknown){if(!Array.isArray(value)||value.length>8||new Set(value).size!==value.length||value.some(topic=>typeof topic!=='string'||!TOPICS.has(topic)))throw new ApiError(400,'Choose each Academy subject once.','LEARNING_PATH_VALIDATION');return value;}
function page(request:Request){const params=new URL(request.url).searchParams;for(const key of params.keys())if(!['page_size','offset'].includes(key)||params.getAll(key).length!==1)throw new ApiError(400,'Unsupported learning path page.');const number=(key:string,fallback:number,max:number,min=0)=>{const raw=params.get(key);if(raw===null)return fallback;if(!/^\d+$/.test(raw))throw new ApiError(400,'Choose a valid learning path page.');const value=Number(raw);if(!Number.isSafeInteger(value)||value<min||value>max)throw new ApiError(400,'Choose a valid learning path page.');return value;};return {page_size:number('page_size',50,100,1),page_offset:number('offset',0,100000)};}
function failure(error:DBError):never{
 if(error.code==='42501')throw new ApiError(403,'Current Academy access is required for this action.','LEARNING_PATH_ACCESS_DENIED');
 if(error.code==='P0002')throw new ApiError(404,error.message||'This learning path is unavailable.','LEARNING_PATH_NOT_FOUND');
 if(['40001','23505','40P01'].includes(error.code||''))throw new ApiError(409,error.code==='40P01'?'Another Academy change was saving. Retry this request.':error.message||'This learning path changed. Reload before saving.','LEARNING_PATH_CONFLICT');
 if(error.code==='22023')throw new ApiError(400,error.message||'The learning path fields are invalid.','LEARNING_PATH_VALIDATION');
 if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'The subjects, course publications or learner are invalid.','LEARNING_PATH_VALIDATION');
 throw new ApiError(503,'Academy could not reach its saved learning paths. Retry with the same request.','LEARNING_PATH_UNAVAILABLE');
}
async function rpc(ctx:APIContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.supabase.rpc(name,args);if(error)failure(error);return data;}
function definition(body:Record<string,unknown>){body.title=inputText(body.title,'Path title',{max:200});body.summary=inputText(body.summary??'','Path summary',{required:false,max:3000});body.topics=topics(body.topics);if(!Array.isArray(body.courses)||body.courses.length>100)throw new ApiError(400,'Choose up to 100 published courses.');const seen=new Set<string>();for(const item of body.courses){if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError(400,'Choose an exact course publication.');fields(item,['course_id','publication_id']);const id=identifier(item.course_id,'Course');identifier(item.publication_id,'Publication');if(seen.has(id))throw new ApiError(400,'Include each course once in a learning path.');seen.add(id);}}
async function command(ctx:APIContext,op:string,id:string,body:Record<string,unknown>,create=false){const expected=create?null:revision(body.expectedRevision),key=identifier(body.command_key,'Request'),changes={...body};delete changes.command_key;delete changes.expectedRevision;delete changes.id;return rpc(ctx,'nam_learning_path_command',{w:ctx.workspaceId,op,p_id:id,expected_revision:expected,changes,command_key:key});}

/** Call after getContext and the shared Origin/CSRF mutation gate. Every RPC
 * independently rechecks current membership, managed session and elected MFA. */
export async function dispatchLearningPaths(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path[0]!=='academy')return null;
 const method=request.method;
 if(path[1]==='topics'&&path.length===2){if(method!=='GET')throw new ApiError(405,'Method not allowed.');return json(await rpc(ctx,'nam_academy_topics_list',{w:ctx.workspaceId}));}
 const admin=path[1]==='admin',segment=admin?2:1;
 if(admin&&path[2]==='path-courses'&&path.length===3){requireFounder(ctx);if(method!=='GET')throw new ApiError(405,'Method not allowed.');return json(await rpc(ctx,'nam_learning_path_catalog',{w:ctx.workspaceId,...page(request)}));}
 if(admin&&path[2]==='path-courses'&&path.length===5&&path[4]==='publications'){requireFounder(ctx);if(method!=='GET')throw new ApiError(405,'Method not allowed.');return json(await rpc(ctx,'nam_learning_path_publications',{w:ctx.workspaceId,c_id:identifier(path[3],'Course'),...page(request)}));}
 if(admin&&path[2]==='course-topics'&&path.length===4){requireFounder(ctx);if(method!=='PATCH')throw new ApiError(405,'Method not allowed.');const body=await readJSON(request);fields(body,['expectedRevision','command_key','topics']);body.topics=topics(body.topics);return json(await command(ctx,'classify',identifier(path[3],'Course'),body));}
 if(path[segment]!=='paths')return null;
 if(admin)requireFounder(ctx);
 const base=segment+1;
 if(path.length===base){
  if(method==='GET')return json(await rpc(ctx,'nam_learning_paths_list',{w:ctx.workspaceId,admin_view:admin,...page(request)}));
  if(admin&&method==='POST'){const body=await readJSON(request,50000);fields(body,['id','command_key','title','summary','topics','courses']);const id=identifier(body.id,'Path');definition(body);return json(await command(ctx,'create',id,body,true),201);}
  throw new ApiError(405,'Method not allowed.');
 }
 const id=identifier(path[base],admin?'Path':'Assignment');
 if(path.length===base+1){
  if(method==='GET'){const pagination=page(request);if(new URL(request.url).searchParams.has('page_size'))throw new ApiError(400,'Assignment pages contain up to 50 learners.');return json(await rpc(ctx,'nam_learning_path_read',{w:ctx.workspaceId,p_id:id,admin_view:admin,page_offset:pagination.page_offset}));}
  if(admin&&method==='PATCH'){const body=await readJSON(request,50000);fields(body,['expectedRevision','command_key','title','summary','topics','courses']);definition(body);return json(await command(ctx,'edit',id,body));}
  throw new ApiError(405,'Method not allowed.');
 }
 if(!admin||path.length!==base+2||!['assign','revoke','archive'].includes(path[base+1]))return null;
 if(method!=='POST')throw new ApiError(405,'Method not allowed.');
 const action=path[base+1],body=await readJSON(request);fields(body,['expectedRevision','command_key',...(action==='assign'?['member_id','mandatory']:action==='revoke'?['assignment_id']:['archived'])]);
 if(action==='assign'){identifier(body.member_id,'Member');if('mandatory'in body&&typeof body.mandatory!=='boolean')throw new ApiError(400,'Choose whether this path is required.');}
 if(action==='revoke')identifier(body.assignment_id,'Assignment');
 if(action==='archive'&&typeof body.archived!=='boolean')throw new ApiError(400,'Choose an archive state.');
 return json(await command(ctx,action,id,body));
}
