import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,mutate,screenshot} from './support.mjs';

async function assertWorkspaceGeometry(page,route,width){
 const geometry=await page.evaluate(()=>{
  const viewport=document.documentElement.clientWidth,main=document.querySelector('#main'),rowIssues=[];
  const bounded=Array.from(main.querySelectorAll('*')).map(node=>{const box=node.getBoundingClientRect();return {node,box};}).filter(({node,box})=>box.width>0&&box.right>viewport+1&&getComputedStyle(node).visibility!=='hidden').slice(0,8).map(({node,box})=>({tag:node.tagName.toLowerCase(),class:typeof node.className==='string'?node.className:'',right:+box.right.toFixed(1),width:+box.width.toFixed(1),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,display:getComputedStyle(node).display,overflowX:getComputedStyle(node).overflowX}));
  for(const [index,row] of Array.from(main.querySelectorAll('.task-row')).entries()){
   const box=row.getBoundingClientRect();if(!box.width)continue;
   if(row.scrollWidth>row.clientWidth+1)rowIssues.push({index,reason:'task row internal overflow',scrollWidth:row.scrollWidth,clientWidth:row.clientWidth});
   const group=row.closest('.task-group');
   if(group){const status=group.querySelector('.task-group-head .badge'),rect=status?.getBoundingClientRect();if(!status||!rect.width||!rect.height||getComputedStyle(status).visibility==='hidden')rowIssues.push({index,reason:'grouped task status is hidden'});}
   for(const selector of ['.badge','.due','.avatar']){
    const node=row.querySelector(selector);if(!node)continue;
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    if(rect.width===0||rect.height===0||style.visibility==='hidden')rowIssues.push({index,selector,reason:'task metadata is hidden'});
    else if(rect.left<box.left-1||rect.right>box.right+1)rowIssues.push({index,selector,reason:'task metadata leaves its row',left:+rect.left.toFixed(1),right:+rect.right.toFixed(1)});
    if(selector!=='.avatar'&&parseFloat(style.fontSize)<12)rowIssues.push({index,selector,reason:'task metadata below 12px',fontSize:style.fontSize});
   }
  }
  return {viewport,documentWidth:document.documentElement.scrollWidth,mainRight:+main.getBoundingClientRect().right.toFixed(1),bounded,rowIssues:rowIssues.slice(0,12)};
 });
 const diagnostic=route+' @ '+width+'px '+JSON.stringify(geometry);
 expect(geometry.documentWidth,diagnostic).toBeLessThanOrEqual(geometry.viewport+1);
 expect(geometry.mainRight,diagnostic).toBeLessThanOrEqual(geometry.viewport+1);
 expect(geometry.rowIssues,diagnostic).toEqual([]);
}

for(const width of [360,390,768,1024,1440])test(`Today, Work, Sales, Projects and Academy stay usable at ${width}px`,async({browser})=>{
 const {context,page}=await actor(browser,'founder',{viewport:{width,height:1000}});
 for(const route of ['overview','tasks','sales','projects','academy']){
  await page.goto('/workspace#'+route);await expect(page.locator('#app .sidebar')).toBeAttached();await expect(page.locator('#main h1')).toBeVisible();
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await expect(page.locator('#main h1')).toHaveText({overview:'Studio today',tasks:'Tasks',sales:'Sales',projects:'Projects',academy:'Academy'}[route]);
  await assertWorkspaceGeometry(page,route,width);
  if(width<=700){const menu=page.locator('#mobile-menu-trigger');await menu.click();await expect(menu).toHaveAttribute('aria-expanded','true');await expect(page.locator('.sidebar .nav-link[href="#overview"]')).toBeFocused();await page.locator('.sidebar a[href="#settings"]').focus();await page.keyboard.press('Tab');await expect(page.locator('.sidebar .brand')).toBeFocused();expect(await page.locator('#main').evaluate(node=>node.inert)).toBe(true);await page.keyboard.press('Escape');await expect(menu).toBeFocused();expect(await page.locator('#main').evaluate(node=>node.inert)).toBe(false);}
  if((width===390||width===1440)&&['overview','academy','projects'].includes(route))await screenshot(page,'after-'+route+'-'+width);
 }
 await context.close();
});

test('task shortcuts, dialog focus and unsaved text behave consistently',async({browser})=>{
 const {context,page}=await actor(browser,'artist_1');await page.goto('/workspace#tasks');await expect(page.locator('#task-search')).toBeVisible();await page.keyboard.press('/');await expect(page.locator('#task-search')).toBeFocused();
 await page.locator('#task-search').fill('n');await expect(page.getByRole('dialog')).not.toBeVisible();await page.locator('#task-search').fill('');await page.locator('#main h1').click();await page.keyboard.press('n');
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Task name',{exact:true})).toBeFocused();await dialog.getByLabel('Task name',{exact:true}).fill('Keep this unsaved direction');
 page.once('dialog',alert=>alert.dismiss());await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Task name',{exact:true})).toHaveValue('Keep this unsaved direction');
 page.once('dialog',alert=>alert.accept());await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await page.keyboard.press('?');await expect(page.getByRole('heading',{name:'Keyboard shortcuts',exact:true})).toBeVisible();await page.keyboard.press('Escape');await context.close();
});

test('a native stale task form retains the draft and offers explicit reload',async({browser})=>{
 const fixture=await profiles(),{context,page}=await actor(browser,'artist_1'),founder=await actor(browser,'founder'),id=fixture.records.tasks[0];
 await page.goto('/workspace#tasks');await page.locator('[data-action="open-task"][data-id="'+id+'"]').click();const dialog=page.getByRole('dialog'),draft='Keep this artist’s unsaved lighting note.';await dialog.getByLabel('What needs to happen?',{exact:true}).fill(draft);
 const task=await (await founder.context.request.get('/api/tasks/'+id)).json();expect((await mutate(founder.context,'/tasks/'+id,{expectedVersion:task.version,changes:{priority:task.priority==='High'?'Urgent':'High'}},'PATCH')).status()).toBe(200);
 await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.locator('.form-error').first()).toContainText('changed elsewhere');await expect(dialog.getByLabel('What needs to happen?',{exact:true})).toHaveValue(draft);await expect(dialog.getByRole('button',{name:'Reload latest',exact:true})).toBeVisible();
 page.once('dialog',alert=>alert.dismiss());await dialog.getByRole('button',{name:'Reload latest',exact:true}).click();await expect(dialog.getByLabel('What needs to happen?',{exact:true})).toHaveValue(draft);page.once('dialog',alert=>alert.accept());await dialog.getByRole('button',{name:'Reload latest',exact:true}).click();await expect(dialog.getByLabel('What needs to happen?',{exact:true})).not.toHaveValue(draft);await context.close();await founder.context.close();
});

test('installation guidance remains keyboard accessible and never floats over work actions',async({browser})=>{
 const {context,page}=await actor(browser,'artist_1');await page.goto('/workspace#academy');const course=(await profiles()).records.course;await page.locator('[data-action="course"][data-id="'+course+'"]').first().click();await expect(page.locator('.lesson-body')).toBeVisible();
 expect(await page.locator('.pwa-install-slot').evaluate(slot=>getComputedStyle(slot).position)).toBe('static');
 const install=page.getByRole('button',{name:'Install NAM OS',exact:true});await install.click();await expect(page.locator('.pwa-help')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.pwa-help')).not.toBeVisible();await expect(install).toBeFocused();await context.close();
});

test('key screens pass automated WCAG 2.2 AA checks and reduced-motion settings',async({browser})=>{
 const {context,page}=await actor(browser,'founder',{reducedMotion:'reduce'});
 for(const route of ['overview','tasks','sales','projects','academy','settings']){
  await page.goto('/workspace#'+route);await expect(page.locator('#main h1')).toBeVisible();
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await expect(page.locator('#main h1')).toHaveText({overview:'Studio today',tasks:'Tasks',sales:'Sales',projects:'Projects',academy:'Academy',settings:'Settings'}[route]);
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),route+' accessibility violations').toEqual([]);
 }
 await page.goto('/workspace#tasks');await page.getByRole('button',{name:'Create task',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}))).toEqual([]);await context.close();
});
