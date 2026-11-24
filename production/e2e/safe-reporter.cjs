const fs=require('node:fs');
const path=require('node:path');
const metricPattern=/^(bootstrap_p95_ms|mutation_p95_ms|read_p95_ms|concurrent_writes|read_requests|write_requests|visible_leaks|conflicts|cohort_ms)=(\d+(?:\.\d+)?)$/;

// Deliberately exclude raw errors, call logs, stdout/stderr, DOM snapshots,
// request data, account manifests, cookies and authentication screenshots.
class SafeReporter{
  static requiredCaseIds=Object.freeze(['AUTH_FOUNDER','AUTH_SALES_MANAGER','AUTH_SALES_1','AUTH_SALES_2','AUTH_PRODUCTION_MANAGER','AUTH_ARTIST_1','AUTH_ARTIST_2','AUTH_FREELANCER','TASK_LIFECYCLE','TASK_FAILURES','ACADEMY_LIFECYCLE','RESPONSIVE_KEYBOARD','CONCURRENCY_8USERS']);
  constructor(){this.results=[];this.started=Date.now();this.discovered=0;this.listOnly=process.argv.includes('--list');}
  onBegin(config,suite){this.discovered=suite.allTests().length;}
  onStdOut(){}
  onStdErr(){}
  onTestEnd(test,result){
    const id=/^([A-Z0-9_-]+)/.exec(test.title)?.[1]||'UNKNOWN_TEST';
    const stage=[...test.annotations].reverse().find(a=>a.type==='nam-stage'&&/^[a-z0-9_-]{1,80}$/.test(a.description||''))?.description||'not_started';
    const authenticated=test.annotations.some(a=>a.type==='nam-stage'&&a.description==='authenticated_workspace');
    const metrics={};for(const annotation of test.annotations){const match=annotation.type==='nam-metric'&&metricPattern.exec(annotation.description||'');if(match&&Number.isFinite(Number(match[2]))&&Number(match[2])<=1e9)metrics[match[1]]=Number(match[2]);}
    this.results.push({id,status:result.status,durationMs:Math.round(result.duration),attempt:result.retry,stage,authenticatedWorkspaceObserved:authenticated,...(Object.keys(metrics).length?{metrics}:{})});
  }
  onEnd(result){
    const counts={passed:0,failed:0,timedOut:0,skipped:0,interrupted:0};
    for(const row of this.results)if(Object.hasOwn(counts,row.status))counts[row.status]++;
    const executed=counts.passed+counts.failed+counts.timedOut+counts.interrupted;
    const passedIds=new Set(this.results.filter(row=>row.status==='passed').map(row=>row.id)),missingRequired=SafeReporter.requiredCaseIds.filter(id=>!passedIds.has(id));
    const complete=!this.listOnly&&result.status==='passed'&&this.discovered>=SafeReporter.requiredCaseIds.length&&missingRequired.length===0&&counts.passed===this.discovered&&executed===this.discovered;
    const status=this.listOnly||executed===0?'not_run':result.status==='passed'&&!complete?'incomplete':result.status;
    const report={version:1,suite:'NAM OS isolated Supabase and Next browser QA',status,runnerStatus:result.status,coverageComplete:complete,discovered:this.discovered,executed,missingRequired,elapsedMs:Date.now()-this.started,counts,tests:this.results,scope:{intendedTarget:'isolated Supabase and Next',authenticatedWorkspaceObserved:this.results.some(row=>row.authenticatedWorkspaceObserved),thirdPartyServicesVerified:false,liveNAMInfrastructureVerified:false,trace:false,video:false,authScreenshots:false,storageState:false}};
    const directory=path.join(__dirname,'.runtime');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'safe-results.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(`NAM browser QA: ${status}; ${counts.passed} passed, ${counts.failed+counts.timedOut+counts.interrupted} failed, ${counts.skipped} skipped. Sanitized results saved.\n`);
    if(!this.listOnly&&result.status==='passed'&&!complete)return {status:'failed'};
  }
}
module.exports=SafeReporter;
