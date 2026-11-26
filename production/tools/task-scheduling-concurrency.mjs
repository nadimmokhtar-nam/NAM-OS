#!/usr/bin/env node
// Independent native PostgreSQL backends. Public output contains bounded enums
// only; SQL, process diagnostics and claims stay in an owner-only QA log.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {readFile,readdir,mkdir,chmod,open} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const dockerContainer='supabase_db_nam-os-qa';
export const dockerSocket='unix:///var/run/docker.sock';
const databasePattern=/^nam_scheduling_qa_[0-9a-f]{24}$/;
const operations=new Set(['configuration','create_database','empty_database','initialize','migrations','fixtures','reciprocal_dependencies','duplicate_completion','queued_session_revocation','queued_task_mfa','queued_command_mfa','cleanup','complete']);
const failureTypes=new Set(['configuration','process','timeout','assertion','filesystem','unknown']);
const transports=new Set(['socket','auth','permission','docker','psql','timeout']);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const fail=type=>Object.assign(new Error(type),{failureType:type});
export function boundedOutcome(status,operation,error){
 const result={status:status==='pass'?'pass':status==='skip'?'skip':'fail',operation:operations.has(operation)?operation:'configuration'};
 if(result.status==='fail'){
  if(/^[A-Z0-9]{5}$/.test(error?.sqlstate||''))result.sqlstate=error.sqlstate;
  else result.failureType=failureTypes.has(error?.failureType)?error.failureType:error?.code==='ERR_ASSERTION'?'assertion':['EACCES','ENOENT','EPERM'].includes(error?.code)?'filesystem':'unknown';
  if(transports.has(error?.transport))result.transport=error.transport;
 }
 return result;
}
// Inspect private diagnostics, but return literal categories only. Never return
// captured paths, account names, connection strings, SQL or process arguments.
export function classifyTransportFailure({mode,diagnostics='',timedOut=false,spawnCode}={}){
 if(timedOut||/timed? out|timeout expired|statement timeout|lock timeout/i.test(diagnostics))return 'timeout';
 if(mode==='docker'&&(spawnCode==='ENOENT'||/docker daemon|error response from daemon|cannot connect to.*docker|no such container|container .* is not running|OCI runtime|unable to upgrade to tcp|unable to start container process|error during connect/i.test(diagnostics)))return 'docker';
 if(/authentication failed|no password supplied|password is required|pg_hba\.conf|role .* does not exist/i.test(diagnostics))return 'auth';
 if(['EACCES','EPERM'].includes(spawnCode)||/permission denied|must be (?:a member|owner|superuser)|not permitted/i.test(diagnostics))return 'permission';
 if(/connection to server on socket|unix.domain socket|could not connect to server|connection refused|could not translate host name/i.test(diagnostics))return 'socket';
 return 'psql';
}
export function validateManualTarget(target){
 let address;try{address=new URL(target);}catch{throw fail('configuration');}
 if(!['postgres:','postgresql:'].includes(address.protocol)||!['127.0.0.1','localhost','[::1]'].includes(address.hostname)||!address.pathname.slice(1)||address.hash||!Array.from(address.searchParams.keys()).every(key=>['sslmode','connect_timeout','application_name'].includes(key)))throw fail('configuration');
 return address;
}
export function psqlInvocation({mode,target,database,name='nam-scheduling-test'}){
 if(!/^nam-scheduling-[a-z0-9-]{1,64}$/.test(name))throw fail('configuration');
 const flags=['--no-psqlrc','--no-password','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','--tuples-only','--no-align','--quiet'];
 // Prevent libpq service/host overrides and Docker context selection inherited
 // from the operator's shell. The URL remains private and is never logged here.
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('PG')||key.startsWith('DOCKER_'))delete env[key];
 env.PGAPPNAME=name;env.PGCONNECT_TIMEOUT='5';env.PGOPTIONS='-c statement_timeout=20000 -c lock_timeout=15000';
 if(mode==='docker'){
  if(database!=='postgres'&&!databasePattern.test(database||''))throw fail('configuration');
  // An empty PGSERVICE still requests a service in libpq. Truly unset all
  // host/service overrides inside the container before using its compiled
  // local UNIX socket defaults, as the working isolated seed helper does.
  return {binary:'docker',args:['--host='+dockerSocket,'exec','-i','--env','PGAPPNAME='+name,'--env','PGCONNECT_TIMEOUT=5','--env','PGOPTIONS='+env.PGOPTIONS,dockerContainer,'env','-u','PGHOST','-u','PGHOSTADDR','-u','PGPORT','-u','PGSERVICE','-u','PGSERVICEFILE','psql',...flags,'--username','postgres','--dbname',database],env};
 }
 if(mode!=='manual')throw fail('configuration');
 const address=validateManualTarget(target);address.searchParams.set('application_name',name);
 return {binary:'psql',args:[...flags,'--dbname',address.toString()],env};
}
export async function privateDiagnostics(qaRoot){
 const root=resolve(qaRoot);await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
 const directory=resolve(root,'scheduling-concurrency');await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 return open(resolve(directory,'run-'+randomBytes(12).toString('hex')+'.log'),'wx',0o600);
}
function driver(options,log){
 const sessions=new Set();
 function session(source,{name='nam-scheduling-test',hold=false}={}){
  const invocation=psqlInvocation({...options,name});
  const child=spawn(invocation.binary,invocation.args,{env:invocation.env,stdio:['pipe','pipe','pipe']});
  sessions.add(child);let output='',errors='',timedOut=false;
  const raw=[];
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{output+=chunk;raw.push(chunk);});child.stderr.on('data',chunk=>{errors+=chunk;raw.push(chunk);});
  // Keep process/transport errors private, including EPIPE during cleanup.
  child.stdin.on('error',error=>raw.push(error.stack||String(error)));
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},30000);timer.unref();
  const done=new Promise((resolveResult,reject)=>{
   let spawnError;child.once('error',error=>{spawnError=error;raw.push(error.stack||String(error));});
   child.once('close',async code=>{
    clearTimeout(timer);sessions.delete(child);
    try{await log.write('\n['+name+']\n'+raw.join('')+'\n');}catch(error){reject(error);return;}
    if(code===0&&!spawnError&&!timedOut)resolveResult(output.trim());
    else {const error=fail(timedOut?'timeout':'process');error.sqlstate=errors.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/)?.[1];error.transport=classifyTransportFailure({mode:options.mode,diagnostics:errors+'\n'+output,timedOut,spawnCode:spawnError?.code});error.privateMessage=errors;reject(error);}
   });
  });done.catch(()=>{});
  child.stdin.write(source+'\n');if(!hold)child.stdin.end();
  return {child,done,output:()=>output,stop(){child.stdin.end('rollback;\n');child.kill();}};
 }
 return {session,sql:source=>session(source).done,close(){for(const child of sessions){child.stdin.end('rollback;\n');child.kill();}}};
}
export async function withDisposableDatabase(admin,proof,{onOperation=()=>{},makeName=()=> 'nam_scheduling_qa_'+randomBytes(12).toString('hex')}={}){
 const database=makeName();if(!databasePattern.test(database))throw fail('configuration');
 let created=false,result,error;
 try{
  onOperation('create_database');await admin(`create database "${database}" template template0;`);created=true;
  result=await proof(database);
 }catch(caught){error=caught;}
 finally{
  if(created){
   onOperation('cleanup');
   try{await admin(`drop database "${database}" with (force);`);}catch(caught){error=Object.assign(caught,{operation:'cleanup'});}
  }
 }
 if(error)throw error;return result;
}
async function until(predicate){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){if(await predicate())return;await new Promise(done=>setTimeout(done,30));}
 throw fail('timeout');
}
const mockSchemas=`begin;
 do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end$$;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
 create table auth.mfa_factors(id uuid primary key,user_id uuid not null references auth.users(id),status text not null);
 create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role',current_user::text)$$;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt(),auth.role() to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select on storage.buckets to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;commit;`;
export async function requireEmptyDatabase(sql){
 const objects=await sql("select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema')+(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema')+(select count(*) from pg_namespace n where n.nspname not like 'pg_%' and n.nspname not in ('public','information_schema'))");
 assert.equal(objects,'0');
}
async function prove(database,onOperation){
 const {sql,session}=database;
 onOperation('empty_database');await requireEmptyDatabase(sql);
 onOperation('initialize');await sql(mockSchemas);
 onOperation('migrations');
 const directory=new URL('../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort())await sql(await readFile(new URL(file,directory),'utf8'));
 onOperation('fixtures');const w=randomUUID(),user=randomUUID();
 await sql(`insert into auth.users(id,email,email_confirmed_at) values(${quote(user)},'local-concurrency@invalid.test',now());insert into auth.sessions(id,user_id) values(${quote(user)},${quote(user)});insert into nam_workspaces(id,name) values(${quote(w)},'Disposable concurrency workspace');insert into nam_memberships(workspace_id,user_id,name,role) values(${quote(w)},${quote(user)},'Local Founder','founder');`);
 const identity=`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:user,session_id:user,role:'authenticated',aal:'aal1'}))},true);set local role authenticated;`;
 const run=async source=>{const result=await sql('begin;'+identity+source+';commit;');return JSON.parse(result.split('\n').filter(value=>value.startsWith('{')).at(-1));};
 const create=title=>run(`select to_jsonb(nam_create_task(${quote(w)},${quote(JSON.stringify({title,section:'operations',due_date:'2027-04-15'}))}::jsonb,${quote(randomUUID())}))`);
 async function waitForWaiter(two,name){
  await until(async()=>{
   // Awaiting the backend's lock state (rather than a delay) proves that the
   // statement started before the revoker committed its separate transaction.
   const waiting=await sql(`select exists(select 1 from pg_stat_activity where datname=current_database() and application_name=${quote(name)} and wait_event_type='Lock' and wait_event='advisory')`);
   if(waiting==='t')return true;
   await Promise.race([two.done.then(()=>{throw fail('assertion');}),Promise.resolve()]);return false;
  });
 }
 async function conflict(first,second,state,reason){
  const name='nam-scheduling-waiter-'+randomBytes(6).toString('hex');
  const one=session('begin;'+identity+first+";select 'first-write-held';",{name:'nam-scheduling-holder',hold:true});
  try{
   await until(()=>one.output().includes('first-write-held'));
   const two=session('begin;'+identity+second+';commit;',{name});
   try{await waitForWaiter(two,name);one.child.stdin.end('commit;\n');await one.done;await assert.rejects(two.done,error=>error.sqlstate===state&&(!reason||reason.test(error.privateMessage)));}
   finally{two.stop();}
  }finally{one.stop();}
 }
 onOperation('reciprocal_dependencies');
 const a=await create('Reciprocal A'),b=await create('Reciprocal B');
 const edge=(from,to)=>`select nam_save_task_scheduling(${quote(w)},${quote(from)},1,${quote(JSON.stringify({prerequisite_ids:[to]}))}::jsonb,${quote(randomUUID())})`;
 await conflict(edge(a.id,b.id),edge(b.id,a.id),'22023',/cycle/);
 assert.equal(await sql(`select count(*) from nam_task_dependencies where workspace_id=${quote(w)}`),'1');
 onOperation('duplicate_completion');
 const repeat=await create('One successor under concurrent completion');await run(`select nam_save_task_scheduling(${quote(w)},${quote(repeat.id)},1,'{"recurrence":{"frequency":"daily"}}'::jsonb,${quote(randomUUID())})`);
 const complete=`select to_jsonb(nam_save_task(${quote(w)},${quote(repeat.id)},2,'{"status":"Done"}'::jsonb))`;
 await conflict(complete,complete,'40001');assert.equal(await sql(`select count(*) from nam_tasks where recurrence_predecessor_id=${quote(repeat.id)}`),'1');
 async function queuedDenial(statement,revoke,restore,unchanged){
  // Deliberately acquire ONLY the raw workspace advisory lock. Calling the
  // application's lock helper here would pin identity rows and block revocation.
  const holder=session(`begin;select pg_advisory_xact_lock(hashtextextended('nam-task-schedule:'||${quote(w)}::text,0));select 'raw-lock-held';`,{name:'nam-scheduling-raw-holder',hold:true});
  let waiter,revoked=false;
  try{
   await until(()=>holder.output().includes('raw-lock-held'));
   const name='nam-scheduling-revocation-'+randomBytes(6).toString('hex');
   waiter=session('begin;'+identity+statement+';commit;',{name});await waitForWaiter(waiter,name);
   // This separate backend must commit while the original holder is still
   // holding its lock; a waiter that prematurely pins identity makes this fail.
   await sql('begin;'+revoke+';commit;');revoked=true;
   holder.child.stdin.end('commit;\n');await holder.done;
   await assert.rejects(waiter.done,error=>error.sqlstate==='42501');await unchanged();
  }finally{
   waiter?.stop();holder.stop();if(revoked)await sql(restore);
  }
 }
 const protectedTask=await create('Queued permission check');
 const update=`select nam_save_task(${quote(w)},${quote(protectedTask.id)},1,'{"title":"Denied queued change"}'::jsonb)`;
 const unchangedTask=async()=>assert.equal(await sql(`select version from nam_tasks where id=${quote(protectedTask.id)}`),'1');
 onOperation('queued_session_revocation');
 await queuedDenial(update,`delete from auth.sessions where id=${quote(user)}`,`insert into auth.sessions(id,user_id) values(${quote(user)},${quote(user)})`,unchangedTask);
 const factor=randomUUID(),enroll=`insert into auth.mfa_factors(id,user_id,status) values(${quote(factor)},${quote(user)},'verified')`,unenroll=`delete from auth.mfa_factors where id=${quote(factor)}`;
 onOperation('queued_task_mfa');await queuedDenial(update,enroll,unenroll,unchangedTask);
 onOperation('queued_command_mfa');
 const path=randomUUID(),key=randomUUID();
 const command=`select nam_learning_path_command(${quote(w)},'create',${quote(path)},null,'{"title":"Denied queued path","topics":[],"courses":[]}'::jsonb,${quote(key)})`;
 await queuedDenial(command,enroll,unenroll,async()=>{
  for(const table of ['nam_learning_paths','nam_learning_path_events','nam_learning_path_commands'])assert.equal(await sql(`select count(*) from ${table} where workspace_id=${quote(w)}`),'0');
 });
}
export async function runConcurrency({mode='docker',target,qaRoot=process.env.NAM_QA_ROOT||'/workspace/.cache/nam-os/isolated'}={}){
 let operation='configuration',failureOperation,log,connection,admin,outcome;
 const onOperation=value=>{operation=value;};
 try{
  log=await privateDiagnostics(qaRoot);
  if(mode==='manual'){
   validateManualTarget(target);connection=driver({mode,target},log);await prove(connection,onOperation);
  }else if(mode==='docker'){
   admin=driver({mode,database:'postgres'},log);
   await withDisposableDatabase(admin.sql,async database=>{
    connection=driver({mode,database},log);
    try{await prove(connection,onOperation);}catch(error){failureOperation=operation;throw error;}
    finally{connection.close();}
   },{onOperation});
  }else throw fail('configuration');
  outcome=boundedOutcome('pass','complete');
 }catch(error){
  if(log)try{await log.write('\n[private failure]\n'+(error.stack||String(error))+'\n');}catch{}
  outcome=boundedOutcome('fail',error.operation==='cleanup'?'cleanup':failureOperation||operation,error);
 }finally{
  connection?.close();admin?.close();
  try{await log?.close();}catch{outcome=boundedOutcome('fail','cleanup',fail('filesystem'));}
 }
 return outcome;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=process.env.NAM_SCHEDULING_TEST_DATABASE_URL;
 test('independent PostgreSQL backends enforce scheduling and queued identity changes',{skip:!target,timeout:180000},async()=>{
  const outcome=await runConcurrency({mode:'manual',target});
  console.log(JSON.stringify(outcome));assert.equal(outcome.status,'pass',JSON.stringify(outcome));
 });
}
