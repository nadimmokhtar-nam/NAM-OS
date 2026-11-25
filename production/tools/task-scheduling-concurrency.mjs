import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Optional cross-backend proof, independent of PGlite and provider accounts.
// The URL must identify a NEW EMPTY disposable database on a loopback server.
// Nothing runs without this explicit test-only environment variable.
const target=process.env.NAM_SCHEDULING_TEST_DATABASE_URL;
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
function session(sql,{name='nam-scheduling-test',hold=false}={}){
 const child=spawn('psql',['--no-psqlrc','--no-password','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','--tuples-only','--no-align','--dbname',target],{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
 let output='',errors='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(output.trim()):reject(Object.assign(Error(errors||'psql exited '+code),{code,output})));});done.catch(()=>{});
 child.stdin.write(sql+'\n');if(!hold)child.stdin.end();return {child,done,output:()=>output,errors:()=>errors};
}
const sql=source=>session(source).done;
async function until(predicate,message){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await predicate())return;await new Promise(done=>setTimeout(done,30));}throw Error(message);}

test('real PostgreSQL backends serialize reciprocal dependencies and duplicate recurring completions',{skip:!target,timeout:90000},async()=>{
 const address=new URL(target);assert(['postgres:','postgresql:'].includes(address.protocol)&&['127.0.0.1','localhost','[::1]'].includes(address.hostname)&&Array.from(address.searchParams.keys()).every(key=>['sslmode','connect_timeout','application_name'].includes(key)),'Scheduling concurrency tests only permit a local disposable PostgreSQL database without host/service overrides.');
 assert.equal(await sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p','m')"),'0','Use a new empty database; this test never writes into an existing application database.');
 await sql(`begin;
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
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;commit;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort())await sql(await readFile(new URL(file,directory),'utf8'));
 const w=randomUUID(),user=randomUUID();await sql(`insert into auth.users(id,email,email_confirmed_at) values(${quote(user)},'local-concurrency@invalid.test',now());insert into auth.sessions(id,user_id) values(${quote(user)},${quote(user)});insert into nam_workspaces(id,name) values(${quote(w)},'Disposable concurrency workspace');insert into nam_memberships(workspace_id,user_id,name,role) values(${quote(w)},${quote(user)},'Local Founder','founder');`);
 const identity=`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:user,session_id:user,role:'authenticated',aal:'aal1'}))},true);set local role authenticated;`;
 const run=async source=>{const result=await sql('begin;'+identity+source+';commit;');return JSON.parse(result.split('\n').filter(value=>value.startsWith('{')).at(-1));};
 const create=title=>run(`select to_jsonb(nam_create_task(${quote(w)},${quote(JSON.stringify({title,section:'operations',due_date:'2027-04-15'}))}::jsonb,${quote(randomUUID())}))`);
 async function conflict(first,second,error){
  const one=session('begin;'+identity+first+";select 'first-write-held';",{name:'nam-schedule-holder',hold:true});
  try{
   await until(()=>one.output().includes('first-write-held'),'The first write did not acquire its lock.');
   const two=session('begin;'+identity+second+';commit;',{name:'nam-schedule-waiter'});
   try{await until(async()=>await sql("select exists(select 1 from pg_stat_activity where application_name='nam-schedule-waiter' and wait_event_type='Lock' and wait_event='advisory')")==='t','The second backend did not wait on the workspace advisory lock.');one.child.stdin.end('commit;\n');await one.done;await assert.rejects(two.done,error);}
   finally{two.child.kill();}
  }finally{one.child.kill();}
 }
 const a=await create('Reciprocal A'),b=await create('Reciprocal B');
 const edge=(from,to)=>`select nam_save_task_scheduling(${quote(w)},${quote(from)},1,${quote(JSON.stringify({prerequisite_ids:[to]}))}::jsonb,${quote(randomUUID())})`;
 await conflict(edge(a.id,b.id),edge(b.id,a.id),error=>/22023/.test(error.message)&&/cycle/.test(error.message));assert.equal(await sql(`select count(*) from nam_task_dependencies where workspace_id=${quote(w)}`),'1');
 const repeat=await create('One successor under concurrent completion');await run(`select nam_save_task_scheduling(${quote(w)},${quote(repeat.id)},1,'{"recurrence":{"frequency":"daily"}}'::jsonb,${quote(randomUUID())})`);
 const complete=`select to_jsonb(nam_save_task(${quote(w)},${quote(repeat.id)},2,'{"status":"Done"}'::jsonb))`;
 await conflict(complete,complete,error=>/40001/.test(error.message));assert.equal(await sql(`select count(*) from nam_tasks where recurrence_predecessor_id=${quote(repeat.id)}`),'1');
});
