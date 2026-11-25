// Retain only status counts and real checked-in assertion locations. Report
// messages, DOM, screenshots, profiles, credentials and logs stay private.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
const root=process.env.NAM_QA_ROOT;
if(!root)throw Error('An explicit isolated QA directory is required.');
const known=new Map();
for(const file of await readdir(resolve('browser'))){
 if(!/^[a-z0-9-]+\.spec\.mjs$/.test(file))continue;
 known.set('browser/'+file,(await readFile(resolve('browser',file),'utf8')).split('\n').length);
}
const lineNumber=(file,line)=>Number.isInteger(Number(line))&&Number(line)>0&&Number(line)<=known.get(file)?Number(line):null;
function sourceFile(file,base=process.cwd()){
 if(typeof file!=='string')return null;
 const path=relative(process.cwd(),resolve(base,file));
 return /^browser\/[a-z0-9-]+\.spec\.mjs$/.test(path)&&known.has(path)?path:null;
}
const safeFailure=error=>{
 let file=sourceFile(error?.location?.file),line=lineNumber(file,error?.location?.line),column=Number(error?.location?.column);
 if(!file||!line){const match=String(error?.stack||'').match(/(?:^|[\s(])(browser\/[a-z0-9-]+\.spec\.mjs):(\d+):(\d+)/m);file=match?sourceFile(match[1]):null;line=lineNumber(file,match?.[2]);column=Number(match?.[3]);}
 const location=file&&line?file+':'+line+(Number.isInteger(column)&&column>0&&column<100000?':'+column:''):null;
 const message=String(error?.message||'').replace(/\u001b\[[0-9;]*m/g,''),assertion=message.match(/\b(toBeVisible|toBeFocused|toHaveValue|toBeChecked|toBeEnabled|toHaveText|toContainText|toEqual|toBe|toHaveCount)\b/)?.[1]||null;
 // For an exact HTTP creation assertion, retain only bounded numeric codes.
 // Never include response bodies, assertion diffs or arbitrary error messages.
 const expected=message.match(file==='browser/client-reviews.spec.mjs'?/^Expected:\s*(200|201|202|400|401|403|404|409|429|503)\s*$/m:/^Expected:\s*(201)\s*$/m),received=message.match(/^Received:\s*([1-5][0-9]{2})\s*$/m);
 // Image-workspace diagnostics may retain only bounded dimensions/status codes
 // or scalar types. Record identities, titles, DOM and error text stay private.
 let imageAssertion;
 if(file==='browser/project-deliverables.spec.mjs'&&assertion==='toBe'){
  const left=message.match(/^Expected:\s*(.+?)\s*$/m)?.[1],right=message.match(/^Received:\s*(.+?)\s*$/m)?.[1];
  const shape=value=>['null','undefined','true','false'].includes(value)?value:/^["']?[\da-f]{8}-[\da-f-]{27}["']?$/i.test(value||'')?'record-id':'redacted';
  if(['200','374','480'].includes(left)&&/^\d{1,4}$/.test(right||''))imageAssertion={expected:Number(left),received:Number(right)};
  else if(left&&right)imageAssertion={expectedShape:shape(left),receivedShape:shape(right)};
 }
 return {location,assertion,...(location&&assertion==='toBe'&&expected&&received?{httpStatus:{expected:Number(expected[1]),received:Number(received[1])}}:{}),...(imageAssertion?{imageAssertion}:{})};
};
// Performance evidence is a numeric allowlist bound to this exact CI source.
// No user labels, endpoints, raw timings, errors or arbitrary evidence fields
// may cross this boundary.
function safePerformance(value){
 const commit=process.env.GITHUB_SHA;
 if(!/^[a-f0-9]{40}$/i.test(commit||'')||value?.commit!==commit||value.identities!==8||value.loadTasks!==10000)return null;
 const metric=value=>{
  if(!value||!Number.isInteger(value.samples)||value.samples<1||value.samples>1000000)return null;
  const keys=['p50_ms','p95_ms','max_ms'];
  if(keys.some(key=>typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<0||value[key]>=3600000))return null;
  if(value.p50_ms>value.p95_ms||value.p95_ms>value.max_ms)return null;
  return Object.fromEntries(['samples',...keys].map(key=>[key,value[key]]));
 };
 const keys=['httpReads','httpWriteIncludingContextRefresh','dailyBrief','eightConcurrentBrowserWorkspaces'];
 const metrics=Object.fromEntries(keys.map(key=>[key,metric(value[key])]));
 if(Object.values(metrics).some(value=>!value)||!Number.isInteger(value.maximumSummaryBytes)||value.maximumSummaryBytes<1||value.maximumSummaryBytes>10000000)return null;
 return {protocol:'loopback-bounded-eight-user-v1',identities:8,loadTasks:10000,...metrics,maximumSummaryBytes:value.maximumSummaryBytes};
}
let report;
try{report=JSON.parse(await readFile(resolve(root,'browser-results.json'),'utf8'));if(!report||typeof report!=='object'||Array.isArray(report)||!Array.isArray(report.suites)||!Array.isArray(report.errors))throw Error('Invalid report');}
catch{const result={status:'incomplete',reason:'The native suite did not produce a complete report.',commit:/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA||'')?process.env.GITHUB_SHA:null};await mkdir(root,{recursive:true});await writeFile(resolve(root,'safe-summary.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));process.exitCode=1;report=null;}
if(report){
 const tests=[];
 const visit=suite=>{
  for(const spec of Array.isArray(suite.specs)?suite.specs:[])for(const test of Array.isArray(spec.tests)?spec.tests:[]){
   const file=sourceFile(spec.file||suite.file,report.config?.rootDir||process.cwd());
   tests.push({file,line:lineNumber(file,spec.line),status:['expected','unexpected','skipped','flaky'].includes(test.status)?test.status:'unknown',results:(Array.isArray(test.results)?test.results:[]).map(result=>({status:['passed','failed','timedOut','skipped','interrupted'].includes(result.status)?result.status:'unknown',duration:Number.isFinite(result.duration)&&result.duration>=0&&result.duration<3600000?result.duration:null,...(result.status==='failed'?{failureSites:(Array.isArray(result.errors)?result.errors:[]).slice(0,5).map(safeFailure)}:{})}))});
  }
  for(const child of Array.isArray(suite.suites)?suite.suites:[])visit(child);
 };
 for(const suite of report.suites)visit(suite);
 const passed=test=>test.status==='expected'&&test.file&&test.line&&test.results.length&&test.results.every(result=>result.status==='passed');
 const incomplete=tests.length===0||tests.some(test=>!passed(test))||report.errors.length>0;
 const performanceRequired=tests.some(test=>test.file==='browser/performance.spec.mjs'&&passed(test));
 let performanceEvidence=null;
 if(performanceRequired){try{performanceEvidence=safePerformance(JSON.parse(await readFile(resolve(root,'performance.json'),'utf8')));}catch{}}
 const evidenceIncomplete=performanceRequired&&!performanceEvidence;
 const result={status:incomplete||evidenceIncomplete?'failed_or_incomplete':'passed',commit:/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA||'')?process.env.GITHUB_SHA:null,counts:{total:tests.length,passed:tests.filter(passed).length,unexpected:tests.filter(test=>test.status==='unexpected').length,skipped:tests.filter(test=>test.status==='skipped').length,globalErrors:report.errors.length},...(performanceRequired?{performance:performanceEvidence,evidenceIncomplete}:{}),tests};
 await writeFile(resolve(root,'safe-summary.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:result.status,commit:result.commit,counts:result.counts,...(performanceEvidence?{performance:performanceEvidence}:{}),failedTests:tests.filter(test=>!passed(test))}));if(incomplete||evidenceIncomplete)process.exitCode=1;
}
