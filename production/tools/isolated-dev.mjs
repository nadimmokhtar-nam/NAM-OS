#!/usr/bin/env node
// Disposable local provider checks. Never reads a linked hosted project and
// never prints keys, passwords, cookies or the private generated profiles.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import ts from 'typescript';

const app=fileURLToPath(new URL('../',import.meta.url));
const qaRoot=process.env.NAM_QA_ROOT||'/workspace/.cache/nam-os/isolated';
const home=process.env.NAM_QA_CLI_HOME||'/workspace/.cache/nam-os/supabase-home';
const cli=process.env.NAM_QA_CLI||'/workspace/.cache/nam-os/tools/node_modules/.bin/supabase';
const workspace='f1000000-0000-4000-8000-000000000001';
const privatePath=resolve(qaRoot,'profiles.json');
const runtimePath=resolve(qaRoot,'runtime.json');
const command=process.argv[2]||'prepare';
const localHost=url=>['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
function check(value,message){if(!value)throw Error(message);}
async function privateJSON(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
function sqlLiteral(value){return "'"+String(value).replaceAll("'","''")+"'";}
function psql(sql){const result=spawnSync('docker',['--host=unix:///var/run/docker.sock','exec','-i','supabase_db_nam-os-qa','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:sql,encoding:'utf8',maxBuffer:4*1024*1024});check(result.status===0,'The isolated PostgreSQL seed failed. Inspect local container diagnostics; no hosted database was contacted.');}
async function rpc(client,name,args){const {data,error}=await client.rpc(name,args);check(!error,`Isolated ${name} failed (${error?.code||'transport'}).`);return data;}
async function localConfiguration(){
 const path=resolve(qaRoot,'supabase/config.jsonc'),parsed=ts.parseConfigFileTextToJson(path,await readFile(path,'utf8'));
 check(!parsed.error&&parsed.config.project_id==='nam-os-qa','Refusing a non-QA Supabase configuration. Expected the disposable nam-os-qa stack.');
 check(!parsed.config.remotes,'Refusing a linked/remote Supabase configuration.');
 const result=spawnSync(cli,['status','--workdir',qaRoot,'--output','json'],{env:{...process.env,SUPABASE_HOME:home,SUPABASE_TELEMETRY_DISABLED:'1',DOCKER_HOST:'unix:///var/run/docker.sock'},encoding:'utf8',maxBuffer:4*1024*1024});
 await writeFile(resolve(qaRoot,'status-private.json'),result.stdout||'',{mode:0o600});
 check(result.status===0,'The isolated Supabase stack is not ready. Its status output was kept private.');
 const status=JSON.parse(result.stdout),url=status.API_URL||status.SUPABASE_URL,publicKey=status.ANON_KEY||status.PUBLISHABLE_KEY,serviceKey=status.SERVICE_ROLE_KEY||status.SECRET_KEY;
 check(url&&localHost(url)&&publicKey&&serviceKey,'The isolated provider must expose loopback API bindings. No hosted fallback is allowed.');
 return {url,publicKey,serviceKey};
}
async function prepare(){
 await mkdir(qaRoot,{recursive:true});const config=await localConfiguration();
 const admin=createClient(config.url,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 let profiles;
 try{const info=await stat(privatePath);check((info.mode&0o077)===0,'Private QA profiles must have mode 0600.');profiles=JSON.parse(await readFile(privatePath,'utf8'));check(profiles.origin===config.url&&profiles.workspace===workspace,'Existing private profiles belong to a different test stack.');}catch(error){if(error.code!=='ENOENT')throw error;profiles={origin:config.url,workspace,users:[],records:{}};}
 const roles=[['founder','QA Founder','founder'],['sales_manager','QA Sales Manager','sales_manager'],['sales_1','QA Omar','sales'],['sales_2','QA Sales Two','sales'],['production_manager','QA Production Lead','production_manager'],['artist_1','QA Interior Artist','artist'],['artist_2','QA Exterior Artist','artist'],['freelancer','QA Freelancer','freelancer']];
 const {data:existing,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000});check(!listError,'Isolated Auth account enumeration failed.');
 for(const [key,name,role] of roles){
  const email=key+'@nam-qa.invalid';let user=profiles.users.find(u=>u.key===key),found=existing.users.find(u=>u.email===email);
  if(!user){check(!found,'An existing synthetic account has no matching private QA profile. Preserve it and inspect the local setup.');user={key,name,role,email,password:'Nam-QA-'+randomBytes(24).toString('base64url')};const {data,error}=await admin.auth.admin.createUser({email,password:user.password,email_confirm:true});check(!error&&data.user?.id,'Isolated Auth account creation failed.');user.id=data.user.id;profiles.users.push(user);await privateJSON(privatePath,profiles);}
  else check(found?.id===user.id,'The isolated Auth account/profile no longer matches. No account was reset.');
 }
 psql(`insert into public.nam_workspaces(id,name) values(${sqlLiteral(workspace)},'NAM OS — disposable isolated QA') on conflict(id) do nothing;\n`+
  profiles.users.map(u=>`insert into public.nam_memberships(workspace_id,user_id,name,role) values(${sqlLiteral(workspace)},${sqlLiteral(u.id)},${sqlLiteral(u.name)},${sqlLiteral(u.role)}) on conflict(workspace_id,user_id) do nothing;\n`+
   (u.role==='founder'?'':`insert into public.nam_section_grants(workspace_id,user_id,section,can_create) select ${sqlLiteral(workspace)}::uuid,${sqlLiteral(u.id)}::uuid,section,true from unnest(public.nam_template_sections(${sqlLiteral(u.role)})) section on conflict do nothing;\n`)).join(''));
 const founder=profiles.users.find(u=>u.key==='founder'),actor=createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false}}),login=await actor.auth.signInWithPassword({email:founder.email,password:founder.password});check(!login.error,'Isolated password-only Founder sign-in failed.');
 const artists=profiles.users.filter(u=>['artist','freelancer','production_manager'].includes(u.role));
 const project=await rpc(actor,'nam_save_project',{w:workspace,pid:null,expected_version:null,retry_key:'qa-courtyard-project-01',changes:{title:'Courtyard residence',brief:'A quiet, light-filled residence. Build the story around natural materials, balanced daylight and generous negative space. Use the reference folder to agree camera positions before modelling.',outcome:'Internally reviewed images at the agreed composition and resolution, with client feedback resolved and delivery files checked.',lead_id:artists.find(u=>u.role==='production_manager').id,member_ids:artists.map(u=>u.id),due_date:'2026-12-04'}});
 profiles.records.project=project;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=name=>parts.find(p=>p.type===name).value,today=part('year')+'-'+part('month')+'-'+part('day');
 const shift=days=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
 const tasks=[
  ['artist_1','Interior 01 / Living room','Lighting','In progress',0,'High'],['artist_2','Exterior 01 / Courtyard','Internal review','In progress',0,'High'],['freelancer','Interior 02 / Joinery detail','Modelling','Blocked',-1,'Normal'],['production_manager','Check cameras against the brief','Brief','Todo',1,'High'],
  ['sales_1','Follow up / hospitality proposal',null,'Todo',0,'High'],['sales_2','Prepare discovery meeting notes',null,'In progress',1,'Normal'],['sales_manager','Review the weekly outreach plan',null,'Todo',2,'Normal'],['founder','Resolve the courtyard material direction',null,'Todo',0,'Urgent'],
 ];
 profiles.records.tasks=[];
 for(const [key,title,stage,status,days,priority] of tasks){const user=profiles.users.find(u=>u.key===key),production=!!stage;const task=await rpc(actor,'nam_create_task',{w:workspace,retry_key:'qa-task-'+key+'-'+today,changes:{title,section:production?'projects':key==='founder'?'team':'sales',owner_id:user.id,status,priority,due_date:shift(days),description:production?'Check the approved camera, balance daylight and materials, then submit the image for an internal review. Keep decisions and feedback in this task.':'Keep the next action, owner and date clear. Use the CRM for the underlying opportunity.',...(production?{project_id:project,production_stage:stage}:{})}});profiles.records.tasks.push(task.id);}
 let courses=await rpc(actor,'nam_academy_catalog',{w:workspace}),course=courses.find(c=>c.title==='The NAM image / Light and composition');
 if(!course){course=await rpc(actor,'nam_academy_admin',{w:workspace,op:'create',p_course_id:null,expected_revision:null,changes:{title:'The NAM image / Light and composition',area:'3d',summary:'A deliberate sequence for reading the brief, composing the frame and judging the first render.'}});for(const [title,body] of [['Read the image before the scene','Start with the architectural idea. Identify the subject, establish the camera and describe the light before adding detail. The first image should make the intent obvious.'],['Build a light hierarchy','Begin with daylight. Add practical light only when it helps the image. Compare the brightest surface, the subject and the shadows at a small scale before refining materials.'],['Review with a clear next action','Inspect framing, verticals, material scale and edge quality. Describe the issue and the intended result. Keep actionable feedback in the deliverable’s checklist; use the discussion for decisions.']])course=await rpc(actor,'nam_academy_admin',{w:workspace,op:'lesson',p_course_id:course.id,expected_revision:course.revision,changes:{title,body}});course=await rpc(actor,'nam_academy_admin',{w:workspace,op:'publish',p_course_id:course.id,expected_revision:course.revision,changes:{}});}
 course=await rpc(actor,'nam_academy_admin_course',{w:workspace,c_id:course.id});profiles.records.course=course.id;
 for(const user of profiles.users)if(!course.enrollments.some(e=>e.member_id===user.id))course=await rpc(actor,'nam_academy_admin',{w:workspace,op:'enroll',p_course_id:course.id,expected_revision:course.revision,changes:{member_id:user.id,course_version:course.version,mandatory:true}});
 await actor.auth.signOut();await privateJSON(privatePath,profiles);
 let runtime;try{runtime=JSON.parse(await readFile(runtimePath,'utf8'));check(runtime.NAM_WORKSPACE_ID===workspace,'Existing runtime belongs to another workspace.');}catch(error){if(error.code!=='ENOENT')throw error;runtime={NAM_CSRF_SECRET:randomBytes(32).toString('hex')};}
 runtime={...runtime,NEXT_PUBLIC_SUPABASE_URL:config.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.publicKey,SUPABASE_SERVICE_ROLE_KEY:config.serviceKey,NAM_APP_ORIGIN:'http://localhost:3100',NAM_WORKSPACE_ID:workspace,NEXT_TELEMETRY_DISABLED:'1'};
 await privateJSON(runtimePath,runtime);console.log('Prepared eight isolated Auth identities, a real project, shared tasks and assigned Academy content. Private profiles and runtime bindings saved outside the checkout.');
}
async function start(){const runtime=JSON.parse(await readFile(runtimePath,'utf8'));check(localHost(runtime.NEXT_PUBLIC_SUPABASE_URL)&&runtime.NAM_WORKSPACE_ID===workspace&&runtime.NAM_APP_ORIGIN==='http://localhost:3100','Refusing a non-isolated app runtime.');const production=process.argv.includes('--production');const child=spawn('npm',production?['start','--','--hostname','0.0.0.0','--port','3100']:['--ignore-scripts','run','dev','--','--webpack','--hostname','0.0.0.0','--port','3100'],{cwd:app,env:{...process.env,...runtime},stdio:'inherit'});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??1));}
try{if(command==='prepare')await prepare();else if(command==='start')await start();else if(command==='status'){await localConfiguration();console.log('Isolated local provider bindings are available.');}else throw Error('Use prepare, start [--production] or status.');}catch(error){console.error(error.message);process.exitCode=1;}
