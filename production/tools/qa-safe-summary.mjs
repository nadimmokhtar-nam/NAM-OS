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
 return {location,assertion:String(error?.message||'').match(/\b(toBeVisible|toBeFocused|toHaveValue|toBeChecked|toBeEnabled|toHaveText|toContainText|toEqual|toBe|toHaveCount)\b/)?.[1]||null};
};
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
 const result={status:incomplete?'failed_or_incomplete':'passed',commit:/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA||'')?process.env.GITHUB_SHA:null,counts:{total:tests.length,passed:tests.filter(passed).length,unexpected:tests.filter(test=>test.status==='unexpected').length,skipped:tests.filter(test=>test.status==='skipped').length,globalErrors:report.errors.length},tests};
 await writeFile(resolve(root,'safe-summary.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:result.status,commit:result.commit,counts:result.counts,failedTests:tests.filter(test=>!passed(test))}));if(incomplete)process.exitCode=1;
}
