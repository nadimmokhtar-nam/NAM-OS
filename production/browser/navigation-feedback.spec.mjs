import {test,expect} from '@playwright/test';
import {actor} from './support.mjs';

async function begin(browser){
 const run=await actor(browser,'founder');await run.page.goto('/workspace#tasks');
 await expect(run.page.getByRole('heading',{name:'Work',exact:true})).toBeVisible();await expect(run.page.locator('#task-search')).toBeVisible();return run;
}
async function holdSales(page){
 let release,started;const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 await page.route('**/api/sales',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch();started();await hold;await route.fulfill({response});
 });
 return {seen,release};
}
async function assertPending(page){
 await expect(page.locator('.sidebar .nav-link[href="#sales"]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('.crumb')).toContainText('Sales');
 await expect(page.getByRole('heading',{name:'Sales',exact:true})).toBeVisible();
 await expect(page.locator('#main')).toHaveAttribute('aria-busy','true');
 await expect(page.locator('#main').getByRole('status')).toContainText('Sales');
 await expect(page.locator('#main .task-open')).toHaveCount(0);
}

test('navigation acknowledges the destination within150ms while a real response is held',async({browser})=>{
 const {context,page}=await begin(browser);let gate;
 try{
  gate=await holdSales(page);
  // Measure browser DOM acknowledgement from the actual click. This excludes
  // tool transport and does not fabricate faster HTTP or cached business data.
  await page.evaluate(()=>{
   const trigger=document.querySelector('.sidebar .nav-link[href="#sales"]');
   trigger.addEventListener('click',()=>{
    const start=performance.now(),sample={milliseconds:null};window.__namQaRouteSignal=sample;
    const observer=new MutationObserver(()=>{
     if(document.querySelector('.sidebar .nav-link[href="#sales"][aria-current="page"]')&&document.querySelector('#main[aria-busy="true"] h1')?.textContent==='Sales'){
      sample.milliseconds=performance.now()-start;observer.disconnect();
     }
    });
    observer.observe(document.querySelector('#app'),{subtree:true,childList:true,attributes:true});
    setTimeout(()=>observer.disconnect(),1000);
   },{once:true,capture:true});
  });
  await page.locator('.sidebar .nav-link[href="#sales"]').click();await gate.seen;
  await assertPending(page);
  const latency=await page.evaluate(()=>window.__namQaRouteSignal?.milliseconds);
  expect(typeof latency).toBe('number');expect(latency).toBeLessThan(150);
  gate.release();await expect(page.getByRole('button',{name:'Your sales day',exact:true})).toBeVisible();
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
 }finally{gate?.release();await context.close();}
});

test('a delayed navigation cannot replace a newer completed destination',async({browser})=>{
 const {context,page}=await begin(browser);let gate;
 try{
  gate=await holdSales(page);await page.locator('.sidebar .nav-link[href="#sales"]').click();await gate.seen;await assertPending(page);
  await page.locator('.sidebar .nav-link[href="#academy"]').click();
  await expect(page.getByRole('heading',{name:'Academy',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'My learning',exact:true})).toBeVisible();
  const response=page.waitForResponse(response=>response.url().endsWith('/api/sales')&&response.request().method()==='GET');
  gate.release();expect((await response).status()).toBe(200);
  await expect(page.locator('.sidebar .nav-link[href="#academy"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.crumb')).toContainText('Academy');
  await expect(page.getByRole('heading',{name:'Academy',exact:true})).toBeVisible();
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await expect(page.getByRole('button',{name:'Your sales day',exact:true})).toHaveCount(0);
 }finally{gate?.release();await context.close();}
});

test('failed navigation retains its destination and retry recovers without stale content',async({browser})=>{
 const {context,page}=await begin(browser);let calls=0;
 try{
  await page.route('**/api/sales',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   if(++calls===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The synthetic test connection was temporarily interrupted.'})});
   return route.continue();
  });
  await page.locator('.sidebar .nav-link[href="#sales"]').click();
  await expect(page.getByRole('heading',{name:'Workspace unavailable',exact:true})).toBeVisible();
  await expect(page.locator('.sidebar .nav-link[href="#sales"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.crumb')).toContainText('Sales');
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await expect(page.getByText('The synthetic test connection was temporarily interrupted.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('button',{name:'Your sales day',exact:true})).toBeVisible();expect(calls).toBe(2);
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
 }finally{await context.close();}
});

test('a pending connected-report tab does not block a later activity-tab selection',async({browser})=>{
 const {context,page}=await actor(browser,'founder');let release,started;
 const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 try{
  await page.goto('/workspace#sales');await expect(page.getByRole('button',{name:'Your sales day',exact:true})).toBeVisible();
  await page.route('**/api/sales/connected*',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   const response=await route.fetch();started();await hold;await route.fulfill({response});
  });
  await page.getByRole('button',{name:'Connected reporting',exact:true}).click();await seen;
  const activities=page.getByRole('button',{name:'Activities',exact:true});await activities.click();
  await expect(activities).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('heading',{name:'Activity log',exact:true})).toBeVisible();
  const response=page.waitForResponse(response=>response.url().includes('/api/sales/connected')&&response.request().method()==='GET');
  release();expect((await response).status()).toBe(200);
  await expect(activities).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('heading',{name:'Activity log',exact:true})).toBeVisible();
 }finally{release?.();await context.close();}
});
