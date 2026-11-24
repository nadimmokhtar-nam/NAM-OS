const fs=require('node:fs');
const path=require('node:path');
const metricPattern=/^(bootstrap_p95_ms|mutation_p95_ms|read_p95_ms|concurrent_writes|read_requests|write_requests|visible_leaks|conflicts|cohort_ms)=(\d+(?:\.\d+)?)$/;
const safeFiles=new Set(['browser.spec.cjs','concurrency.spec.cjs','auth-helpers.mjs']);
const matcherPattern=/\b(toBe|toEqual|toStrictEqual|toBeVisible|toHaveText|toContainText|toHaveValue|toHaveAttribute|toHaveJSProperty|toHaveCount|toBeChecked|toBeFocused|toBeEmpty|toBeLessThanOrEqual|toMatch|toBeNull)\b/;
const dirtyFields=new Set(['title','description','section','status','priority','due_date','owner_id']);
const dirtyProbeFlags=new Set(['task_fields_match_saved','unsubmitted_comment_present','unsubmitted_subtask_present','empty_file_timestamp_changed','empty_file_timestamp_stable','no_file_control','selected_file_present']);
const dialogKinds=new Set(['confirm','alert','prompt','beforeunload']);
function safeFailure(error,step){
  if(!error)return undefined;
  const message=typeof error.message==='string'?error.message.slice(0,4000):'',title=typeof step?.title==='string'?step.title.slice(0,500):'';
  const kind=/\b(?:TimeoutError|Timed out|Timeout \d+ms)\b/.test(message)?'timeout':step?.category==='expect'||/\b(?:expect\(|AssertionError)\b/.test(message)?'assertion':step?.category==='pw:api'?'browser_action':'unknown';
  const matcher=matcherPattern.exec(title)?.[1]||matcherPattern.exec(message)?.[1];
  let location=error.location||step?.location;
  if(!location&&typeof error.stack==='string'){const match=/(?:[/\\])(browser\.spec\.cjs|concurrency\.spec\.cjs|auth-helpers\.mjs):([1-9]\d{0,4}):([1-9]\d{0,4})(?=[)\s]|$)/.exec(error.stack);if(match)location={file:match[1],line:Number(match[2]),column:Number(match[3])};}
  const file=typeof location?.file==='string'?path.basename(location.file):'';
  const source=safeFiles.has(file)&&Number.isInteger(location.line)&&location.line>0&&location.line<=20000&&Number.isInteger(location.column)&&location.column>0&&location.column<=20000?{file,line:location.line,column:location.column}:undefined;
  return {kind,...(matcher?{matcher}:{}),...(source?{source}:{})};
}

// Deliberately exclude raw errors, call logs, stdout/stderr, DOM snapshots,
// request data, account manifests, cookies and authentication screenshots.
class SafeReporter{
  static requiredCaseIds=Object.freeze(['AUTH_FOUNDER','AUTH_SALES_MANAGER','AUTH_SALES_1','AUTH_SALES_2','AUTH_PRODUCTION_MANAGER','AUTH_ARTIST_1','AUTH_ARTIST_2','AUTH_FREELANCER','TASK_LIFECYCLE','TASK_FAILURES','ACADEMY_LIFECYCLE','RESPONSIVE_KEYBOARD','CONCURRENCY_8USERS']);
  constructor(){this.results=[];this.started=Date.now();this.discovered=0;this.listOnly=process.argv.includes('--list');this.failures=new WeakMap();}
  onBegin(config,suite){this.discovered=suite.allTests().length;}
  onStdOut(){}
  onStdErr(){}
  onStepEnd(test,result,step){if(step.error&&!this.failures.has(result))this.failures.set(result,safeFailure(step.error,step));}
  onTestEnd(test,result){
    const id=/^([A-Z0-9_-]+)/.exec(test.title)?.[1]||'UNKNOWN_TEST';
    const stage=[...test.annotations].reverse().find(a=>a.type==='nam-stage'&&/^[a-z0-9_-]{1,80}$/.test(a.description||''))?.description||'not_started';
    const authenticated=test.annotations.some(a=>a.type==='nam-stage'&&a.description==='authenticated_workspace');
    const metrics={};for(const annotation of test.annotations){const match=annotation.type==='nam-metric'&&metricPattern.exec(annotation.description||'');if(match&&Number.isFinite(Number(match[2]))&&Number(match[2])<=1e9)metrics[match[1]]=Number(match[2]);}
    const changedFields=[...new Set(test.annotations.filter(a=>a.type==='nam-dirty-field'&&dirtyFields.has(a.description)).map(a=>a.description))],probeFlags=[...new Set(test.annotations.filter(a=>a.type==='nam-dirty-probe'&&dirtyProbeFlags.has(a.description)).map(a=>a.description))],observedDialogs=[...new Set(test.annotations.filter(a=>a.type==='nam-dialog-kind'&&dialogKinds.has(a.description)).map(a=>a.description))];
    const failure=result.status!=='passed'?(this.failures.get(result)||safeFailure(result.error||result.errors?.[0])):undefined;
    this.results.push({id,status:result.status,durationMs:Math.round(result.duration),attempt:result.retry,stage,authenticatedWorkspaceObserved:authenticated,...(failure?{failure}:{}),...(Object.keys(metrics).length?{metrics}:{}),...((changedFields.length||probeFlags.length||observedDialogs.length)?{taskCloseProbe:{changedFields,flags:probeFlags,dialogKinds:observedDialogs}}:{})});
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
