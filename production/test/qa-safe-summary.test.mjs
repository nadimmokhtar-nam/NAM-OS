import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const marker='PRIVATE_SENTINEL_credential_cookie_personal_record';
const testFile=resolve(app,'browser/task-focus.spec.mjs');
const example=(overrides={})=>({config:{rootDir:app},suites:[{file:testFile,specs:[{file:testFile,line:68,tests:[{
 status:'expected',results:[{status:'passed',duration:37}],...overrides,
 }]}]}],errors:[]});

async function summarize(report,{missing=false,raw,performance}={}){
 const root=await mkdtemp(resolve(tmpdir(),'nam-safe-summary-'));
 try{
  if(!missing)await writeFile(resolve(root,'browser-results.json'),raw??JSON.stringify(report),{mode:0o600});
  if(performance!==undefined)await writeFile(resolve(root,'performance.json'),JSON.stringify(performance),{mode:0o600});
  const result=spawnSync(process.execPath,[resolve(app,'tools/qa-safe-summary.mjs')],{
   cwd:app,env:{...process.env,NAM_QA_ROOT:root,GITHUB_SHA:'1'.repeat(40)},encoding:'utf8',timeout:10000,
  });
  assert.equal(result.signal,null,'The bounded sanitizer must not hang');
  const output=await readFile(resolve(root,'safe-summary.json'),'utf8');
  assert.equal((await stat(resolve(root,'safe-summary.json'))).mode&0o077,0,'Safe evidence remains private before explicit publication');
  assert.equal(output.includes(marker),false,'Private report data must not reach retained evidence');
  assert.equal((result.stdout+result.stderr).includes(marker),false,'Private report data must not reach command output');
  return {exit:result.status,output:JSON.parse(output),stdout:result.stdout};
 }finally{await rm(root,{recursive:true,force:true});}
}

function performanceReport(){const value=example();value.suites[0].specs[0].file=resolve(app,'browser/performance.spec.mjs');value.suites[0].specs[0].line=1;return value;}
const performanceFixture=()=>({commit:'1'.repeat(40),identities:8,loadTasks:10000,maximumSummaryBytes:65536,...Object.fromEntries(['httpReads','httpWriteIncludingContextRefresh','dailyBrief','eightConcurrentBrowserWorkspaces'].map(key=>[key,{samples:8,p50_ms:10,p95_ms:50,max_ms:70,private:marker}])),private:marker,endpoint:marker});
test('performance evidence retains only exact-source numeric aggregates after the real case passes',async()=>{
 const result=await summarize(performanceReport(),{performance:performanceFixture()});
 assert.equal(result.exit,0);assert.equal(result.output.evidenceIncomplete,false);
 assert.equal(result.output.performance.protocol,'loopback-bounded-eight-user-v1');
 assert.deepEqual(result.output.performance.httpReads,{samples:8,p50_ms:10,p95_ms:50,max_ms:70});
 assert.equal(result.output.performance.identities,8);assert.equal(result.output.performance.loadTasks,10000);
 assert.equal(result.stdout.includes('"performance"'),true);
});
test('a passing performance case fails closed if its measurement evidence is missing',async()=>{
 const result=await summarize(performanceReport());assert.equal(result.exit,1);assert.equal(result.output.evidenceIncomplete,true);assert.equal(result.output.performance,null);
});
for(const [name,change]of [['stale source',value=>value.commit='2'.repeat(40)],['text instead of latency',value=>value.httpReads.p95_ms=marker],['inconsistent percentiles',value=>value.httpReads.p50_ms=80],['wrong load identity count',value=>value.identities=7]])test('performance evidence rejects '+name,async()=>{
 const value=performanceFixture();change(value);const result=await summarize(performanceReport(),{performance:value});assert.equal(result.exit,1);assert.equal(result.output.performance,null);assert.equal(result.output.evidenceIncomplete,true);
});
test('an unrelated passing test cannot publish unexecuted performance evidence',async()=>{
 const result=await summarize(example(),{performance:performanceFixture()});assert.equal(result.exit,0);assert.equal('performance'in result.output,false);assert.equal(result.stdout.includes('"performance"'),false);
});

test('safe QA summary accepts a fully executed passing report and retains only bounded facts',async()=>{
 const fixture=example();fixture.suites[0].title=marker;fixture.suites[0].specs[0].title=marker;
 fixture.suites[0].specs[0].tests[0].results[0].stdout=[{text:marker}];
 fixture.suites[0].specs[0].tests[0].results[0].attachments=[{name:marker,path:'/private/'+marker+'.png'}];
 const result=await summarize(fixture);
 assert.equal(result.exit,0);assert.equal(result.output.status,'passed');
 assert.deepEqual(result.output.counts,{total:1,passed:1,unexpected:0,skipped:0,globalErrors:0});
 assert.equal(result.output.tests[0].file,'browser/task-focus.spec.mjs');
 assert.deepEqual(result.output.tests[0].results,[{status:'passed',duration:37}]);
 assert.equal('title' in result.output.tests[0],false);
});

test('failed assertions reveal a checked-in failure site and known matcher without private error content',async()=>{
 const fixture=example({status:'unexpected',results:[{status:'failed',duration:15000,errors:[
  {message:'expect(locator).toBeVisible failed '+marker,stack:marker,location:{file:testFile,line:77,column:35}},
  {message:'expect(locator).toBeFocused failed '+marker,stack:'Error: '+marker+'\n    at browser/task-focus.spec.mjs:81:91'},
 ]}]});
 const result=await summarize(fixture);
 assert.equal(result.exit,1);assert.equal(result.output.status,'failed_or_incomplete');
 const sites=result.output.tests[0].results[0].failureSites;
 assert.equal(sites.length,2);assert.match(sites[0].location,/^browser\/task-focus\.spec\.mjs:77(?::35)?$/);
 assert.equal(sites[0].assertion,'toBeVisible');
 assert.equal(sites[1].location,'browser/task-focus.spec.mjs:81:91');assert.equal(sites[1].assertion,'toBeFocused');
});

test('failure-site extraction rejects traversal, unknown files and private external paths',async()=>{
 const fixture=example({status:'unexpected',results:[{status:'failed',duration:1,errors:[
  {message:marker,stack:'Error: '+marker+'\n at browser/../../private.env:9:3'},
  {message:marker,stack:'Error: '+marker+'\n at browser/'+marker+'.spec.mjs:9:3'},
  {message:marker,location:{file:'/private/'+marker+'.txt',line:1,column:1}},
  {message:marker,location:{file:testFile,line:-1,column:1}},
  {message:marker,location:{file:testFile,line:99999999,column:1}},
 ]}]});
 const result=await summarize(fixture);assert.equal(result.exit,1);
 assert(result.output.tests[0].results[0].failureSites.every(site=>site.location===null));
});

for(const [name,fixture] of [
 ['zero tests',{config:{rootDir:app},suites:[],errors:[]}],
 ['a skipped test',example({status:'skipped',results:[{status:'skipped',duration:0}]})],
 ['an expected test with no result',example({results:[]})],
 ['a retry that hides an earlier failure',example({results:[{status:'failed',duration:1,errors:[{message:marker}]},{status:'passed',duration:1}]})],
 ['a global infrastructure failure',{...example(),errors:[{message:marker,stack:marker}]}],
])test('safe QA summary fails closed for '+name,async()=>{
 const result=await summarize(fixture);assert.equal(result.exit,1);assert.notEqual(result.output.status,'passed');
});

for(const [name,options] of [['missing',{missing:true}],['malformed',{raw:'{invalid-json'}],['null',{raw:'null'}]]){
 test('safe QA summary marks a '+name+' report incomplete without inventing a pass',async()=>{
  const result=await summarize(undefined,options);assert.equal(result.exit,1);assert.equal(result.output.status,'incomplete');
 });
}
