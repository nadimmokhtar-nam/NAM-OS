import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {classifyTransportFailure,boundedOutcome,validateManualTarget,psqlInvocation,privateDiagnostics,withDisposableDatabase,requireEmptyDatabase,runConcurrency,dockerContainer,dockerSocket} from '../tools/task-scheduling-concurrency.mjs';

const generated='nam_scheduling_qa_0123456789abcdef01234567';
test('native psql uses the fixed local Docker boundary and propagates backend barrier names',()=>{
 const run=psqlInvocation({mode:'docker',database:generated,name:'nam-scheduling-waiter-123abc'});
 assert.equal(run.binary,'docker');assert.equal(dockerContainer,'supabase_db_nam-os-qa');assert.equal(dockerSocket,'unix:///var/run/docker.sock');
 assert.deepEqual(run.args.slice(0,10),['--host=unix:///var/run/docker.sock','exec','-i','--env','PGAPPNAME=nam-scheduling-waiter-123abc','--env','PGCONNECT_TIMEOUT=5','--env','PGOPTIONS=-c statement_timeout=20000 -c lock_timeout=15000','supabase_db_nam-os-qa']);
 assert.deepEqual(run.args.slice(10,22),['env','-u','PGHOST','-u','PGHOSTADDR','-u','PGPORT','-u','PGSERVICE','-u','PGSERVICEFILE','psql']);
 assert(!run.args.some(value=>value==='--port'||value==='--host'||value.startsWith('PGSERVICE=')||value.startsWith('PGSERVICEFILE=')));
 assert(run.args.includes('psql'));assert.deepEqual(run.args.slice(-4),['--username','postgres','--dbname',generated]);
 assert.equal(run.env.PGAPPNAME,'nam-scheduling-waiter-123abc');
 for(const database of ['nam-os','postgres; drop database postgres','nam_scheduling_qa_x','NAM_SCHEDULING_QA_0123456789abcdef01234567'])assert.throws(()=>psqlInvocation({mode:'docker',database}));
 assert.throws(()=>psqlInvocation({mode:'docker',database:generated,name:'unsafe\nPGHOST=remote'}));
});
test('manual mode rejects remote and host/service override URLs while preserving loopback opt-in',()=>{
 for(const target of ['https://localhost/qa','postgresql://remote.example.test/qa','postgresql://localhost/qa?host=remote','postgresql://localhost/qa?service=prod','postgresql://localhost/qa?options=-cfoo','postgresql://localhost/','postgresql://localhost/qa#fragment'])assert.throws(()=>validateManualTarget(target));
 for(const hostname of ['localhost','127.0.0.1','[::1]']){
  const run=psqlInvocation({mode:'manual',target:`postgresql://${hostname}/new_qa?application_name=ignored&sslmode=disable`,name:'nam-scheduling-waiter-test'});
  assert.equal(run.binary,'psql');assert.equal(new URL(run.args.at(-1)).searchParams.get('application_name'),'nam-scheduling-waiter-test');
 }
});
test('native lifecycle creates a template0 database and drops only its exact generated name',async()=>{
 const calls=[],operations=[];
 const result=await withDisposableDatabase(async sql=>calls.push(sql),async database=>{assert.equal(database,generated);calls.push('proof');return 42;},{makeName:()=>generated,onOperation:value=>operations.push(value)});
 assert.equal(result,42);assert.deepEqual(calls,[`create database "${generated}" template template0;`,'proof',`drop database "${generated}" with (force);`]);assert.deepEqual(operations,['create_database','cleanup']);
});
test('lifecycle never drops after failed creation and does not accept arbitrary cleanup names',async()=>{
 const calls=[];await assert.rejects(withDisposableDatabase(async sql=>{calls.push(sql);throw Error('creation failed');},async()=>assert.fail('proof must not run'),{makeName:()=>generated}));
 assert.equal(calls.length,1);assert(!calls[0].includes('drop'));
 for(const name of ['postgres','nam_scheduling_qa_abc','nam_scheduling_qa_'+ 'f'.repeat(24)+';drop database postgres'])await assert.rejects(withDisposableDatabase(async()=>assert.fail('admin must not run'),async()=>assert.fail('proof must not run'),{makeName:()=>name}));
});
test('proof failures still drop the new database and cleanup failures cannot become a pass',async()=>{
 const calls=[],failure=Error('private proof failure');
 await assert.rejects(withDisposableDatabase(async sql=>calls.push(sql),async()=>{throw failure;},{makeName:()=>generated}),error=>error===failure);
 assert.equal(calls.length,2);assert.equal(calls[1],`drop database "${generated}" with (force);`);
 await assert.rejects(withDisposableDatabase(async sql=>{if(sql.startsWith('drop'))throw Error('private cleanup failure');},async()=>true,{makeName:()=>generated}),error=>error.operation==='cleanup');
});
test('empty database guard refuses any prior application object before initialization',async()=>{
 let query;await requireEmptyDatabase(async sql=>{query=sql;return '0';});assert(query.includes('pg_class'));assert(query.includes('pg_proc'));assert(query.includes('pg_namespace'));
 await assert.rejects(requireEmptyDatabase(async()=> '1'),{code:'ERR_ASSERTION'});
});
test('public outcome whitelists operations and valid SQLSTATE values without raw diagnostics',()=>{
 const secret='postgresql://user:password@remote/qa SQL JWT 11111111-1111-4111-8111-111111111111';
 assert.deepEqual(boundedOutcome('pass','complete'),{status:'pass',operation:'complete'});
 assert.deepEqual(boundedOutcome('fail','queued_task_mfa',{sqlstate:'42501',message:secret,sql:secret}),{status:'fail',operation:'queued_task_mfa',sqlstate:'42501'});
 assert.deepEqual(boundedOutcome('fail',secret,{sqlstate:secret,failureType:secret,message:secret}),{status:'fail',operation:'configuration',failureType:'unknown'});
 assert.deepEqual(boundedOutcome('fail','migrations',{code:'ERR_ASSERTION',message:secret}),{status:'fail',operation:'migrations',failureType:'assertion'});
 assert.deepEqual(boundedOutcome('fail','create_database',{failureType:'process',transport:'psql',message:secret}),{status:'fail',operation:'create_database',failureType:'process',transport:'psql'});
 assert.deepEqual(boundedOutcome('fail','create_database',{sqlstate:'42501',transport:'permission',message:secret}),{status:'fail',operation:'create_database',sqlstate:'42501',transport:'permission'});
 assert(!JSON.stringify(boundedOutcome('fail','create_database',{transport:secret,message:secret})).includes(secret));
});
test('private QA diagnostics enforce mode 0700 directories and mode 0600 raw logs',async t=>{
 const root=await mkdtemp(resolve(tmpdir(),'nam-concurrency-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const log=await privateDiagnostics(root);await log.write('private raw diagnostics');await log.close();
 const directory=resolve(root,'scheduling-concurrency'),files=await readdir(directory);
 assert.equal((await stat(root)).mode&0o777,0o700);assert.equal((await stat(directory)).mode&0o777,0o700);assert.equal(files.length,1);assert.equal((await stat(resolve(directory,files[0]))).mode&0o777,0o600);
 assert.equal(await readFile(resolve(directory,files[0]),'utf8'),'private raw diagnostics');
 const outcome=await runConcurrency({mode:'manual',target:'postgresql://private-secret@remote.invalid/qa',qaRoot:root});assert.deepEqual(outcome,{status:'fail',operation:'configuration',failureType:'configuration'});
});
test('native orchestrator refuses remote-linked or non-QA configuration with bounded output before any provider action',async t=>{
 const root=await mkdtemp(resolve(tmpdir(),'nam-concurrency-guard-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(resolve(root,'supabase'));
 for(const config of [{project_id:'production-secret'},{project_id:'nam-os-qa',remotes:{production:'https://private-secret.invalid'}}]){
  await writeFile(resolve(root,'supabase/config.jsonc'),JSON.stringify(config));
  const result=spawnSync(process.execPath,['tools/isolated-dev.mjs','concurrency'],{cwd:new URL('..',import.meta.url),env:{...process.env,NAM_QA_ROOT:root,NAM_QA_CLI:resolve(root,'must-not-run-cli')},encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),{status:'fail',operation:'configuration',failureType:'unknown'});
 }
});

test('container command truly unsets inherited libpq host and service settings while retaining the waiter name',async t=>{
 const root=await mkdtemp(resolve(tmpdir(),'nam-concurrency-env-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const stub=resolve(root,'psql');
 await writeFile(stub,'#!/usr/bin/env node\nconst names=["PGHOST","PGHOSTADDR","PGPORT","PGSERVICE","PGSERVICEFILE"];if(names.some(key=>process.env[key]!==undefined))process.exit(23);process.stdout.write(process.env.PGAPPNAME);\n',{mode:0o700});
 const run=psqlInvocation({mode:'docker',database:generated,name:'nam-scheduling-waiter-contract'});
 const command=run.args.slice(run.args.indexOf(dockerContainer)+1);
 const result=spawnSync(command[0],command.slice(1),{env:{...process.env,PATH:root+':'+process.env.PATH,PGAPPNAME:run.env.PGAPPNAME,PGHOST:'remote.invalid',PGHOSTADDR:'192.0.2.1',PGPORT:'9999',PGSERVICE:'',PGSERVICEFILE:''},encoding:'utf8'});
 assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(result.stdout,'nam-scheduling-waiter-contract');
});
test('private transport diagnostics map only to bounded literal categories',()=>{
 const secret='postgresql://user:private-password@private-host.invalid/qa SQL JWT 11111111-1111-4111-8111-111111111111';
 const cases=[
  ['socket','psql: connection to server on socket "/private/.s.PGSQL.5432" failed: No such file or directory'],
  ['auth','psql: FATAL: password authentication failed for user "private-account"'],
  ['auth','psql: connection failed: fe_sendauth: no password supplied'],
  ['permission','ERROR: 42501: permission denied to create database'],
  ['docker','Error response from daemon: No such container: private-container'],
  ['docker','OCI runtime exec failed: exec failed: unable to start container process'],
  ['timeout','psql: timeout expired'],
  ['psql','psql: error: service file "" not found'],
  ['psql','psql: invalid command-line option'],
 ];
 for(const [expected,message] of cases){
  const diagnostics=message+' '+secret,transport=classifyTransportFailure({mode:'docker',diagnostics});assert.equal(transport,expected);
  const publicResult=boundedOutcome('fail','create_database',{failureType:'process',transport,privateMessage:diagnostics});assert.deepEqual(publicResult,{status:'fail',operation:'create_database',failureType:'process',transport:expected});assert(!JSON.stringify(publicResult).includes(secret));
 }
 assert.equal(classifyTransportFailure({mode:'docker',spawnCode:'ENOENT'}),'docker');
 assert.equal(classifyTransportFailure({mode:'manual',spawnCode:'ENOENT'}),'psql');
 assert.equal(classifyTransportFailure({mode:'docker',spawnCode:'EACCES'}),'permission');
 assert.equal(classifyTransportFailure({mode:'docker',timedOut:true}),'timeout');
});
test('native child transport failures produce bounded outcomes and retain raw stderr only in the private log',async t=>{
 const root=await mkdtemp(resolve(tmpdir(),'nam-concurrency-child-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const message='psql: error: service file "private-service-file" not found; postgresql://private-user:private-password@private-host.invalid/qa';
 await writeFile(resolve(root,'docker'),'#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>{process.stderr.write('+JSON.stringify(message)+');process.exitCode=2;});\n',{mode:0o700});
 const previous=process.env.PATH;let outcome;
 try{process.env.PATH=root+':'+previous;outcome=await runConcurrency({mode:'docker',qaRoot:root});}finally{process.env.PATH=previous;}
 assert.deepEqual(outcome,{status:'fail',operation:'create_database',failureType:'process',transport:'psql'});
 const directory=resolve(root,'scheduling-concurrency'),files=await readdir(directory);
 assert.equal(files.length,1);assert.equal((await stat(resolve(directory,files[0]))).mode&0o777,0o600);
 const diagnostics=await readFile(resolve(directory,files[0]),'utf8');assert(diagnostics.includes(message));assert(!JSON.stringify(outcome).includes('private-'));
});
