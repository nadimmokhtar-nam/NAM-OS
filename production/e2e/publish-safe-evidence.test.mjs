import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const cases=['eight-account-role-and-task-scope','direct-permission-boundaries','actual-founder-aal1-denial','actual-membership-revocation','actual-managed-session-logout-replay','actual-anonymous-and-signup-denial'];
const output=new URL('./.runtime/api-results.json',import.meta.url);
test('HTTP evidence retains only known counters and never copies raw credentials or errors',()=>{
 const temp=mkdtempSync(join(tmpdir(),'nam-safe-evidence-')),privateDir=join(temp,'nam-os-e2e');mkdirSync(privateDir,{mode:0o700});
 const run=()=>spawnSync(process.execPath,[new URL('./publish-safe-evidence.mjs',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
 try{
  const missing=run();assert.equal(missing.status,0);assert.equal(JSON.parse(readFileSync(output,'utf8')).status,'not_run');
  const secret='PRIVATE-COOKIE-AND-API-KEY-CANARY';
  const data={kind:'real-local-supabase-api',status:'passed',setup:'passed',expected:6,completed:6,passed:6,failed:0,checks:cases.map(name=>({name,status:'passed',error:secret})),token:secret};
  writeFileSync(join(privateDir,'api-results.json'),JSON.stringify(data),{mode:0o600});
  const valid=run();assert.equal(valid.status,0);const raw=readFileSync(output,'utf8');assert(!raw.includes(secret));assert(!valid.stdout.includes(secret));assert(!valid.stderr.includes(secret));assert.equal(JSON.parse(raw).status,'passed');
  data.checks[0].name=secret;writeFileSync(join(privateDir,'api-results.json'),JSON.stringify(data),{mode:0o600});
  const invalid=run();assert.equal(invalid.status,1);const rejected=readFileSync(output,'utf8');assert.equal(JSON.parse(rejected).status,'invalid_evidence');assert(!rejected.includes(secret));
 }finally{rmSync(temp,{recursive:true,force:true});if(existsSync(output))unlinkSync(output);}
});
