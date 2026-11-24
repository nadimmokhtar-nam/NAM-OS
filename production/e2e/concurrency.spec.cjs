const {test,expect}=require('@playwright/test');
const {performance}=require('node:perf_hooks');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

const KEYS=['founder','sales_manager','sales_1','sales_2','production_manager','artist_1','artist_2','freelancer'];
const SECTIONS={founder:'team',sales_manager:'sales',sales_1:'sales',sales_2:'sales',production_manager:'projects',artist_1:'library',artist_2:'academy',freelancer:'operations'};
const ROLES={founder:'founder',sales_manager:'sales_manager',sales_1:'sales',sales_2:'sales',production_manager:'production_manager',artist_1:'artist',artist_2:'artist',freelancer:'freelancer'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let helpers,fixture;
function stage(info,value){info.annotations.push({type:'nam-stage',description:value});}
function metric(info,key,value){if(!Number.isFinite(value)||value<0)throw new Error('A safe numeric concurrency measurement is invalid.');info.annotations.push({type:'nam-metric',description:`${key}=${Math.round(value*100)/100}`});}
function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil((sorted.length-1)*p)]||0;}

test.beforeAll(async()=>{
 helpers=await import(pathToFileURL(path.join(__dirname,'auth-helpers.mjs')).href);
 fixture=await helpers.loadFixtures();helpers.localURL(fixture.baseURL);helpers.localURL(fixture.supabase.url);
 if(new URL(fixture.baseURL).origin!==new URL(process.env.NAM_E2E_BASE_URL||'http://127.0.0.1:3000').origin)throw new Error('Concurrency tests require the same isolated app origin as the private fixture.');
 if(!UUID.test(fixture.workspaceId)||!UUID.test(fixture.otherWorkspaceId)||fixture.workspaceId===fixture.otherWorkspaceId||!UUID.test(fixture.otherTaskId||''))throw new Error('The isolated cross-workspace concurrency fixture is incomplete.');
 expect(Object.keys(fixture.accounts).sort()).toEqual([...KEYS].sort());
 expect(new Set(KEYS.map(key=>fixture.accounts[key].id)).size).toBe(8);
});

test('CONCURRENCY_8USERS real HTTP role-isolated writes, repeated actions and stale editors',async({},info)=>{
 test.setTimeout(120000);
 const prefix=`QA-concurrency-${randomUUID()}`,sessions=new Map(),created=new Set(),tasks=[],reads=[],writes=[],bootstrapTimes=[];
 let pendingMutations=0,peakMutations=0,writeRequests=0,readRequests=0,cohortMs=0,conflicts=0,visibleLeaks=0,workloadPeak=0,cleanupFailures=0,workloadComplete=false;
 async function api(session,endpoint,{method='GET',body,headers={}}={}){
  const mutation=!['GET','HEAD'].includes(method),start=performance.now();
  if(mutation){writeRequests++;pendingMutations++;peakMutations=Math.max(peakMutations,pendingMutations);}else readRequests++;
  try{
   const response=await session.request.fetch(endpoint,{method,timeout:10000,maxRedirects:0,headers:mutation?{Origin:fixture.baseURL,'Content-Type':'application/json','X-CSRF-Token':session.csrf,...headers}:headers,...(body===undefined?{}:{data:body})});
   let data=null;try{data=await response.json();}catch{/* Assert status/required DTOs; never print raw response bodies. */}
   return {status:response.status(),data};
  }finally{(mutation?writes:reads).push(performance.now()-start);if(mutation)pendingMutations--;}
 }
 const owner=()=>sessions.get('founder');
 try{
  stage(info,'prepare_eight_real_sessions');
  // Authentication setup is not represented as the concurrency measurement.
  // Each result is a real GoTrue-managed identity/SSR cookie jar; no service
  // role, test bypass, saved storageState or PGlite connection serves requests.
  const opened=await Promise.allSettled(KEYS.map(key=>helpers.openAPIAccount(fixture,key)));
  for(let i=0;i<opened.length;i++)if(opened[i].status==='fulfilled')sessions.set(KEYS[i],opened[i].value);
  expect(opened.every(result=>result.status==='fulfilled')).toBe(true);
  const bootstraps=await Promise.all(KEYS.map(async key=>{const start=performance.now(),result=await api(sessions.get(key),'/api/bootstrap');bootstrapTimes.push(performance.now()-start);return {key,...result};}));
  for(const result of bootstraps){expect(result.status).toBe(200);expect(result.data?.mode).toBe('authenticated');expect(result.data?.capabilities?.database).toBe('postgresql');expect(result.data?.securityRequired).toBe(false);expect(result.data?.actor?.id).toBe(fixture.accounts[result.key].id);expect(result.data?.actor?.role).toBe(ROLES[result.key]);}
  stage(info,'eight_sessions_authenticated');

  stage(info,'create_sixteen_permissioned_tasks');
  const assignments=KEYS.flatMap(key=>[0,1].map(slot=>({key,slot}))),createdResponses=await Promise.allSettled(assignments.map(({key,slot})=>api(owner(),'/api/tasks',{method:'POST',headers:{'Idempotency-Key':`${prefix}-${key}-${slot}`},body:{title:`${prefix} ${key} ${slot}`,description:'Isolated synthetic HTTP concurrency work; no client information.',section:SECTIONS[key],owner_id:fixture.accounts[key].id,status:'Todo',priority:'Normal'}})));
  for(const result of createdResponses)if(result.status==='fulfilled'&&result.value.status===201&&result.value.data?.id)created.add(result.value.data.id);
  for(let i=0;i<createdResponses.length;i++){const result=createdResponses[i];expect(result.status).toBe('fulfilled');expect(result.value.status).toBe(201);expect(UUID.test(result.value.data?.id||'')).toBe(true);tasks.push({...assignments[i],record:result.value.data});}
  expect(created.size).toBe(16);

  stage(info,'parallel_eight_session_reads');
  const firstReads=await Promise.all(tasks.map(async item=>({item,...await api(sessions.get(item.key),'/api/tasks/'+item.record.id)})));
  for(const result of firstReads){expect(result.status).toBe(200);expect(result.data?.owner_id).toBe(fixture.accounts[result.item.key].id);}

  stage(info,'parallel_eight_session_mutations');
  expect(pendingMutations).toBe(0);peakMutations=0;
  const cohortStart=performance.now(),progress=await Promise.all(tasks.map(item=>api(sessions.get(item.key),'/api/tasks/'+item.record.id,{method:'PATCH',body:{expectedVersion:item.record.version,changes:{status:'In progress'}}})));
  cohortMs=performance.now()-cohortStart;
  for(let i=0;i<progress.length;i++){expect(progress[i].status).toBe(200);expect(progress[i].data?.status).toBe('In progress');expect(progress[i].data?.version).toBe(tasks[i].record.version+1);tasks[i].record=progress[i].data;}
  // There are two requests per distinct user. All eight sessions issue their
  // own HTTP writes before the Promise.all cohort resolves; this does not claim
  // that one Postgres worker executes all SQL statements simultaneously.
  expect(peakMutations).toBeGreaterThanOrEqual(8);

  stage(info,'parallel_comments_and_persistence');
  const comments=await Promise.all(tasks.map(item=>api(sessions.get(item.key),'/api/tasks/'+item.record.id+'/comments',{method:'POST',body:{body:`Synthetic update by ${item.key}; record ${item.slot}.`}})));
  for(const result of comments)expect(result.status).toBe(201);
  const saved=await Promise.all(tasks.map(item=>api(sessions.get(item.key),'/api/tasks/'+item.record.id)));
  for(let i=0;i<saved.length;i++){const result=saved[i],item=tasks[i];expect(result.status).toBe(200);expect(result.data?.status).toBe('In progress');expect(result.data?.comments?.some(comment=>comment.author_id===fixture.accounts[item.key].id&&comment.body===`Synthetic update by ${item.key}; record ${item.slot}.`)).toBe(true);}
  const edited=await Promise.all(tasks.map(item=>api(sessions.get(item.key),'/api/tasks/'+item.record.id,{method:'PATCH',body:{expectedVersion:item.record.version,changes:{priority:'High'}}})));
  for(let i=0;i<edited.length;i++){expect(edited[i].status).toBe(200);expect(edited[i].data?.priority).toBe('High');tasks[i].record=edited[i].data;}
  const completed=await Promise.all(tasks.map(item=>api(sessions.get(item.key),'/api/tasks/'+item.record.id,{method:'PATCH',body:{expectedVersion:item.record.version,changes:{status:'Done'}}})));
  for(let i=0;i<completed.length;i++){expect(completed[i].status).toBe(200);expect(completed[i].data?.status).toBe('Done');expect(completed[i].data?.completed_at).toBeTruthy();tasks[i].record=completed[i].data;}

  stage(info,'role_and_real_cross_workspace_denials');
  const lists=await Promise.all(KEYS.map(key=>api(sessions.get(key),'/api/tasks?page=1&page_size=100&search='+encodeURIComponent(prefix))));
  for(let i=0;i<lists.length;i++){const result=lists[i],key=KEYS[i];expect(result.status).toBe(200);expect(result.data?.items?.length).toBeLessThanOrEqual(100);if(key!=='founder'){const leaks=result.data.items.filter(row=>row.owner_id!==fixture.accounts[key].id);visibleLeaks+=leaks.length;expect(leaks.length).toBe(0);expect(result.data.total).toBe(2);}}
  const ownerDenied=await Promise.all(KEYS.filter(key=>key!=='founder').map(key=>api(sessions.get(key),'/api/tasks/'+tasks.find(item=>item.key==='founder').record.id)));
  for(const result of ownerDenied){if(result.status===200)visibleLeaks++;expect([403,404]).toContain(result.status);}
  // Provisioning created this real record under the other isolated workspace.
  // It is not a guessed missing UUID, and the app's selected workspace remains
  // fixed even for the founder who also owns that second synthetic workspace.
  const foreignDenied=await Promise.all(KEYS.map(key=>api(sessions.get(key),'/api/tasks/'+fixture.otherTaskId)));
  for(const result of foreignDenied){if(result.status===200)visibleLeaks++;expect([403,404]).toContain(result.status);}

  stage(info,'parallel_retry_keys_and_stale_editors');
  const retryTitle=`${prefix} duplicate`,retryKey=`${prefix}-retry`,retryBody={title:retryTitle,section:'operations',owner_id:fixture.accounts.freelancer.id},offers=await Promise.allSettled(Array.from({length:8},()=>api(owner(),'/api/tasks',{method:'POST',headers:{'Idempotency-Key':retryKey},body:retryBody})));
  for(const result of offers)if(result.status==='fulfilled'&&result.value.status===201&&result.value.data?.id)created.add(result.value.data.id);
  for(const result of offers){expect(result.status).toBe('fulfilled');expect(result.value.status).toBe(201);}
  expect(new Set(offers.map(result=>result.value.data.id)).size).toBe(1);
  const changed=await api(owner(),'/api/tasks',{method:'POST',headers:{'Idempotency-Key':retryKey},body:{...retryBody,title:retryTitle+' changed'}});expect(changed.status).toBe(409);
  const duplicateCount=await api(owner(),'/api/tasks?page=1&page_size=100&search='+encodeURIComponent(retryTitle));expect(duplicateCount.status).toBe(200);expect(duplicateCount.data?.total).toBe(1);
  const target=tasks.find(item=>item.key==='sales_1'),snapshotVersion=target.record.version,editors=await Promise.all([api(owner(),'/api/tasks/'+target.record.id,{method:'PATCH',body:{expectedVersion:snapshotVersion,changes:{priority:'Urgent'}}}),api(sessions.get('sales_1'),'/api/tasks/'+target.record.id,{method:'PATCH',body:{expectedVersion:snapshotVersion,changes:{priority:'Low'}}})]);
  expect(editors.filter(result=>result.status===200).length).toBe(1);conflicts=editors.filter(result=>result.status===409).length;expect(conflicts).toBe(1);
  const final=await api(sessions.get('sales_1'),'/api/tasks/'+target.record.id);expect(final.status).toBe(200);expect(final.data?.version).toBe(snapshotVersion+1);expect(final.data?.status).toBe('Done');expect(final.data?.priority).toBe(editors.find(result=>result.status===200).data.priority);

  stage(info,'bounded_http_performance');workloadPeak=peakMutations;
  metric(info,'bootstrap_p95_ms',percentile(bootstrapTimes,.95));metric(info,'mutation_p95_ms',percentile(writes,.95));metric(info,'read_p95_ms',percentile(reads,.95));metric(info,'cohort_ms',cohortMs);metric(info,'concurrent_writes',workloadPeak);metric(info,'visible_leaks',visibleLeaks);metric(info,'conflicts',conflicts);
  expect(visibleLeaks).toBe(0);expect(percentile(reads,.95)).toBeLessThanOrEqual(2000);expect(percentile(writes,.95)).toBeLessThanOrEqual(1000);
  workloadComplete=true;
  stage(info,'concurrent_workflows_verified');
 }finally{
  // Only this fresh loopback workspace and this run's checked IDs are touched.
  // Teardown also destroys the disposable stack; no production cleanup runs.
  if(owner())await Promise.all([...created].map(async taskId=>{try{const current=await api(owner(),'/api/tasks/'+taskId);if(current.status!==200||!current.data?.title?.startsWith(prefix)||current.data?.created_by!==fixture.accounts.founder.id){cleanupFailures++;return;}const removed=await api(owner(),'/api/tasks/'+taskId,{method:'DELETE',body:{expectedVersion:current.data.version}});if(removed.status!==200)cleanupFailures++;}catch{cleanupFailures++;}}));
  metric(info,'read_requests',readRequests);metric(info,'write_requests',writeRequests);
  if(reads.length)metric(info,'read_p95_ms',percentile(reads,.95));if(writes.length)metric(info,'mutation_p95_ms',percentile(writes,.95));
  await Promise.allSettled([...sessions.values()].map(session=>session.dispose()));
  if(cleanupFailures)stage(info,'cleanup_concurrency_records_failed');
  expect(cleanupFailures).toBe(0);
  if(workloadComplete){expect(readRequests+writeRequests).toBeGreaterThanOrEqual(100);expect(readRequests+writeRequests).toBeLessThanOrEqual(200);expect(percentile(reads,.95)).toBeLessThanOrEqual(2000);expect(percentile(writes,.95)).toBeLessThanOrEqual(1000);}
 }
});
