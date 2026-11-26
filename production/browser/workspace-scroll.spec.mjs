import {test,expect} from '@playwright/test';
import {actor} from './support.mjs';
import {loadFixture} from './load-fixture.mjs';

// A real write refreshes the same workspace. Retain the reader's position;
// a genuine destination change starts a fresh workspace at the top.
test('a saved task retains the current work position and a new route resets it',async({browser})=>{
 test.setTimeout(120000);
 const fixture=await loadFixture(),run=await actor(browser,'founder',{viewport:{width:1440,height:900}});
 const position=()=>run.page.locator('#main').evaluate(main=>{
  const scrolls=main.scrollHeight>main.clientHeight+10,scroller=scrolls?main:document.scrollingElement;
  return {top:scroller.scrollTop,max:scroller.scrollHeight-scroller.clientHeight};
 });
 try{
  await run.page.goto('/workspace#tasks');
  await expect(run.page.getByRole('heading',{name:'Tasks',exact:true})).toBeVisible();
  await expect(run.page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await expect(run.page.locator('.task-row')).toHaveCount(50);
  const row=run.page.locator('.task-row').filter({hasText:fixture.marker}).nth(25),checkbox=row.locator('[data-complete]'),id=await checkbox.getAttribute('data-complete');
  const beforeRecord=await (await run.context.request.get('/api/tasks/'+id)).json();
  expect(beforeRecord.title.startsWith(fixture.marker)).toBe(true);
  await row.scrollIntoViewIfNeeded();
  const before=await position();expect(before.max).toBeGreaterThan(500);expect(before.top).toBeGreaterThan(200);
  const oldMain=await run.page.locator('#main').elementHandle();
  const response=run.page.waitForResponse(response=>response.request().method()==='PATCH'&&new URL(response.url()).pathname==='/api/tasks/'+id);
  await checkbox.click();expect((await response).status()).toBe(200);
  await expect(run.page.locator('[data-complete="'+id+'"]')).toBeChecked();
  const saved=await (await run.context.request.get('/api/tasks/'+id)).json();expect(saved.status).toBe('Done');
  // Observe the actual DOM replacement, not the browser's immediate checkbox
  // toggle or an acknowledgement that arrives before the workspace refresh.
  await expect.poll(()=>oldMain.evaluate(main=>main.isConnected)).toBe(false);
  await oldMain.dispose();
  const after=await position();expect(Math.abs(after.top-before.top)).toBeLessThanOrEqual(3);
  await run.page.locator('.sidebar .nav-link[href="#academy"]').click();
  await expect(run.page.getByRole('heading',{name:'Academy',exact:true})).toBeVisible();
  await expect(run.page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  expect((await position()).top).toBeLessThanOrEqual(1);
  await run.page.locator('.sidebar .nav-link[href="#tasks"]').click();
  await expect(run.page.locator('#task-search')).toBeVisible();
  await expect(run.page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  expect((await position()).top).toBeLessThanOrEqual(1);
 }finally{await run.context.close();await fixture.cleanup();}
});
