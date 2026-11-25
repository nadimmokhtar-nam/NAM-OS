import {test,expect} from '@playwright/test';
import {actor,mutate,profiles} from './support.mjs';

// These checks use native Chromium focus and the real managed session/API.
// Route interception is restricted to the named subtask mutation in failure
// cases; authentication, authorization, task reads and all other calls remain real.
async function openKeyboardTask(browser){
 const run=await actor(browser,'artist_1'),fixture=await profiles();
 const response=await mutate(run.context,'/tasks',{
  title:'[QA] Keyboard task '+Date.now(),description:'Keep focus on the work being updated.',
  section:'projects',owner_id:fixture.users.find(user=>user.key==='artist_1').id,
 });
 expect(response.status()).toBe(201);const task=await response.json();
 const created=await mutate(run.context,'/tasks/'+task.id+'/subtasks',{title:'Review the lighting'});
 expect(created.status()).toBe(200);const details=await created.json(),child=details.subtasks[0];
 await run.page.goto('/workspace#tasks');
 await run.page.locator('#task-search').fill(task.title);
 await run.page.locator('[data-action="open-task"][data-id="'+task.id+'"]').click();
 await expect(run.page.getByRole('dialog')).toBeVisible();
 return {...run,task,child,checkbox:run.page.locator('[data-subtask="'+child.id+'"]')};
}

test('native keyboard focus survives a successful subtask rerender and persists the result',async({browser})=>{
 const run=await openKeyboardTask(browser);
 try{
  await run.checkbox.focus();await run.page.keyboard.press('Space');
  await expect(run.checkbox).toBeChecked();await expect(run.checkbox).toBeEnabled();
  await expect(run.checkbox).toBeFocused();
  const saved=await (await run.context.request.get('/api/tasks/'+run.task.id)).json();
  expect(saved.subtasks.find(child=>child.id===run.child.id).completed).toBe(true);
  await run.page.keyboard.press('Tab');await expect(run.page.locator('#new-subtask')).toBeFocused();
 }finally{await run.context.close();}
});

test('native failed subtask save restores the checkbox focus and checked value',async({browser})=>{
 const run=await openKeyboardTask(browser);
 try{
  await run.page.route('**/api/tasks/'+run.task.id+'/subtasks',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The test connection was interrupted. Retry this update.'})});
  });
  await run.checkbox.focus();await run.page.keyboard.press('Space');
  await expect(run.page.locator('#toast')).toContainText('connection was interrupted');
  await expect(run.checkbox).toBeEnabled();await expect(run.checkbox).not.toBeChecked();
  await expect(run.checkbox).toBeFocused();
  const saved=await (await run.context.request.get('/api/tasks/'+run.task.id)).json();
  expect(saved.subtasks.find(child=>child.id===run.child.id).completed).toBe(false);
 }finally{await run.context.close();}
});

test('a pending subtask response respects the user moving focus to task notes',async({browser})=>{
 const run=await openKeyboardTask(browser);let release,started;
 const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 try{
  await run.page.route('**/api/tasks/'+run.task.id+'/subtasks',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   started();await hold;await route.continue();
  });
  await run.checkbox.focus();await run.page.keyboard.press('Space');await seen;
  const notes=run.page.getByRole('dialog').getByLabel('What needs to happen?',{exact:true});
  await notes.fill('This new lighting direction must survive the partial save.');
  release();await expect(run.checkbox).toBeChecked();await expect(run.checkbox).toBeEnabled();
  await expect(notes).toHaveValue('This new lighting direction must survive the partial save.');
  await expect(notes).toBeFocused();
 }finally{release?.();await run.context.close();}
});

test('closing a dialog while a subtask saves does not reopen it or steal navigation focus',async({browser})=>{
 const run=await openKeyboardTask(browser);let release,started;
 const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 try{
  await run.page.route('**/api/tasks/'+run.task.id+'/subtasks',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   started();await hold;await route.continue();
  });
  await run.checkbox.focus();await run.page.keyboard.press('Space');await seen;
  await run.page.keyboard.press('Escape');await expect(run.page.getByRole('dialog')).not.toBeVisible();
  const work=run.page.locator('.sidebar .nav-link[href="#tasks"]');await work.focus();
  const saved=run.page.waitForResponse(response=>response.url().endsWith('/api/tasks/'+run.task.id+'/subtasks')&&response.request().method()==='POST');
  release();expect((await saved).status()).toBe(200);
  await expect(run.page.getByRole('dialog')).not.toBeVisible();await expect(work).toBeFocused();
 }finally{release?.();await run.context.close();}
});

test('completing and reopening a task by keyboard keeps the logical row focused',async({browser})=>{
 const run=await openKeyboardTask(browser);
 try{
  expect((await mutate(run.context,'/tasks/'+run.task.id+'/subtasks',{id:run.child.id,completed:true})).status()).toBe(200);
  await run.page.keyboard.press('Escape');
  const checkbox=run.page.locator('[data-complete="'+run.task.id+'"]');
  await checkbox.focus();await run.page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();await expect(checkbox).toBeEnabled();await expect(checkbox).toBeFocused();
  expect((await (await run.context.request.get('/api/tasks/'+run.task.id)).json()).status).toBe('Done');
  await run.page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();await expect(checkbox).toBeEnabled();await expect(checkbox).toBeFocused();
  expect((await (await run.context.request.get('/api/tasks/'+run.task.id)).json()).status).toBe('Todo');
 }finally{await run.context.close();}
});

test('failed keyboard task completion retains the row focus and original status',async({browser})=>{
 const run=await openKeyboardTask(browser);
 try{
  await run.page.keyboard.press('Escape');
  await run.page.route('**/api/tasks/'+run.task.id,async route=>{
   if(route.request().method()!=='PATCH')return route.continue();
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Task update interrupted. Your saved task is unchanged.'})});
  });
  const checkbox=run.page.locator('[data-complete="'+run.task.id+'"]');
  await checkbox.focus();await run.page.keyboard.press('Space');
  await expect(run.page.locator('#toast')).toContainText('Task update interrupted');
  await expect(checkbox).not.toBeChecked();await expect(checkbox).toBeEnabled();await expect(checkbox).toBeFocused();
  expect((await (await run.context.request.get('/api/tasks/'+run.task.id)).json()).status).toBe('Todo');
 }finally{await run.context.close();}
});

test('reduced motion removes nonessential control and panel transition delays',async({browser})=>{
 const {context,page}=await actor(browser,'founder',{reducedMotion:'reduce'});
 try{
  await page.goto('/workspace#tasks');await expect(page.locator('#task-search')).toBeVisible();
  const failures=await page.locator('.button,.nav-link,.tab,.task-card,.panel').evaluateAll(nodes=>nodes.flatMap(node=>{
   const style=getComputedStyle(node),seconds=value=>value.split(',').map(item=>item.trim().endsWith('ms')?parseFloat(item)/1000:parseFloat(item));
   const duration=Math.max(...seconds(style.transitionDuration),...seconds(style.animationDuration));
   return duration>.001?[{tag:node.tagName,className:node.className,duration}]:[];
  }));
  expect(failures).toEqual([]);
 }finally{await context.close();}
});
