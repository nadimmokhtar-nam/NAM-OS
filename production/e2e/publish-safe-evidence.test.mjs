import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const cases=['eight-account-role-and-task-scope','direct-permission-boundaries','actual-password-and-optional-mfa-assurance','actual-membership-revocation','actual-managed-session-logout-replay','actual-anonymous-and-signup-denial'];
const output=new URL('./.runtime/api-results.json',import.meta.url);
test('HTTP evidence retains only known counters and never copies raw credentials or errors',()=>{
 const temp=mkdtempSync(join(tmpdir(),'nam-safe-evidence-')),privateDir=join(temp,'nam-os-e2e');mkdirSync(privateDir,{mode:0o700});
 const run=()=>spawnSync(process.execPath,[new URL('./publish-safe-evidence.mjs',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
 try{
  const missing=run();assert.equal(missing.status,0);assert.equal(JSON.parse(readFileSync(output,'utf8')).status,'not_run');
  const secret='PRIVATE-COOKIE-AND-API-KEY-CANARY';
  const navigations=[['/mfa','/workspace','password_mfa_redirect'],['/workspace','/workspace','password_mfa_redirect'],['/workspace','/mfa','optional_ssr_redirect'],['/mfa','/mfa','optional_ssr_redirect'],['/workspace','/workspace','optional_ssr_restore'],['/mfa','/workspace','optional_ssr_restore']].map(([path,expectedPath,stage])=>({stage,path,expectedPath,actualPath:expectedPath,initialStatus:200,rendered:true,cookie:secret}));
  const data={kind:'real-local-supabase-api',status:'passed',setup:'passed',expected:6,completed:6,passed:6,failed:0,checks:cases.map(name=>({name,status:'passed',error:secret})),assurance:{stage:'session_cleanup',navigations,token:secret},token:secret};
  writeFileSync(join(privateDir,'api-results.json'),JSON.stringify(data),{mode:0o600});
  const valid=run();assert.equal(valid.status,0);const raw=readFileSync(output,'utf8');assert(!raw.includes(secret));assert(!valid.stdout.includes(secret));assert(!valid.stderr.includes(secret));assert.equal(JSON.parse(raw).status,'passed');
  assert.equal(JSON.parse(raw).assurance.navigations.length,6);
  data.assurance.navigations=[];writeFileSync(join(privateDir,'api-results.json'),JSON.stringify(data),{mode:0o600});const missingRoutes=run();assert.equal(missingRoutes.status,1);assert.equal(JSON.parse(readFileSync(output,'utf8')).status,'invalid_evidence','A bare HTTP 200 cannot certify rendered redirect behavior.');
  data.status='failed';data.passed=5;data.failed=1;data.checks[2].status='failed';data.assurance={stage:'password_mfa_redirect',navigations:[],failure:{kind:'assertion',source:{file:'security-http.test.mjs',line:42,column:17},actualStatus:200,expectedStatus:307,actualPath:secret,message:secret,stack:secret}};writeFileSync(join(privateDir,'api-results.json'),JSON.stringify(data),{mode:0o600});const failed=run();assert.equal(failed.status,0);const failureRaw=readFileSync(output,'utf8'),failureReport=JSON.parse(failureRaw);assert.equal(failureReport.status,'failed');assert.equal(failureReport.assurance.stage,'password_mfa_redirect');assert.deepEqual(failureReport.assurance.failure,{kind:'assertion',source:{file:'security-http.test.mjs',line:42,column:17},actualStatus:200,expectedStatus:307});assert(!failureRaw.includes(secret));
  data.checks[0].name=secret;writeFileSync(join(privateDir,'api-results.json'),JSON.stringify(data),{mode:0o600});
  const invalid=run();assert.equal(invalid.status,1);const rejected=readFileSync(output,'utf8');assert.equal(JSON.parse(rejected).status,'invalid_evidence');assert(!rejected.includes(secret));
 }finally{rmSync(temp,{recursive:true,force:true});if(existsSync(output))unlinkSync(output);}
});
