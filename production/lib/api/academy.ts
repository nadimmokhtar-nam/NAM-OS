import {type APIContext,ApiError,json,readJSON,requireFounder,fields,inputText} from './context';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREAS=new Set(['sales','3d','post_production']);
type DBError={code?:string;message?:string};
export type AcademyCourseSummary={id:string;course_id:string;publication_id:string;title:string;area:'sales'|'3d'|'post_production';summary:string;version:number;mandatory:boolean;published_at:string;total:number;completed:number;completion:Record<string,unknown>|null};
function identifier(value:unknown,name='Record'){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,`${name} identifier is invalid.`);return value;}
function positive(value:unknown,name:string){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw new ApiError(400,`${name} must be a positive whole number.`);return value;}
function optionalBoolean(body:Record<string,unknown>,key:string){if(key in body&&typeof body[key]!=='boolean')throw new ApiError(400,`${key} must be true or false.`);}
function dbFailure(error:DBError):never{
  if(error.code==='42501')throw new ApiError(403,'You do not have access to this Academy action.','ACADEMY_ACCESS_DENIED');
  if(error.code==='P0002')throw new ApiError(404,error.message||'The Academy record could not be found.','ACADEMY_NOT_FOUND');
  if(error.code==='40001')throw new ApiError(409,error.message||'This record changed elsewhere. Reload before saving.','ACADEMY_CONFLICT');
  if(error.code==='23505')throw new ApiError(409,'This record already exists. Reload the course before trying again.','ACADEMY_CONFLICT');
  if(error.code==='22023')throw new ApiError(400,error.message||'The Academy request is invalid.','ACADEMY_VALIDATION');
  if(error.code?.startsWith('22')||['23502','23503','23514'].includes(error.code||''))throw new ApiError(400,'The course fields, publication, learner or lesson order are invalid.','ACADEMY_VALIDATION');
  throw new ApiError(503,'Academy could not reach its saved records. Please retry.','ACADEMY_UNAVAILABLE');
}
async function rpc<T=unknown>(ctx:APIContext,name:string,args:Record<string,unknown>):Promise<T>{const {data,error}=await ctx.supabase.rpc(name,args);if(error)dbFailure(error);return data as T;}
function courseFields(body:Record<string,unknown>,create=false){
  if(create||'title' in body)body.title=inputText(body.title,'Course title',{max:200});
  if(create||'area' in body){if(typeof body.area!=='string'||!AREAS.has(body.area))throw new ApiError(400,'Choose Sales, 3D or Post-production.');}
  if('summary' in body)body.summary=inputText(body.summary,'Summary',{max:3000,required:false});
  optionalBoolean(body,'archived');
}
export async function listCourses(ctx:APIContext):Promise<AcademyCourseSummary[]>{return rpc<AcademyCourseSummary[]>(ctx,'nam_academy_list',{w:ctx.workspaceId});}
async function adminCommand(ctx:APIContext,op:string,courseId:string|null,body:Record<string,unknown>,requiresRevision=false){
  requireFounder(ctx);
  const changes={...body},revision=requiresRevision?positive(changes.expectedRevision,'Course revision'):null;
  delete changes.expectedRevision;
  return rpc(ctx,'nam_academy_admin',{w:ctx.workspaceId,op,p_course_id:courseId,expected_revision:revision,changes});
}
async function completions(ctx:APIContext,request:Request){
  const target=identifier(new URL(request.url).searchParams.get('member_id')||ctx.user.id,'Member');
  if(target!==ctx.user.id)requireFounder(ctx);
  const [{data:records,error:recordError},{data:events,error:eventError}]=await Promise.all([
    ctx.supabase.from('nam_course_completions').select('*').eq('workspace_id',ctx.workspaceId).eq('user_id',target).order('completed_at',{ascending:false}).limit(1000),
    ctx.supabase.from('nam_academy_completion_events').select('*').eq('workspace_id',ctx.workspaceId).eq('user_id',target).order('id',{ascending:false}).limit(1000)
  ]);
  if(recordError)dbFailure(recordError);if(eventError)dbFailure(eventError);
  return {records:(records||[]).map(row=>({...row,member_id:row.user_id})),events:(events||[]).map(row=>({...row,member_id:row.user_id})),limit:1000};
}

/** Paths are the catch-all API segments, without the leading /api. Caller
 * validates Origin + CSRF for every mutation before invoking this dispatcher. */
export async function dispatchAcademy(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
  const method=request.method;
  if(path[0]==='courses'){
    if(path.length===1){if(method!=='GET')throw new ApiError(405,'Method not allowed.');return json(await listCourses(ctx));}
    if(path.length===2){if(method!=='GET')throw new ApiError(405,'Method not allowed.');return json(await rpc(ctx,'nam_academy_course',{w:ctx.workspaceId,c_id:identifier(path[1],'Course')}));}
    return null;
  }
  if(path[0]==='lessons'&&path.length===3&&['complete','progress'].includes(path[2])){
    if(method!=='POST')throw new ApiError(405,'Method not allowed.');
    const lessonId=identifier(path[1],'Lesson'),body=await readJSON(request);
    fields(body,path[2]==='complete'?[]:['completed','course_id','course_version']);
    if(path[2]==='progress'&&typeof body.completed!=='boolean')throw new ApiError(400,'Choose a valid lesson completion state.');
    // Optional view guards cannot move progress to another course/version.
    if('course_id' in body||'course_version' in body){
      if('course_id' in body)identifier(body.course_id,'Course');if('course_version' in body)positive(body.course_version,'Publication version');
      const {data:lesson,error:lessonError}=await ctx.supabase.from('nam_lessons').select('course_version_id').eq('workspace_id',ctx.workspaceId).eq('id',lessonId).maybeSingle();if(lessonError)dbFailure(lessonError);if(!lesson)throw new ApiError(404,'Lesson not found.');
      const {data:version,error:versionError}=await ctx.supabase.from('nam_course_versions').select('course_id,version').eq('workspace_id',ctx.workspaceId).eq('id',lesson.course_version_id).maybeSingle();if(versionError)dbFailure(versionError);
      if(!version||('course_id' in body&&body.course_id!==version.course_id)||('course_version' in body&&body.course_version!==version.version))throw new ApiError(404,'Lesson not found in this course publication.');
    }
    return json(await rpc(ctx,'nam_academy_progress',{w:ctx.workspaceId,l_id:lessonId,mark_complete:path[2]==='complete'?true:body.completed}));
  }
  if(path[0]!=='academy')return null;
  if(path[1]==='resources'&&path.length===4&&path[3]==='download'){
    if(method!=='GET')throw new ApiError(405,'Method not allowed.');
    const resourceId=identifier(path[2],'Resource');
    const published=await ctx.supabase.from('nam_course_version_resources').select('id,title,body').eq('workspace_id',ctx.workspaceId).eq('id',resourceId).maybeSingle();
    if(published.error)dbFailure(published.error);let resource=published.data;
    if(!resource&&ctx.actor.role==='founder'){
      requireFounder(ctx);const draft=await ctx.supabase.from('nam_course_resources').select('id,title,body').eq('workspace_id',ctx.workspaceId).eq('id',resourceId).maybeSingle();if(draft.error)dbFailure(draft.error);resource=draft.data;
    }
    if(!resource)throw new ApiError(404,'This text resource is not available in your assigned course publication.');
    const filename=String(resource.title).replace(/[\x00-\x1f\x7f/\\]/g,'-').trim().slice(0,200)+'.txt',bytes=new TextEncoder().encode(resource.body);
    return new Response(bytes,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Length':String(bytes.byteLength),'Content-Disposition':`attachment; filename="nam-resource.txt"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
  }
  if(path[1]==='completions'&&path.length===2){if(method!=='GET')throw new ApiError(405,'Method not allowed.');return json(await completions(ctx,request));}
  if(path[1]==='assignments'&&path.length===4&&path[3]==='submit'){
    if(method!=='POST')throw new ApiError(405,'Method not allowed.');const body=await readJSON(request,100000);fields(body,['body','expectedRevision']);
    const expected=body.expectedRevision===undefined||body.expectedRevision===0?null:positive(body.expectedRevision,'Response revision');
    return json(await rpc(ctx,'nam_academy_submit',{w:ctx.workspaceId,a_id:identifier(path[2],'Assignment'),expected_revision:expected,response_body:inputText(body.body,'Written response',{max:20000})}));
  }
  if(path[1]==='submissions'&&path.length===3){
    requireFounder(ctx);if(method!=='GET')throw new ApiError(405,'Method not allowed.');
    const submission=await ctx.supabase.from('nam_academy_submissions').select('id,assignment_id,user_id,body,status,revision,submitted_at,feedback').eq('workspace_id',ctx.workspaceId).eq('id',identifier(path[2],'Submission')).maybeSingle();
    if(submission.error)dbFailure(submission.error);if(!submission.data)throw new ApiError(404,'This practical response is not available.');
    const assignment=await ctx.supabase.from('nam_academy_assignments').select('title,instructions').eq('workspace_id',ctx.workspaceId).eq('id',submission.data.assignment_id).maybeSingle();
    if(assignment.error)dbFailure(assignment.error);if(!assignment.data)throw new ApiError(404,'This practical assignment is not available.');
    const response=submission.data;return json({...response,title:assignment.data.title,instructions:assignment.data.instructions,owner_name:ctx.members.find(member=>member.id===response.user_id)?.name||'Studio member'});
  }
  if(path[1]==='submissions'&&path.length===4&&path[3]==='review'){
    requireFounder(ctx);if(method!=='POST')throw new ApiError(405,'Method not allowed.');const body=await readJSON(request);fields(body,['expectedRevision','status','feedback']);
    if(!['approved','changes_requested'].includes(String(body.status)))throw new ApiError(400,'Choose approved or changes requested.');
    return json(await rpc(ctx,'nam_academy_review',{w:ctx.workspaceId,s_id:identifier(path[2],'Submission'),expected_revision:positive(body.expectedRevision,'Response revision'),review_status:body.status,review_feedback:inputText(body.feedback??'','Feedback',{required:body.status==='changes_requested',max:5000})}));
  }
  if(path[1]!=='admin'||path[2]!=='courses')return null;
  requireFounder(ctx);
  if(path.length===3){
    if(method==='GET')return json(await rpc(ctx,'nam_academy_catalog',{w:ctx.workspaceId}));
    if(method==='POST'){const body=await readJSON(request);fields(body,['title','area','summary']);courseFields(body,true);return json(await adminCommand(ctx,'create',null,body),201);}
    throw new ApiError(405,'Method not allowed.');
  }
  const courseId=identifier(path[3],'Course');
  if(path.length===4){
    if(method==='GET')return json(await rpc(ctx,'nam_academy_admin_course',{w:ctx.workspaceId,c_id:courseId}));
    if(method==='PATCH'){const body=await readJSON(request);fields(body,['expectedRevision','title','area','summary','archived']);courseFields(body);return json(await adminCommand(ctx,'edit',courseId,body,true));}
    if(method==='DELETE'){const body=await readJSON(request);fields(body,['expectedRevision']);return json(await adminCommand(ctx,'delete',courseId,body,true));}
    throw new ApiError(405,'Method not allowed.');
  }
  if(path.length!==5)return null;
  const action=path[4];
  if(['modules','remove-module','reorder-modules','assign-module','resources','remove-resource'].includes(action)){
    if(method!=='POST')throw new ApiError(405,'Method not allowed.');
    const body=await readJSON(request,action==='resources'?220000:40000),allowed:Record<string,string[]>={modules:['expectedRevision','id','title'],'remove-module':['expectedRevision','id'],'reorder-modules':['expectedRevision','module_ids'],'assign-module':['expectedRevision','lesson_id','module_id'],resources:['expectedRevision','id','title','body','lesson_id'],'remove-resource':['expectedRevision','id']};
    fields(body,allowed[action]);const revision=positive(body.expectedRevision,'Course revision');delete body.expectedRevision;
    if('id' in body)identifier(body.id,'Record');
    if(action==='modules')body.title=inputText(body.title,'Module title',{max:200});
    if(action==='remove-module'||action==='remove-resource')identifier(body.id,'Record');
    if(action==='reorder-modules'){if(!Array.isArray(body.module_ids)||body.module_ids.length>100)throw new ApiError(400,'Supply an ordered list of up to 100 module IDs.');for(const id of body.module_ids)identifier(id,'Module');if(new Set(body.module_ids).size!==body.module_ids.length)throw new ApiError(400,'Supply each module exactly once.');}
    if(action==='assign-module'){identifier(body.lesson_id,'Lesson');if(body.module_id!==null&&body.module_id!=='')identifier(body.module_id,'Module');else body.module_id=null;}
    if(action==='resources'){body.title=inputText(body.title,'Text resource title',{max:200});body.body=inputText(body.body,'Text resource content',{max:50000});if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.body as string))throw new ApiError(400,'Written resources cannot contain binary control characters.');if('lesson_id' in body){if(body.lesson_id!==null&&body.lesson_id!=='')identifier(body.lesson_id,'Lesson');else body.lesson_id=null;}}
    const op=action==='modules'?'module':action==='resources'?'resource':action;
    return json(await rpc(ctx,'nam_academy_structure',{w:ctx.workspaceId,c_id:courseId,op,expected_revision:revision,changes:body}));
  }
  if(!['lessons','remove-lesson','reorder','publish','enroll','revoke','assignments'].includes(action))return null;
  if(method!=='POST')throw new ApiError(405,'Method not allowed.');
  const body=await readJSON(request,action==='lessons'?220000:100000);
  if(action==='lessons'){
    fields(body,['expectedRevision','id','title','body','position']);if('id' in body)identifier(body.id,'Lesson');body.title=inputText(body.title,'Lesson title',{max:200});body.body=inputText(body.body,'Written lesson',{max:50000});if('position' in body)positive(body.position,'Lesson position');
    return json(await adminCommand(ctx,'lesson',courseId,body,true));
  }
  if(action==='remove-lesson'){fields(body,['expectedRevision','id']);identifier(body.id,'Lesson');return json(await adminCommand(ctx,action,courseId,body,true));}
  if(action==='reorder'){fields(body,['expectedRevision','lesson_ids']);if(!Array.isArray(body.lesson_ids)||body.lesson_ids.length>1000)throw new ApiError(400,'Supply an ordered list of up to 1000 lesson IDs.');for(const id of body.lesson_ids)identifier(id,'Lesson');if(new Set(body.lesson_ids).size!==body.lesson_ids.length)throw new ApiError(400,'Supply each lesson exactly once.');return json(await adminCommand(ctx,action,courseId,body,true));}
  if(action==='publish'){fields(body,['expectedRevision']);return json(await adminCommand(ctx,action,courseId,body,true));}
  if(action==='enroll'){fields(body,['member_id','mandatory','course_version']);identifier(body.member_id,'Member');optionalBoolean(body,'mandatory');if('course_version' in body)positive(body.course_version,'Publication version');return json(await adminCommand(ctx,action,courseId,body));}
  if(action==='revoke'){fields(body,['member_id']);identifier(body.member_id,'Member');return json(await adminCommand(ctx,action,courseId,body));}
  fields(body,['course_version','title','instructions']);if('course_version' in body)positive(body.course_version,'Publication version');body.title=inputText(body.title,'Assignment title',{max:200});body.instructions=inputText(body.instructions,'Assignment instructions',{max:20000});return json(await adminCommand(ctx,'assignments',courseId,body),201);
}
