import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {actor,profiles,mutate,qaRoot} from './support.mjs';

// Declared before execution. These are bounded interaction/reflow checks on
// isolated native provider software, not Internet latency, FPS or capacity SLAs.
const budget={acknowledgementMs:150,pendingMovementPx:2,overflowPx:1,reducedMotionMs:1,mobileTargetPx:44,focusOutlinePx:2};
async function record(check,values){
 // This optional evidence contains only fixed check names and numeric metrics.
 // No URLs, identities, form values, response bodies, screenshots or sessions.
 await appendFile(resolve(qaRoot,'programa-a11y-performance.safe.jsonl'),JSON.stringify({schema:1,check,...values})+'\n',{mode:0o600});
}
async function ready(page,title){await expect(page.locator('#main h1')).toHaveText(title);await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');}
async function openTask(page,task){
 await page.goto('/workspace#tasks');await ready(page,'Tasks');await page.locator('#task-search').fill(task.title);
 const opener=page.locator('[data-action="open-task"][data-id="'+task.id+'"]');await expect(opener).toBeVisible();await opener.focus();await opener.press('Enter');
 await expect(page.getByRole('dialog')).toBeVisible();return opener;
}
async function pendingProbe(button){
 await button.evaluate(node=>{
  const observation={start:null,ack:null,initial:null};node.__qaPendingObservation=observation;
  node.addEventListener('click',()=>{observation.start=performance.now();const box=node.getBoundingClientRect();observation.initial={x:box.x,y:box.y,width:box.width,height:box.height};},{once:true,capture:true});
  const observer=new MutationObserver(()=>{
   if(observation.start!==null&&observation.ack===null&&(node.disabled||node.getAttribute('aria-busy')==='true')){observation.ack=performance.now();observer.disconnect();}
  });
  observer.observe(node,{attributes:true,attributeFilter:['disabled','aria-busy','aria-disabled']});
 });
}
async function assertPendingBudget(button,check){
 const result=await button.evaluate(node=>{
  const value=node.__qaPendingObservation,box=node.getBoundingClientRect();
  return {started:typeof value?.start==='number',acknowledged:typeof value?.ack==='number',ackMs:value?.ack-value?.start,movement:value?.initial?Math.max(Math.abs(box.x-value.initial.x),Math.abs(box.y-value.initial.y),Math.abs(box.width-value.initial.width),Math.abs(box.height-value.initial.height)):null};
 });
 expect(result.started).toBe(true);expect(result.acknowledged,'The native activation must immediately expose a pending state').toBe(true);
 expect(result.ackMs).toBeLessThanOrEqual(budget.acknowledgementMs);expect(result.movement).toBeLessThanOrEqual(budget.pendingMovementPx);
 await record(check,{acknowledgementMs:+result.ackMs.toFixed(2),pendingMovementPx:+result.movement.toFixed(2)});
}
async function hit(control,{mobile=false}={}){
 await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();
 const result=await control.evaluate(node=>{
  const rect=node.getBoundingClientRect(),target=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,height:rect.height,viewport:innerWidth,viewportHeight:innerHeight,uncovered:target===node||node.contains(target)};
 });
 expect(result.left).toBeGreaterThanOrEqual(-budget.overflowPx);expect(result.right).toBeLessThanOrEqual(result.viewport+budget.overflowPx);
 expect(result.top).toBeGreaterThanOrEqual(-budget.overflowPx);expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight+budget.overflowPx);
 if(mobile)expect(result.height).toBeGreaterThanOrEqual(budget.mobileTargetPx);
 expect(result.uncovered,'The focused action must not be obscured by a sticky rail, notice or footer').toBe(true);
}
async function noOverflow(page,selector='#main'){
 const result=await page.locator(selector).evaluate(node=>({document:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,content:node.scrollWidth,available:node.clientWidth}));
 expect(result.document).toBeLessThanOrEqual(result.viewport+budget.overflowPx);expect(result.content).toBeLessThanOrEqual(result.available+budget.overflowPx);
}

test('Founder external task footer acknowledges a keyboard save while its real response is delayed',async({browser})=>{
 const run=await actor(browser,'founder',{viewport:{width:1440,height:900}}),fixture=await profiles();let task,release,started,patches=0,writeStatus=0;
 const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 try{
  const created=await mutate(run.context,'/tasks',{title:'[QA] Footer keyboard '+randomUUID(),section:'projects',owner_id:fixture.users.find(user=>user.key==='founder').id,description:'A synthetic task used only for the footer interaction check.'});
  expect(created.status()).toBe(201);task=await created.json();
  for(let index=0;index<3;index++)expect((await mutate(run.context,'/tasks/'+task.id+'/comments',{body:('Synthetic review context. ').repeat(30)})).status()).toBe(201);
  const opener=await openTask(run.page,task),dialog=run.page.getByRole('dialog'),save=dialog.locator('.task-detail-actions button[type="submit"]');
  expect(await save.evaluate(node=>node.form===document.querySelector('form[data-form="edit-task"]')),'The external footer must submit the actual task form').toBe(true);
  expect(await save.evaluate(node=>node.form.contains(node)),'This check must exercise the external form association').toBe(false);
  const description='Updated through the external footer using a keyboard.';await dialog.getByLabel('What needs to happen?',{exact:true}).fill(description);
  await run.page.route('**/api/tasks/'+task.id,async route=>{
   if(route.request().method()!=='PATCH')return route.continue();patches++;
   const response=await route.fetch();writeStatus=response.status();
   started();await hold;await route.fulfill({response});
  });
  await hit(save);await save.focus();await pendingProbe(save);await save.press('Enter');await seen;
  expect(writeStatus,'The isolated server must authorize and commit the real write').toBe(200);
  await expect(save).toBeDisabled();await assertPendingBudget(save,'founder_task_footer');
  await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeDisabled();
  await run.page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(patches).toBe(1);
  release();await expect(save).toBeEnabled();await expect(save).toBeFocused();
  const persisted=await run.context.request.get('/api/tasks/'+task.id);expect(persisted.status()).toBe(200);expect((await persisted.json()).description).toBe(description);
  await run.page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
 }finally{
  release?.();
  try{if(task){const fresh=await run.context.request.get('/api/tasks/'+task.id);expect(fresh.status()).toBe(200);expect((await mutate(run.context,'/tasks/'+task.id,{expectedVersion:(await fresh.json()).version},'DELETE')).status()).toBe(200);}}
  finally{await run.context.close();}
 }
});

test('Sales retains a failed acknowledgement and retries one real activity without duplication',async({browser})=>{
 const run=await actor(browser,'sales_1',{viewport:{width:390,height:844}}),fixture=await profiles();let release,started,attempts=0,activity,firstStatus=0;
 const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve),context='[QA] Lost response '+randomUUID();
 try{
  const beforeResponse=await run.context.request.get('/api/sales');expect(beforeResponse.status()).toBe(200);const before=await beforeResponse.json();
  await run.page.goto('/workspace#sales');await ready(run.page,'Sales');
  const opener=run.page.locator('.sales-desk-heading [data-action="activity"]');await opener.focus();await opener.press('Enter');
  const dialog=run.page.getByRole('dialog'),save=dialog.getByRole('button',{name:'Save activity',exact:true});
  await dialog.getByLabel('Company or context',{exact:true}).fill(context);await dialog.getByLabel('Outcome',{exact:true}).fill('The prospect has an agreed next conversation.');
  await run.page.route('**/api/sales/activities',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   if(++attempts!==1)return route.continue();
   // The real server receives valid identity, permissions, CSRF and the write.
   // Only its successful acknowledgement is lost, exercising a real retry key.
   const response=await route.fetch();firstStatus=response.status();
   if(firstStatus===201){try{const ledger=await response.json();activity=ledger.activities.find(row=>row.context===context);}catch{/* Assert the malformed result in the test, without retaining its body. */}}
   started();await hold;
   if(firstStatus!==201||!activity)return route.fulfill({response});
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The test response was interrupted.'})});
  });
  await hit(save,{mobile:true});await save.focus();await pendingProbe(save);await save.press('Enter');await seen;
  expect(firstStatus,'Only an actually successful, authorized write may enter the lost-acknowledgement scenario').toBe(201);expect(activity).toBeTruthy();
  await expect(save).toBeDisabled();await assertPendingBudget(save,'sales_activity_first_attempt');
  release();await expect(dialog.locator('.form-error').first()).toContainText('response was interrupted');await expect(save).toBeEnabled();await expect(save).toBeFocused();
  await expect(dialog.getByLabel('Company or context',{exact:true})).toHaveValue(context);await expect(dialog.getByLabel('Outcome',{exact:true})).toHaveValue('The prospect has an agreed next conversation.');
  const committed=await run.context.request.get('/api/sales');expect(committed.status()).toBe(200);expect((await committed.json()).activities.filter(row=>row.context===context)).toHaveLength(1);
  const retried=run.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales/activities'&&response.request().method()==='POST');
  await save.press('Enter');expect((await retried).status()).toBe(201);await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
  const afterResponse=await run.context.request.get('/api/sales');expect(afterResponse.status()).toBe(200);const after=await afterResponse.json(),rows=after.activities.filter(row=>row.context===context);
  expect(attempts).toBe(2);expect(rows).toHaveLength(1);expect(rows[0].id).toBe(activity.id);expect(rows[0].owner_id).toBe(fixture.users.find(user=>user.key==='sales_1').id);expect(after.activity_total).toBe(before.activity_total+1);
  activity=rows[0];await noOverflow(run.page);await record('sales_retry',{attempts,storedActivities:rows.length});
 }finally{
  release?.();
  try{if(activity)expect((await mutate(run.context,'/sales/activities/'+activity.id,{expectedVersion:activity.version},'DELETE')).status()).toBe(200);}
  finally{await run.context.close();}
 }
});

test('Artist reduced-motion work remains keyboard accessible with the real PWA footer and offline notice',async({browser})=>{
 const run=await actor(browser,'artist_1',{viewport:{width:320,height:740},reducedMotion:'reduce'}),fixture=await profiles();
 try{
  const response=await run.context.request.get('/api/tasks/'+fixture.records.tasks[0]);expect(response.status()).toBe(200);const task=await response.json();
  const opener=await openTask(run.page,task),dialog=run.page.getByRole('dialog'),save=dialog.locator('.task-detail-actions button[type="submit"]'),close=dialog.getByRole('button',{name:'Close dialog',exact:true});
  await expect(run.page.locator('.pwa-install-slot')).toHaveCount(1);await expect(run.page.locator('.pwa-install-slot')).toBeVisible();
  await hit(save,{mobile:true});await save.focus();await run.page.keyboard.press('Tab');await expect(close).toBeFocused();
  await run.page.keyboard.press('Shift+Tab');await expect(save).toBeFocused();
  const focused=await save.evaluate(node=>({visible:node.matches(':focus-visible'),outline:parseFloat(getComputedStyle(node).outlineWidth)}));expect(focused.visible).toBe(true);expect(focused.outline).toBeGreaterThanOrEqual(budget.focusOutlinePx);
  await noOverflow(run.page,'#dialog');await run.page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
  const menu=run.page.locator('#mobile-menu-trigger');await menu.click();await run.page.locator('.sidebar .nav-link[href="#academy"]').click();await ready(run.page,'Academy');
  const selected=run.page.waitForResponse(result=>new URL(result.url()).pathname==='/api/courses/'+fixture.records.course&&result.request().method()==='GET');
  await run.page.locator('[data-action="course"][data-id="'+fixture.records.course+'"]').first().click();expect((await selected).status()).toBe(200);await expect(run.page.locator('.lesson-body h2')).toBeVisible();
  const lessonAction=run.page.locator('.lesson-body [data-action="complete-lesson"],.lesson-body [data-action="next-lesson"],.lesson-body [data-action="back-courses"]').first();
  await expect(run.page.locator('.pwa-install-slot')).toHaveCount(1);await hit(run.page.locator('.pwa-install-slot button'),{mobile:true});
  await run.context.setOffline(true);await expect(run.page.locator('.pwa-notice[role="alert"]')).toContainText('offline');
  await run.page.keyboard.press('Tab');await lessonAction.focus();await hit(lessonAction,{mobile:true});await expect(lessonAction).toBeFocused();
  const motion=await run.page.locator('.button,.nav-link,.tab,.lesson-nav button,.pwa-notice,.pwa-install-slot').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>{
   const style=getComputedStyle(node),milliseconds=value=>Math.max(...value.split(',').map(part=>part.trim().endsWith('ms')?parseFloat(part):parseFloat(part)*1000));
   return Math.max(milliseconds(style.transitionDuration),milliseconds(style.animationDuration));
  }));
  expect(motion.length).toBeGreaterThan(0);expect(Math.max(...motion)).toBeLessThanOrEqual(budget.reducedMotionMs);
  await noOverflow(run.page);await record('artist_reduced_motion',{width:320,maximumMotionMs:Math.max(...motion),pwaFooters:await run.page.locator('.pwa-install-slot').count(),offlineNotices:await run.page.locator('.pwa-notice[role="alert"]').count()});
 }finally{await run.context.setOffline(false);await run.context.close();}
});
