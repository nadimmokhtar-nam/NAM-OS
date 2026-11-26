import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {boundedOutcome,validateManualTarget,psqlInvocation,privateDiagnostics,withDisposableDatabase,requireEmptyDatabase,runConcurrency,dockerContainer,dockerSocket} from '../tools/task-scheduling-concurrency.mjs';

const generated='nam_scheduling_qa_0123456789abcdef01234567';
test('native psql uses the fixed local Docker boundary and propagates backend barrier names',()=>{
 const run=psqlInvocation({mode:'docker',database:generated,name:'nam-scheduling-waiter-123abc'});
 assert.equal(run.binary,'docker');assert.equal(dockerContainer,'supabase_db_nam-os-qa');assert.equal(dockerSocket,'unix:///var/run/docker.sock');
 assert.deepEqual(run.args.slice(0,16),['--host=unix:///var/run/docker.sock','exec','-i','--env','PGAPPNAME=nam-scheduling-waiter-123abc','--env','PGCONNECT_TIMEOUT=5','--env','PGOPTIONS=-c statement_timeout=20000 -c lock_timeout=15000','--env','PGSERVICE=','--env','PGSERVICEFILE=','--env','PGHOSTADDR=','supabase_db_nam-os-qa']);
 assert.deepEqual(run.args.slice(-8,-4),['--host','/var/run/postgresql','--port','5432']);
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
