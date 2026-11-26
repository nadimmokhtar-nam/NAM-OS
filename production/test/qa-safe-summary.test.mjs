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

async function summarize(report,{missing=false,raw,performance,layout}={}){
 const root=await mkdtemp(resolve(tmpdir(),'nam-safe-summary-'));
 try{
  if(!missing)await writeFile(resolve(root,'browser-results.json'),raw??JSON.stringify(report),{mode:0o600});
  if(performance!==undefined)await writeFile(resolve(root,'performance.json'),JSON.stringify(performance),{mode:0o600});
  if(layout!==undefined)await writeFile(resolve(root,'secondary-layout.jsonl'),typeof layout==='string'?layout:layout.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
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
test('client email diagnostics retain bounded HTTP codes while discarding messages, mail links and credentials',async()=>{
 const report=example({status:'unexpected',results:[{status:'failed',duration:10,errors:[{message:'expect(received).toBe(expected)\nExpected: 202\nReceived: 503\n'+marker,location:{file:resolve(app,'browser/client-reviews.spec.mjs'),line:24,column:1}}]}]});
 const result=await summarize(report);assert.equal(result.exit,1);
 assert.deepEqual(result.output.tests[0].results[0].failureSites[0].httpStatus,{expected:202,received:503});
});
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

test('timed-out actions retain checked-in sites, known operations and bounded timeout durations without their call logs',async()=>{
 const file=resolve(app,'browser/project-planning.spec.mjs');
 const fixture=example({status:'unexpected',results:[{status:'timedOut',duration:60046,errors:[
  {message:'locator.fill: Test timeout of 60000ms exceeded.\nCall log: '+marker,stack:'TimeoutError: '+marker+'\n    at '+file+':77:61'},
  {message:'expect(locator).toBeDisabled failed '+marker,location:{file,line:77,column:35}},
 ]}]});
 const result=await summarize(fixture);assert.equal(result.exit,1);assert.equal(result.output.status,'failed_or_incomplete');
 assert.deepEqual(result.output.tests[0].results[0].failureSites,[{location:'browser/project-planning.spec.mjs:77:61',assertion:null,operation:'locator.fill',timeoutMs:60000},{location:'browser/project-planning.spec.mjs:77:35',assertion:'toBeDisabled'}]);
});

test('a singular timeout error retains only its known operation and validated source location',async()=>{
 const fixture=example({status:'unexpected',results:[{status:'timedOut',duration:15000,error:{message:'page.waitForResponse: Timeout 15000ms exceeded.\n'+marker,stack:marker+'\n at browser/task-focus.spec.mjs:77:35'}}]});
 const result=await summarize(fixture);assert.equal(result.exit,1);
 assert.deepEqual(result.output.tests[0].results[0].failureSites,[{location:'browser/task-focus.spec.mjs:77:35',assertion:null,operation:'page.waitForResponse',timeoutMs:15000}]);
});

test('timeout diagnostics reject arbitrary operations, unbounded durations and unapproved source paths',async()=>{
 const fixture=example({status:'unexpected',results:[{status:'timedOut',duration:60000,errors:[
  {message:'locator.'+marker+': Test timeout of 9999999ms exceeded.',location:{file:testFile,line:77,column:35}},
  {message:marker+': locator.fill: Test timeout of '+marker+'ms exceeded.',location:{file:testFile,line:77,column:35}},
  {message:'locator.fill: Test timeout of 60000ms exceeded.',stack:'Error: '+marker+'\n at /private/'+marker+'/browser/task-focus.spec.mjs:77:35'},
 ]}]});
 const result=await summarize(fixture);assert.equal(result.exit,1);
 assert(result.output.tests[0].results[0].failureSites.every(site=>!Object.hasOwn(site,'operation')&&!Object.hasOwn(site,'timeoutMs')));
 assert.equal(result.output.tests[0].results[0].failureSites[2].location,null);
});

test('HTTP creation failures expose only valid numeric status codes at a checked-in assertion',async()=>{
 const fixture=example({status:'unexpected',results:[{status:'failed',duration:1,errors:[
  {message:'expect(received).toBe(expected)\nExpected: 201\nReceived: 400\n'+marker,location:{file:testFile,line:77,column:35}},
  {message:'expect(received).toBe(expected)\nExpected: 201\nReceived: '+marker,location:{file:testFile,line:77,column:35}},
  {message:'expect(received).toBe(expected)\nExpected: 201\nReceived: 999',location:{file:testFile,line:77,column:35}},
  {message:'expect(received).toBe(expected)\nExpected: 201\nReceived: 400',location:{file:'/private/'+marker,line:1,column:1}},
 ]}]});
 const result=await summarize(fixture),sites=result.output.tests[0].results[0].failureSites;
 assert.deepEqual(sites[0].httpStatus,{expected:201,received:400});
 assert(sites.slice(1).every(site=>!Object.hasOwn(site,'httpStatus')));
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

test('image diagnostics retain bounded dimensions and scalar shapes while removing all record values',async()=>{
 const file=resolve(app,'browser/project-deliverables.spec.mjs');
 const messages=['Expected: 374\nReceived: 356','Expected: "20000000-0000-4000-8000-000000000001"\nReceived: null','Expected: "'+marker+'"\nReceived: "'+marker+'"'];
 const fixture=example({status:'unexpected',results:[{status:'failed',duration:1,errors:messages.map(message=>({message:'expect(received).toBe(expected)\n'+message,location:{file,line:29,column:56}}))}]});
 const result=await summarize(fixture),sites=result.output.tests[0].results[0].failureSites;
 assert.deepEqual(sites[0].imageAssertion,{expected:374,received:356});assert.deepEqual(sites[1].imageAssertion,{expectedShape:'record-id',receivedShape:'null'});assert.deepEqual(sites[2].imageAssertion,{expectedShape:'redacted',receivedShape:'redacted'});
 assert.equal(JSON.stringify(result.output).includes('20000000-0000-4000-8000-000000000001'),false);
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

test('secondary layout evidence retains only literal routes, viewport sizes and bounded action coordinates',async()=>{
 const file=resolve(app,'browser/secondary-craftsmanship.spec.mjs'),line=(await readFile(file,'utf8')).split('\n').findIndex(value=>value.includes("expect(result.issues,'NAM_SECONDARY_GEOMETRY '"))+1;
 assert(line>0);
 const value={route:'settings',width:768,issues:[{kind:'panel action exceeds content grid',left:245.2,right:542.3,contentRight:510.5,private:marker},{kind:'overlapping actions',i:1,j:2,private:marker}],private:marker};
 const fixture=example({status:'unexpected',results:[{status:'failed',duration:1,errors:[{message:'NAM_SECONDARY_GEOMETRY '+JSON.stringify(value)+'\nexpect(received).toEqual(expected)\n'+marker,location:{file,line,column:4}}]}]});
 const result=await summarize(fixture);
 assert.deepEqual(result.output.tests[0].results[0].failureSites[0].secondaryGeometry,{route:'settings',width:768,issues:[{kind:'panel action exceeds content grid',left:245.2,right:542.3,contentRight:510.5},{kind:'overlapping actions',i:1,j:2}]});
});

test('secondary layout evidence rejects arbitrary text, dimensions and source sites',async()=>{
 const file=resolve(app,'browser/secondary-craftsmanship.spec.mjs'),line=(await readFile(file,'utf8')).split('\n').findIndex(value=>value.includes("expect(result.issues,'NAM_SECONDARY_GEOMETRY '"))+1;
 const valid={route:'settings',width:768,issues:[{kind:'overlapping actions',i:1,j:2}]};
 const fixtures=[{value:{...valid,route:marker}},{value:{...valid,width:999999}},{value:{...valid,issues:[{kind:marker,i:1,j:2}]}},{value:{...valid,issues:[{kind:'panel action exceeds content grid',left:0,right:marker,contentRight:0}]}},{value:valid,site:testFile}];
 const fixture=example({status:'unexpected',results:[{status:'failed',duration:1,errors:fixtures.map(({value,site})=>({message:'NAM_SECONDARY_GEOMETRY '+JSON.stringify(value)+'\nexpect(received).toEqual(expected)',location:{file:site||file,line:site?77:line,column:4}}))}]});
 const result=await summarize(fixture);
 assert(result.output.tests[0].results[0].failureSites.every(site=>!Object.hasOwn(site,'secondaryGeometry')));
 const invalid=example({status:'unexpected',results:[{status:'failed',duration:1,errors:[{message:'NAM_SECONDARY_GEOMETRY '+JSON.stringify({...valid,issues:[{kind:'panel action exceeds content grid',left:NaN,right:20,contentRight:15}]})+'\nexpect(received).toEqual(expected)',location:{file,line,column:4}}]}]});
 const nonFinite=await summarize(invalid);assert.equal('secondaryGeometry' in nonFinite.output.tests[0].results[0].failureSites[0],false);
});


test('secondary geometry diagnostics tolerate only an adjacent source-map offset at the checked-in marker',async()=>{
 const file=resolve(app,'browser/secondary-craftsmanship.spec.mjs'),line=(await readFile(file,'utf8')).split('\n').findIndex(value=>value.includes("expect(result.issues,'NAM_SECONDARY_GEOMETRY '"))+1;
 const {expect}=await import('@playwright/test');let message='';
 const value={route:'settings',width:320,issues:[{kind:'overlapping actions',i:0,j:1}]};
 try{expect(value.issues,'NAM_SECONDARY_GEOMETRY '+JSON.stringify(value)).toEqual([]);}catch(error){message='Error: '+error.message;}
 // The real Playwright JSON reporter serializes this exact Error prefix; a
 // directly caught expect error does not include it. Both shapes are bounded.
 assert(message.startsWith('Error: NAM_SECONDARY_GEOMETRY'));
 const fixture=example({status:'unexpected',results:[{status:'failed',duration:1,errors:[-2,-1,0,1,2].map(offset=>({message,location:{file,line:line+offset,column:4}}))}]});
 const result=await summarize(fixture),sites=result.output.tests[0].results[0].failureSites;
 assert.equal('secondaryGeometry' in sites[0],false);assert.equal('secondaryGeometry' in sites[4],false);
 for(const site of sites.slice(1,4))assert.deepEqual(site.secondaryGeometry,value);
});


function secondaryFailedReport(){const value=example({status:'unexpected',results:[{status:'failed',duration:1,errors:[]}]});value.suites[0].specs[0].file=resolve(app,'browser/secondary-craftsmanship.spec.mjs');value.suites[0].specs[0].line=60;return value;}
const layoutFixture=()=>({commit:'1'.repeat(40),route:'settings',width:320,issues:[{kind:'panel action exceeds content grid',left:20,right:260,contentRight:240,private:marker}],private:marker});
test('independent layout evidence publishes numeric geometry only for the exact source and failed checked-in secondary case',async()=>{
 const value=layoutFixture(),result=await summarize(secondaryFailedReport(),{layout:[value]});
 assert.equal(result.exit,1);assert.equal(result.output.status,'failed_or_incomplete');
 assert.deepEqual(result.output.secondaryLayout,[{route:'settings',width:320,issues:[{kind:'panel action exceeds content grid',left:20,right:260,contentRight:240}]}]);
 assert(result.stdout.includes('secondaryLayout'));
});
test('independent layout evidence rejects stale, malformed, excessive and nonnumeric data',async()=>{
 const invalid=[[{...layoutFixture(),commit:'2'.repeat(40)}],[{...layoutFixture(),route:marker}],[{...layoutFixture(),issues:[{kind:'overlapping actions',i:marker,j:0}]}],Array.from({length:17},layoutFixture),' '.repeat(65537)];
 for(const layout of invalid){const result=await summarize(secondaryFailedReport(),{layout});assert.equal('secondaryLayout' in result.output,false);}
});
test('independent layout evidence is not published for unrelated failures or passing secondary cases',async()=>{
 const unrelated=await summarize(example({status:'unexpected',results:[{status:'failed',duration:1,errors:[]}]}),{layout:[layoutFixture()]});assert.equal('secondaryLayout' in unrelated.output,false);
 const report=secondaryFailedReport();report.suites[0].specs[0].tests[0]={status:'expected',results:[{status:'passed',duration:1}]};
 const passing=await summarize(report,{layout:[layoutFixture()]});assert.equal(passing.exit,0);assert.equal('secondaryLayout' in passing.output,false);
});
