const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function instance({list=false}={}){
  let report;const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'safe-reporter.cjs'),'utf8'),{module,exports:module.exports,__dirname:'/isolated/e2e',Date,process:{argv:list?['node','playwright','--list']:['node','playwright'],stdout:{write(){}}},require:name=>name==='node:path'?path:name==='node:fs'?{mkdirSync(){},writeFileSync(_path,bytes){report=JSON.parse(bytes);}}:undefined});
  return {reporter:new module.exports(),report:()=>report};
}
test('discovery and zero execution cannot be reported as successful verified browser coverage',()=>{
  for(const list of [false,true]){const f=instance({list});f.reporter.onBegin({}, {allTests:()=>Array(12)});const override=f.reporter.onEnd({status:'passed'});assert.equal(f.report().status,'not_run');assert.equal(f.report().coverageComplete,false);assert.equal(f.report().executed,0);assert.equal(f.report().scope.authenticatedWorkspaceObserved,false);if(!list)assert.equal(override.status,'failed');}
});
test('partial coverage or skipped tests fail the completion gate',()=>{
  const f=instance();f.reporter.onBegin({}, {allTests:()=>Array(12)});for(let n=0;n<11;n++)f.reporter.onTestEnd({title:'AUTH_ROLE',annotations:[]},{status:'passed',duration:10,retry:0});f.reporter.onTestEnd({title:'UNEXECUTED',annotations:[]},{status:'skipped',duration:0,retry:0});assert.equal(f.reporter.onEnd({status:'passed'}).status,'failed');assert.equal(f.report().status,'incomplete');assert.equal(f.report().coverageComplete,false);
});
test('complete coverage retains only allowlisted evidence and never raw errors or request data',()=>{
  const f=instance(),ids=f.reporter.constructor.requiredCaseIds;f.reporter.onBegin({}, {allTests:()=>Array(ids.length)});for(const id of ids)f.reporter.onTestEnd({title:id+' safe static title',annotations:[{type:'nam-stage',description:'authenticated_workspace'}]},{status:'passed',duration:12,retry:0,error:{message:'DO_NOT_RETAIN_PASSWORD'},stdout:['DO_NOT_RETAIN_TOKEN']});assert.equal(f.reporter.onEnd({status:'passed'}),undefined);const report=f.report(),bytes=JSON.stringify(report);assert.equal(report.coverageComplete,true);assert.equal(report.status,'passed');assert.equal(report.scope.authenticatedWorkspaceObserved,true);assert(!bytes.includes('DO_NOT_RETAIN'));assert.equal(report.scope.liveNAMInfrastructureVerified,false);
});
test('a missing concurrency specification cannot be hidden by twelve passing UI tests',()=>{
  const f=instance(),ids=f.reporter.constructor.requiredCaseIds.filter(id=>id!=='CONCURRENCY_8USERS');f.reporter.onBegin({}, {allTests:()=>Array(ids.length)});for(const id of ids)f.reporter.onTestEnd({title:id,annotations:[]},{status:'passed',duration:1,retry:0});assert.equal(f.reporter.onEnd({status:'passed'}).status,'failed');assert.equal(f.report().coverageComplete,false);assert.deepEqual(f.report().missingRequired,['CONCURRENCY_8USERS']);
});
test('numeric performance evidence accepts only finite bounded metrics from the fixed allowlist',()=>{
  const f=instance();f.reporter.onBegin({}, {allTests:()=>Array(13)});f.reporter.onTestEnd({title:'CONCURRENCY safe static title',annotations:[{type:'nam-metric',description:'mutation_p95_ms=135.45'},{type:'nam-metric',description:'visible_leaks=0'},{type:'nam-metric',description:'token=123456'},{type:'nam-metric',description:'cohort_ms=Infinity'},{type:'nam-metric',description:'read_requests=9999999999999999999'}]},{status:'passed',duration:100,retry:0});f.reporter.onEnd({status:'failed'});assert.deepEqual(f.report().tests[0].metrics,{mutation_p95_ms:135.45,visible_leaks:0});assert(!JSON.stringify(f.report()).includes('123456'));
});
