import {test,expect} from '@playwright/test';
import {actor,mutate,profiles} from './support.mjs';

// Only isolated synthetic identities are accepted by the shared fixture.
// Real API reads and permissions remain in use; one response is delayed to
// reproduce choosing a second task before the earlier read returns.
test('keyboard task creation returns focus to its opener after dismissal',async({browser})=>{
 const {context,page}=await actor(browser,'artist_1');
 try{
  await page.goto('/workspace#tasks');const opener=page.getByRole('button',{name:'Create task',exact:true});
  await opener.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Task name',{exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(opener).toBeFocused();
 }finally{await context.close();}
});

test('the last chosen task stays open when an earlier detail request returns late',async({browser})=>{
 const run=await actor(browser,'artist_1'),fixture=await profiles(),owner=fixture.users.find(user=>user.key==='artist_1').id;
 const prefix='[QA] Task intent '+Date.now(),tasks=[];
 let release,started;const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 try{
  for(const suffix of ['Earlier','Chosen']){
   const response=await mutate(run.context,'/tasks',{title:prefix+' / '+suffix,section:'projects',owner_id:owner,description:'Synthetic task selection ordering check.'});
   expect(response.status()).toBe(201);tasks.push(await response.json());
  }
  await run.page.goto('/workspace#tasks');await run.page.locator('#task-search').fill(prefix);
  const earlier=run.page.locator('[data-action="open-task"][data-id="'+tasks[0].id+'"]');
  const chosen=run.page.locator('[data-action="open-task"][data-id="'+tasks[1].id+'"]');
  await expect(earlier).toBeVisible();await expect(chosen).toBeVisible();
  await run.page.route('**/api/tasks/'+tasks[0].id,async route=>{
   if(route.request().method()!=='GET')return route.continue();
   started();await hold;await route.continue();
  });
  await earlier.click();await seen;
  await expect.poll(()=>earlier.evaluate(button=>button.disabled||button.getAttribute('aria-busy')==='true')).toBe(true);
  await chosen.click();const dialog=run.page.getByRole('dialog'),title=dialog.getByLabel('Task name',{exact:true});
  await expect(title).toHaveValue(tasks[1].title);
  const completed=run.page.waitForResponse(response=>response.url().endsWith('/api/tasks/'+tasks[0].id)&&response.request().method()==='GET');
  release();expect((await completed).status()).toBe(200);
  await expect.poll(()=>earlier.evaluate(button=>button.disabled||button.getAttribute('aria-busy')==='true')).toBe(false);
  await expect(title).toHaveValue(tasks[1].title);
 }finally{release?.();await run.context.close();}
});
