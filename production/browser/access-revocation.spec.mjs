import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServerClient} from '@supabase/ssr';
import {actor,profiles,mutate,qaRoot,origin} from './support.mjs';

const grants=value=>value.map(({section,can_create})=>({section,can_create})).sort((a,b)=>a.section.localeCompare(b.section));
async function access(founder,id){
 const response=await founder.context.request.get('/api/auth/access/'+id);
 expect(response.status(),'The synthetic Founder must read current member access').toBe(200);
 const member=await response.json();expect(member.id).toBe(id);return member;
}
async function changeAccess(founder,id,current,role,nextGrants){
 return mutate(founder.context,'/auth/access/'+id,{expectedRevision:current.revision,role,grants:grants(nextGrants)},'PATCH');
}
async function currentProvider(context,fixture){
 // Reuse this browser's existing managed session. Do not sign in another user,
 // inject service credentials, or contact an arbitrary/hosted provider.
 const runtime=JSON.parse(await readFile(resolve(qaRoot,'runtime.json'),'utf8'));
 const provider=new URL(runtime.NEXT_PUBLIC_SUPABASE_URL);
 if(!['localhost','127.0.0.1'].includes(provider.hostname)||provider.origin!==new URL(fixture.origin).origin||runtime.NAM_WORKSPACE_ID!==fixture.workspace)throw Error('Access-revocation QA refuses a non-isolated provider binding.');
 const key=runtime.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(typeof key!=='string'||!key)throw Error('The isolated public provider binding is unavailable.');
 return createServerClient(provider.origin,key,{cookies:{
  getAll:async()=>context.cookies(),
  setAll:async values=>context.addCookies(values.map(({name,value,options})=>({name,value,url:origin,...(options?.maxAge===0?{expires:0}:{})}))),
 }});
}
async function claimSession(provider,expectedUser){
 const result=await provider.auth.getClaims();
 expect(result.error===null,'Existing managed claims must remain verifiable').toBe(true);
 expect(result.data?.claims.sub===expectedUser,'Direct provider checks must retain the browser identity').toBe(true);
 const session=result.data?.claims.session_id;
 expect(typeof session==='string'&&session.length>0,'Managed session identity must be present').toBe(true);return session;
}

test('an already-open managed session loses Sales access after grant and role changes',async({browser})=>{
 test.setTimeout(120000);
 const fixture=await profiles(),target=fixture.users.find(user=>user.key==='sales_2');
 expect(target?.role).toBe('sales');
 const founder=await actor(browser,'founder'),sales=await actor(browser,'sales_2');
 const marker='[QA access '+randomUUID()+']';let original,restoreNeeded=false,task,activity;
 try{
  original=await access(founder,target.id);expect(original.active).toBe(true);expect(original.editable).toBe(true);expect(original.role).toBe('sales');
  const originalGrants=grants(original.grants);expect(originalGrants.some(g=>g.section==='sales'&&g.can_create)).toBe(true);
  const before=await sales.context.request.get('/api/bootstrap?view=sales');expect(before.status()).toBe(200);
  const baseline=await before.json();expect(baseline.actor.id).toBe(target.id);expect(baseline.sections).toContain('sales');
  const created=await mutate(sales.context,'/tasks',{title:marker+' retained task',description:'The accepted value must survive denied stale writes.',section:'sales'});
  expect(created.status()).toBe(201);task=await created.json();
  const logged=await mutate(sales.context,'/sales/activities',{type:'Research',context:marker+' accepted activity',outcome:'Synthetic baseline for an active-session revocation check.',note:'',occurred_on:baseline.today});
  expect(logged.status()).toBe(201);activity=(await logged.json()).activities.find(row=>row.context===marker+' accepted activity');expect(activity).toBeTruthy();
  const provider=await currentProvider(sales.context,fixture),session=await claimSession(provider,target.id);
  const directBefore=await provider.from('nam_tasks').select('id,description').eq('workspace_id',fixture.workspace).eq('id',task.id);
  expect(directBefore.error===null).toBe(true);expect(directBefore.data).toHaveLength(1);
  // Keep a real Sales draft open while the Founder withdraws its section grant.
  await sales.page.goto('/workspace#sales');
  await sales.page.getByRole('button',{name:'Activities',exact:true}).click();
  await sales.page.getByRole('button',{name:'Log activity',exact:true}).click();
  const dialog=sales.page.getByRole('dialog'),blockedContext=marker+' denied draft';
  await dialog.getByLabel('Company or context',{exact:true}).fill(blockedContext);
  await dialog.getByLabel('Outcome',{exact:true}).fill('This write must be rejected after revocation.');
  restoreNeeded=true;
  const revoked=await changeAccess(founder,target.id,original,original.role,originalGrants.filter(g=>g.section!=='sales'));
  expect(revoked.status()).toBe(200);const restricted=await revoked.json();
  expect(restricted.revision).toBeGreaterThan(original.revision);
  const deniedWrite=sales.page.waitForResponse(response=>response.url().endsWith('/api/sales/activities')&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Save activity',exact:true}).click();
  expect((await deniedWrite).status()).toBe(403);
  await expect(dialog.locator('.form-error')).not.toBeEmpty();
  await expect(dialog.getByLabel('Company or context',{exact:true})).toHaveValue(blockedContext);
  const current=await (await sales.context.request.get('/api/bootstrap?view=sales')).json();
  expect(current.actor.id).toBe(target.id);expect(current.actor.role).toBe('sales');expect(current.sections).not.toContain('sales');expect(current.accessRevision).toBeGreaterThan(baseline.accessRevision);
  // The role is still Sales; its read endpoint is RLS-empty rather than a
  // fabricated authorization failure. No previously readable record may remain.
  const emptyLedgerResponse=await sales.context.request.get('/api/sales');expect(emptyLedgerResponse.status()).toBe(200);
  const emptyLedger=await emptyLedgerResponse.json();expect(emptyLedger.activities).toEqual([]);expect(emptyLedger.reports).toEqual([]);expect(emptyLedger.targets).toEqual([]);expect(emptyLedger.activity_total).toBe(0);
  expect((await sales.context.request.get('/api/tasks/'+task.id)).status()).toBe(404);
  expect((await mutate(sales.context,'/tasks/'+task.id,{expectedVersion:task.version,changes:{description:'Denied stale edit'}},'PATCH')).status()).toBe(404);
  expect((await mutate(sales.context,'/tasks',{title:marker+' denied task',section:'sales'})).status()).toBe(403);
  const directAfter=await provider.from('nam_tasks').select('id').eq('workspace_id',fixture.workspace).eq('id',task.id);
  expect(directAfter.error===null).toBe(true);expect(directAfter.data).toEqual([]);
  const deniedRpc=await provider.rpc('nam_save_task',{w:fixture.workspace,task_id:task.id,expected_version:task.version,changes:{description:'Denied direct edit'}});
  expect(['42501','P0002'].includes(deniedRpc.error?.code)).toBe(true);
  const section=await provider.rpc('nam_section',{w:fixture.workspace,s:'sales'});expect(section.error===null).toBe(true);expect(section.data).toBe(false);
  expect(await claimSession(provider,target.id)===session,'Grant revocation must work without signing out or replacing the original managed session').toBe(true);
  // A role change must be effective with that same JWT too. Retain only
  // existing common grants; this test grants no new project/library access.
  const fresh=await access(founder,target.id),common=originalGrants.filter(g=>['academy','operations'].includes(g.section));
  const changed=await changeAccess(founder,target.id,fresh,'freelancer',common);expect(changed.status()).toBe(200);
  const roleView=await (await sales.context.request.get('/api/bootstrap?view=sales')).json();
  expect(roleView.actor.id).toBe(target.id);expect(roleView.actor.role).toBe('freelancer');expect(roleView.sections).not.toContain('sales');expect(roleView.capabilities.createTaskSections).not.toContain('sales');
  expect((await sales.context.request.get('/api/sales')).status()).toBe(403);
  const directRole=await provider.rpc('nam_role',{w:fixture.workspace});expect(directRole.error===null).toBe(true);expect(directRole.data).toBe('freelancer');
  expect(await claimSession(provider,target.id)===session,'Role changes must be applied from membership state, not stale JWT role assumptions').toBe(true);
  const persisted=await founder.context.request.get('/api/tasks/'+task.id);expect(persisted.status()).toBe(200);
  const saved=await persisted.json();expect(saved.description).toBe(task.description);expect(saved.version).toBe(task.version);
  const founderLedger=await (await founder.context.request.get('/api/sales')).json();
  expect(founderLedger.activities.some(row=>row.id===activity.id)).toBe(true);expect(founderLedger.activities.some(row=>row.context===blockedContext)).toBe(false);
  // No live push is implied: a fresh page must apply the current member role,
  // discard the old in-memory workspace, and remove the revoked navigation.
  sales.page.once('dialog',prompt=>prompt.accept());
  await sales.page.reload();await expect(sales.page.locator('#app .sidebar')).toBeVisible();
  await expect(sales.page.locator('.sidebar .nav-link[href="#sales"]')).toHaveCount(0);
  await expect(sales.page.getByRole('dialog')).not.toBeVisible();
 }finally{
  try{
   if(original&&restoreNeeded){
    const latest=await access(founder,target.id);
    const restored=await changeAccess(founder,target.id,latest,original.role,original.grants);
    expect(restored.status(),'Restore exact synthetic member access using its fresh CAS revision').toBe(200);
    const restoredAccess=await access(founder,target.id);expect(restoredAccess.role).toBe(original.role);expect(grants(restoredAccess.grants)).toEqual(grants(original.grants));
    const restoredSession=await sales.context.request.get('/api/bootstrap?view=sales');expect(restoredSession.status()).toBe(200);
    const restoredData=await restoredSession.json();expect(restoredData.actor.role).toBe(original.role);expect([...restoredData.sections].sort()).toEqual(grants(original.grants).map(g=>g.section).sort());
   }
   // Cleanup only records created by this case; attribution/audit is retained.
   if(task){
    const latestResponse=await founder.context.request.get('/api/tasks/'+task.id);
    expect(latestResponse.status()).toBe(200);const latest=await latestResponse.json();
    expect((await mutate(founder.context,'/tasks/'+task.id,{expectedVersion:latest.version},'DELETE')).status()).toBe(200);
   }
   if(activity)expect((await mutate(founder.context,'/sales/activities/'+activity.id,{expectedVersion:activity.version},'DELETE')).status()).toBe(200);
  }finally{await Promise.all([founder.context.close(),sales.context.close()]);}
 }
});
