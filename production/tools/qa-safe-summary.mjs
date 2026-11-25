// Only aggregate status and checked-in test locations leave the isolated QA
// directory. Never publish errors, screenshots, Auth state, profiles or logs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';

const root=process.env.NAM_QA_ROOT;
if(!root)throw Error('An explicit isolated QA directory is required.');
let report;
try{report=JSON.parse(await readFile(resolve(root,'browser-results.json'),'utf8'));}
catch{const result={status:'incomplete',reason:'The native suite did not produce a complete report.',commit:process.env.GITHUB_SHA||null};await mkdir(root,{recursive:true});await writeFile(resolve(root,'safe-summary.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));process.exitCode=1;}
if(report){
 const tests=[];
 const visit=suite=>{for(const spec of suite.specs||[])for(const test of spec.tests||[])tests.push({file:relative(process.cwd(),resolve(report.config?.rootDir||process.cwd(),spec.file||suite.file||'')),line:spec.line,status:test.status,results:(test.results||[]).map(result=>({status:result.status,duration:result.duration}))});for(const child of suite.suites||[])visit(child);};
 for(const suite of report.suites||[])visit(suite);
 const incomplete=tests.length===0||tests.some(test=>test.status!=='expected'||!test.results.length||test.results.some(result=>result.status!=='passed'))||(report.errors||[]).length>0;
 const result={status:incomplete?'failed_or_incomplete':'passed',commit:process.env.GITHUB_SHA||null,counts:{total:tests.length,passed:tests.filter(test=>test.status==='expected'&&test.results.every(result=>result.status==='passed')).length,unexpected:tests.filter(test=>test.status==='unexpected').length,skipped:tests.filter(test=>test.status==='skipped').length,globalErrors:(report.errors||[]).length},tests};
 await writeFile(resolve(root,'safe-summary.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:result.status,commit:result.commit,counts:result.counts}));if(incomplete)process.exitCode=1;
}
