import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chmod,lstat,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ACCOUNT_KEYS,SECURITY_ACCOUNT_KEYS,fixtureAccount,loadFixtures,totpCode} from '../e2e/auth-helpers.mjs';
import {configuration,provision} from '../e2e/provision.mjs';

const input=runner=>({NAM_E2E_ALLOW_PROVISION:'1',RUNNER_TEMP:runner,SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'fixture-only-public-key',SUPABASE_SERVICE_ROLE_KEY:'fixture-only-service-key',SUPABASE_DB_URL:'postgresql://postgres:test-only@127.0.0.1:54322/postgres',NAM_APP_ORIGIN:'http://127.0.0.1:3000'});
test('end-to-end provisioning rejects existing/remote/unauthorized environments before provider mutation',async t=>{const root=await mkdtemp(join(tmpdir(),'nam-e2e-guard-'));t.after(()=>rm(root,{recursive:true,force:true}));for(const change of [{NAM_E2E_ALLOW_PROVISION:''},{SUPABASE_URL:'https://real-project.supabase.co'},{SUPABASE_URL:'http://127.0.0.1.attacker.test:54321'},{SUPABASE_DB_URL:'postgresql://postgres:secret@remote.test/postgres'},{NAM_APP_ORIGIN:'https://studio.example.test'},{RUNNER_TEMP:'relative'}])assert.throws(()=>configuration({...input(root),...change}));let calls=0;await assert.rejects(()=>provision({env:input(root),clientFactory(){calls++;return {auth:{admin:{listUsers:async()=>({data:{users:[{id:'existing'}]},error:null})}}};},runSQL:async()=>{}}),/must be empty/);assert.equal(calls,1);});
test('authenticator codes use standard SHA-1 TOTP values without exposing seeds',()=>{const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';for(const [seconds,expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037']])assert.equal(totpCode(secret,seconds*1000),expected);assert.throws(()=>totpCode('invalid secret',Date.now()));});
test('synthetic provisioning leaves eight password-only accounts and enrolls only the dedicated optional-MFA identity',async t=>{
 const root=await mkdtemp(join(tmpdir(),'nam-e2e-provision-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const previousFixture=process.env.NAM_E2E_FIXTURES,previousAlias=process.env.NAM_E2E_ACCOUNTS_FILE;delete process.env.NAM_E2E_FIXTURES;delete process.env.NAM_E2E_ACCOUNTS_FILE;
 t.after(()=>{if(previousFixture===undefined)delete process.env.NAM_E2E_FIXTURES;else process.env.NAM_E2E_FIXTURES=previousFixture;if(previousAlias===undefined)delete process.env.NAM_E2E_ACCOUNTS_FILE;else process.env.NAM_E2E_ACCOUNTS_FILE=previousAlias;});
 const env=input(root),sql=[],users=[],calls=[],secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',factorId=randomUUID();
 const admin={auth:{admin:{listUsers:async()=>({data:{users:[]},error:null}),createUser:async values=>{assert.equal(values.email_confirm,true);assert(values.password.length>=32);const user={id:randomUUID(),email:values.email,email_confirmed_at:new Date().toISOString()};users.push({...values,...user});return {data:{user},error:null};}}}};
 function provider(){let user,verified=false;return {auth:{
  signInWithPassword:async values=>{user=users.find(u=>u.email===values.email&&u.password===values.password);calls.push('signIn:'+user?.user_metadata.display_name);return {data:{user},error:user?null:{}};},
  mfa:{enroll:async values=>{assert.equal(user.user_metadata.display_name,'QA optional mfa sales','No baseline account may enroll a factor.');assert.equal(values.factorType,'totp');calls.push('enroll');return {data:{id:factorId,type:'totp',totp:{secret}},error:null};},challengeAndVerify:async values=>{assert.equal(values.factorId,factorId);assert([totpCode(secret),totpCode(secret,Date.now()-30000)].includes(values.code));verified=true;calls.push('verify');return {error:null};}},
  getClaims:async()=>({data:{claims:{aal:verified?'aal2':'aal1'}},error:null})
 },rpc:async name=>({data:name==='nam_create_task'?{id:randomUUID()}:name==='nam_founder'?user?.user_metadata.display_name==='QA founder':name==='nam_assured'&&verified,error:null})};}
 const result=await provision({env,runSQL:async(config,statement)=>{assert.equal(config.database.hostname,'127.0.0.1');sql.push(statement);},clientFactory(url,key,options){assert.equal(url,env.SUPABASE_URL);assert.equal(options.auth.persistSession,false);return key===env.SUPABASE_SERVICE_ROLE_KEY?admin:provider();}});
 assert.equal(result.accountCount,8);assert.equal(result.securityAccountCount,1);assert.equal(users.length,9);assert.deepEqual(calls,['signIn:QA founder','signIn:QA optional mfa sales','enroll','verify']);
 const directory=join(root,'nam-os-e2e'),file=join(directory,'accounts.json'),manifest=JSON.parse(await readFile(file,'utf8'));
 assert.deepEqual(Object.keys(manifest.accounts),ACCOUNT_KEYS);assert.deepEqual(Object.keys(manifest.securityAccounts),SECURITY_ACCOUNT_KEYS);
 for(const key of ACCOUNT_KEYS)assert.equal(manifest.accounts[key].totp,undefined,'Every baseline account must remain password-only.');
 assert.equal(manifest.securityAccounts.optional_mfa_sales.totp.factorId,factorId);assert.equal(fixtureAccount(manifest,'optional_mfa_sales').role,'sales');assert.equal(fixtureAccount(manifest,'unknown'),undefined);
 assert.equal(manifest.accounts.sales_1.role,'sales');assert.equal(users[2].user_metadata.role,'founder');assert(!JSON.stringify(manifest).includes(env.SUPABASE_SERVICE_ROLE_KEY));
 assert.equal((await lstat(directory)).mode&0o777,0o700);assert.equal((await lstat(file)).mode&0o777,0o600);assert.equal((await lstat(join(directory,'runtime.env'))).mode&0o777,0o600);
 const runtimePath=join(directory,'runtime.env'),runtimeText=await readFile(runtimePath,'utf8');assert.equal(runtimeText.split('\n').filter(Boolean).length,8);
 await promisify(execFile)('/bin/sh',['-c','set +x; . "$1"; test "$NAM_WORKSPACE_ID" = "$2"','nam-private-env-test',runtimePath,manifest.workspaceId],{env:{PATH:'/usr/bin:/bin'}});
 assert(manifest.otherTaskId);assert(sql.join('\n').includes(manifest.securityAccounts.optional_mfa_sales.id));assert(sql.join('\n').includes('auth.users)<>9'));
 for(const user of users)assert(!sql.join('\n').includes(user.password));
 const previous=process.env.RUNNER_TEMP;process.env.RUNNER_TEMP=root;t.after(()=>{if(previous===undefined)delete process.env.RUNNER_TEMP;else process.env.RUNNER_TEMP=previous;});assert.equal((await loadFixtures(file)).workspaceId,manifest.workspaceId);
 manifest.accounts.founder.totp={...manifest.securityAccounts.optional_mfa_sales.totp};await writeFile(file,JSON.stringify(manifest));await assert.rejects(()=>loadFixtures(file),/manifest is invalid/,'Stale mandatory-MFA baseline fixtures must not pass as password-only evidence.');delete manifest.accounts.founder.totp;const optionalManifest=manifest.securityAccounts;delete manifest.securityAccounts;await writeFile(file,JSON.stringify(manifest));await assert.rejects(()=>loadFixtures(file),/manifest is invalid/,'A missing opt-in negative fixture must fail closed.');manifest.securityAccounts=optionalManifest;await writeFile(file,JSON.stringify(manifest));
 await chmod(file,0o644);await assert.rejects(()=>loadFixtures(file),/private/);
});
test('fixture output symlinks are rejected before creating identities',async t=>{const root=await mkdtemp(join(tmpdir(),'nam-e2e-link-')),other=await mkdtemp(join(tmpdir(),'nam-e2e-other-'));t.after(()=>Promise.all([rm(root,{recursive:true,force:true}),rm(other,{recursive:true,force:true})]));await symlink(other,join(root,'nam-os-e2e'));let called=false;await assert.rejects(()=>provision({env:input(root),clientFactory(){called=true;},runSQL:async()=>{}}),/unsafe/);assert.equal(called,false);});
