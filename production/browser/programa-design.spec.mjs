import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,mutate} from './support.mjs';

// Source-backed design acceptance on the real isolated provider. These are
// rendered geometry and operational checks, not pixel-equality screenshots or
// substitutes for the existing authentication, permission and workflow suite.
const viewports=[{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}];

async function ready(page,title){
 await expect(page.locator('#main h1')).toHaveText(title);
 await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
 await page.evaluate(()=>document.fonts.ready);
}

async function navigate(page,route,title){
 const menu=page.locator('#mobile-menu-trigger');
 if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();
 if(await page.locator('[data-project-navigation]').count()){
  await page.getByRole('button',{name:'Back to projects',exact:true}).click();await ready(page,'Projects');
  if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();
 }
 const link=page.locator('.sidebar .nav-link[href="#'+route+'"]');
 await link.click();await ready(page,title);await expect(link).toHaveAttribute('aria-current','page');
 await expect(page.locator('.sidebar .nav-link[aria-current="page"]')).toHaveCount(1);
}

async function shell(page,width){
 const result=await page.evaluate(()=>{
  const box=selector=>{const node=document.querySelector(selector);if(!node)return null;const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};};
  const title=document.querySelector('#main h1'),style=getComputedStyle(title),menu=document.querySelector('#mobile-menu-trigger'),nav=document.querySelector('.sidebar .nav-link');
  return {viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth,main:box('#main'),header:box('.topbar'),sidebar:box('.sidebar'),title:box('#main h1'),titleFont:style.fontFamily,headingFaceLoaded:Array.from(document.fonts).some(face=>face.family.replaceAll('"','').replaceAll("'",'')==='Inter'&&face.status==='loaded'),titleSize:parseFloat(style.fontSize),titleLine:parseFloat(style.lineHeight),titleWeight:Number(style.fontWeight),navigationHeight:nav?.getBoundingClientRect().height,menuVisible:!!menu?.getClientRects().length&&getComputedStyle(menu).display!=='none'};
 });
 expect(result.document,'The page must fit without concealing work beyond the viewport').toBeLessThanOrEqual(result.viewport+1);
 expect(result.main.right).toBeLessThanOrEqual(result.viewport+1);
 expect(Math.abs(result.header.left-result.main.left),'Header and content must share the same canvas edge').toBeLessThanOrEqual(1);
 expect(Math.abs(result.header.right-result.main.right)).toBeLessThanOrEqual(1);
 expect(result.viewport-result.header.right).toBeGreaterThanOrEqual(6);
 expect(result.viewport-result.header.right).toBeLessThanOrEqual(10);
 expect(result.header.height).toBeGreaterThanOrEqual(48);expect(result.header.height).toBeLessThanOrEqual(56);
 expect(result.titleSize).toBeGreaterThanOrEqual(22);expect(result.titleSize).toBeLessThanOrEqual(28);
 expect(result.titleLine/result.titleSize).toBeGreaterThanOrEqual(1.15);expect(result.titleLine/result.titleSize).toBeLessThanOrEqual(1.4);
 const families=result.titleFont.toLowerCase().split(',').map(value=>value.trim().replaceAll('"','').replaceAll("'",''));
 expect(families.includes('sans-serif'),'Page headings use the requested modern sans-serif family').toBe(true);
 expect(families[0],'NAM uses self-hosted Inter consistently').toBe('inter');expect(result.titleWeight).toBe(600);
 expect(result.headingFaceLoaded,'The self-hosted display font must load rather than silently falling back').toBe(true);
 if(!result.menuVisible){
  expect(result.sidebar.width).toBeGreaterThanOrEqual(224);expect(result.sidebar.width).toBeLessThanOrEqual(232);
  expect(result.main.left-result.sidebar.right).toBeGreaterThanOrEqual(6);expect(result.main.left-result.sidebar.right).toBeLessThanOrEqual(10);
  expect(result.navigationHeight).toBeGreaterThanOrEqual(26);expect(result.navigationHeight).toBeLessThanOrEqual(34);
 }else{
  expect(width).toBeLessThanOrEqual(700);expect(result.main.left).toBeGreaterThanOrEqual(6);expect(result.main.left).toBeLessThanOrEqual(10);
 }
}

async function actionable(control,width,{compact=false}={}){
 await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();await expect(control).toBeEnabled();
 const result=await control.evaluate(node=>{
  const rect=node.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,viewport:innerWidth,viewportHeight:innerHeight,hit:hit===node||node.contains(hit)};
 });
 expect(result.left).toBeGreaterThanOrEqual(-1);expect(result.right).toBeLessThanOrEqual(result.viewport+1);
 expect(result.top).toBeGreaterThanOrEqual(-1);expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight+1);
 expect(result.height).toBeGreaterThanOrEqual(width<=700?44:compact?24:28);
 expect(result.hit,'The intended action must not be covered by the header, another control or an overlay').toBe(true);
}

async function dialogFit(page,width){
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 const result=await dialog.evaluate(node=>{
  const rect=node.getBoundingClientRect(),head=node.querySelector('.dialog-head'),title=head.querySelector('h2').getBoundingClientRect(),close=head.querySelector('[aria-label="Close dialog"]').getBoundingClientRect();
  return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,viewport:innerWidth,viewportHeight:innerHeight,overflow:node.scrollWidth>node.clientWidth+1,titleRight:title.right,closeLeft:close.left};
 });
 expect(result.left).toBeGreaterThanOrEqual(-1);expect(result.right).toBeLessThanOrEqual(result.viewport+1);
 expect(result.top).toBeGreaterThanOrEqual(-1);expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight+1);expect(result.overflow).toBe(false);
 expect(result.titleRight,'Dialog titles and Close must remain separate').toBeLessThanOrEqual(result.closeLeft-7);
 await actionable(dialog.getByRole('button',{name:'Close dialog',exact:true}),width);
}

for(const viewport of viewports)test('Programa geometry supports founder, sales and artist work at '+viewport.width+'px',async({browser})=>{
 test.setTimeout(150000);
 const fixture=await profiles(),founder=await actor(browser,'founder',{viewport}),sales=await actor(browser,'sales_1',{viewport}),artist=await actor(browser,'artist_1',{viewport});
 let originalTask=null,changedPriority=false,loggedActivity=null,primaryError=null;
 try{
  // Founder: find an actual assigned deliverable, save a reversible change,
  // and reach its shared project without re-entering production context.
  const response=await founder.context.request.get('/api/tasks/'+fixture.records.tasks[0]);expect(response.status()).toBe(200);originalTask=await response.json();
  expect(originalTask.project_id).toBeTruthy();
  await founder.page.goto('/workspace#overview');await ready(founder.page,'Studio today');await shell(founder.page,viewport.width);
  await navigate(founder.page,'tasks','Tasks');await shell(founder.page,viewport.width);
  await founder.page.locator('[data-action="tab"][data-value="studio"]').click();
  await founder.page.locator('#task-search').fill(originalTask.title);
  const row=founder.page.locator('.task-row').filter({has:founder.page.locator('[data-action="open-task"][data-id="'+originalTask.id+'"]')});
  await expect(row).toHaveCount(1);
  if(viewport.width>=1024){
   const height=await row.evaluate(node=>node.getBoundingClientRect().height);
   expect(height,'A short two-line work record should retain the compact table rhythm').toBeGreaterThanOrEqual(44);expect(height).toBeLessThanOrEqual(60);
  }
  await founder.page.locator('[data-action="view-mode"][data-value="board"]').click();
  const card=founder.page.locator('.task-card[data-id="'+originalTask.id+'"]');await actionable(card,viewport.width);
  if([390,1440].includes(viewport.width)){
   const scan=await new AxeBuilder({page:founder.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   expect(scan.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.length})),'Warm board surfaces must retain accessible contrast and semantics').toEqual([]);
  }
  await card.focus();await card.press('Enter');await dialogFit(founder.page,viewport.width);
  const taskDialog=founder.page.getByRole('dialog'),priority=originalTask.priority==='High'?'Normal':'High';
  await taskDialog.getByLabel('Priority',{exact:true}).selectOption(priority);
  const save=taskDialog.getByRole('button',{name:'Save changes',exact:true});await actionable(save,viewport.width);changedPriority=true;await save.click();
  await expect(save).toBeEnabled();await expect(taskDialog.getByLabel('Priority',{exact:true})).toHaveValue(priority);
  const saved=await founder.context.request.get('/api/tasks/'+originalTask.id);expect(saved.status()).toBe(200);expect((await saved.json()).priority).toBe(priority);
  const projectTitle=await taskDialog.locator('.context-title').innerText();
  await taskDialog.locator('.context-title').click();await ready(founder.page,projectTitle);await shell(founder.page,viewport.width);
  await expect(founder.page.locator('.project-brief .brief-copy')).toBeVisible();

  // Sales: reach the last tab without page overflow, then log a real outcome.
  // Complete provider figures are never inferred from the displayed preview.
  await sales.page.goto('/workspace#sales');await ready(sales.page,'Sales');await shell(sales.page,viewport.width);
  await expect(sales.page.getByRole('heading',{name:'Next follow-ups',exact:true})).toBeVisible();
  const targets=sales.page.locator('.tabs [data-action="tab"][data-value="targets"]');await targets.focus();await actionable(targets,viewport.width);await targets.press('Enter');
  await expect(sales.page.getByRole('heading',{name:'Monthly activity targets',exact:true})).toBeVisible();
  const desk=sales.page.locator('.tabs [data-action="tab"][data-value="desk"]');await desk.focus();await desk.press('Enter');
  await expect(sales.page.getByRole('heading',{name:'Next follow-ups',exact:true})).toBeVisible();
  const log=sales.page.locator('.sales-desk-heading [data-action="activity"]');await actionable(log,viewport.width);await log.focus();await log.press('Enter');
  await dialogFit(sales.page,viewport.width);
  const activity=sales.page.getByRole('dialog'),context='[QA] Design review '+viewport.width+' '+Date.now();
  await activity.getByLabel('Company or context',{exact:true}).fill(context);await activity.getByLabel('Outcome',{exact:true}).fill('The next prospect conversation has a clear outcome and owner.');
  const committed=sales.page.waitForResponse(result=>result.url().endsWith('/api/sales/activities')&&result.request().method()==='POST');
  const commit=activity.getByRole('button',{name:'Save activity',exact:true});await actionable(commit,viewport.width);await commit.click();
  const ledger=await committed;expect(ledger.status()).toBe(201);const body=await ledger.json();
  loggedActivity=body.activities.find(value=>value.context===context);expect(loggedActivity).toBeTruthy();expect(loggedActivity.owner_id).toBe(fixture.users.find(user=>user.key==='sales_1').id);
  await expect(activity).not.toBeVisible();await shell(sales.page,viewport.width);

  // Artist: retain an authorized brief, private assignment and lesson context.
  await artist.page.goto('/workspace#projects/'+fixture.records.project);
  const project=await artist.context.request.get('/api/projects/'+fixture.records.project);expect(project.status()).toBe(200);const brief=await project.json();
  await ready(artist.page,brief.title);await shell(artist.page,viewport.width);
  await expect(artist.page.locator('.project-brief .brief-copy')).toHaveText(brief.brief);
  await artist.page.getByRole('link',{name:'Open Project Management',exact:true}).click();await ready(artist.page,'Project Management');await shell(artist.page,viewport.width);
  await expect(artist.page.locator('[data-action="open-task"][data-id="'+fixture.records.tasks[1]+'"]')).toHaveCount(0);
  const own=artist.page.locator('[data-action="open-task"][data-id="'+originalTask.id+'"]');await actionable(own,viewport.width);await own.focus();await own.press('Enter');await dialogFit(artist.page,viewport.width);
  await expect(artist.page.getByRole('dialog').locator('.context-title')).toHaveText(brief.title);
  await artist.page.keyboard.press('Escape');await expect(artist.page.getByRole('dialog')).not.toBeVisible();await expect(own).toBeFocused();
  await navigate(artist.page,'academy','Academy');await shell(artist.page,viewport.width);
  expect(await artist.page.locator('#main').evaluate(node=>node.inert),'The Academy must be interactive after closing mobile navigation').toBe(false);
  await expect(artist.page.getByRole('dialog')).not.toBeVisible();
  const course=artist.page.locator('[data-action="course"][data-id="'+fixture.records.course+'"]').first();await actionable(course,viewport.width);
  await expect(course).toHaveAttribute('data-id',fixture.records.course);
  const [selectedResponse]=await Promise.all([
   artist.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/courses/'+fixture.records.course&&response.request().method()==='GET'),
   course.click(),
  ]);
  expect(selectedResponse.status(),'The actual assigned-course request must complete successfully').toBe(200);
  const selected=await selectedResponse.json();
  expect(selected.id,'The returned course must be the one activated').toBe(fixture.records.course);
  expect(Array.isArray(selected.lessons),'An assigned course must include its publication lessons').toBe(true);
  expect(selected.lessons.length,'The shared learning fixture must have a readable lesson').toBeGreaterThan(0);
  const intendedLesson=selected.lessons.find(lesson=>!lesson.completed_at)||selected.lessons[0];
  await ready(artist.page,selected.title);
  await expect(artist.page.locator('.lesson-body > h2'),'The selected publication must render a lesson heading').toHaveCount(1);
  await expect(artist.page.locator('.lesson-body > h2')).toHaveText(intendedLesson.title);
  await expect(artist.page.locator('.lesson-body > h2')).toBeVisible();
  const outline=artist.page.locator('.lesson-outline');
  if(!await outline.evaluate(node=>node.open)){const summary=outline.locator(':scope > summary');await actionable(summary,viewport.width);await summary.focus();await summary.press('Enter');}
  const lesson=artist.page.locator('.lesson-nav [data-action="lesson"]').first();await actionable(lesson,viewport.width);await lesson.focus();await lesson.press('Enter');
  await expect(lesson).toHaveAttribute('aria-current','step');await expect(artist.page.locator('.lesson-body > h2')).toBeFocused();
  expect(await artist.page.locator('.lesson-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 }catch(error){primaryError=error;throw error;}finally{
  // Only the exact, isolated records touched by this test are restored.
  const cleanupErrors=[],cleanup=async action=>{try{await action();}catch(error){cleanupErrors.push(error);}};
  await cleanup(async()=>{if(changedPriority&&originalTask){const current=await founder.context.request.get('/api/tasks/'+originalTask.id);expect(current.status()).toBe(200);const value=await current.json();expect((await mutate(founder.context,'/tasks/'+value.id,{expectedVersion:value.version,changes:{priority:originalTask.priority}},'PATCH')).status()).toBe(200);}});
  await cleanup(async()=>{if(loggedActivity)expect((await mutate(sales.context,'/sales/activities/'+loggedActivity.id,{expectedVersion:loggedActivity.version},'DELETE')).status()).toBe(200);});
  for(const context of [founder.context,sales.context,artist.context])await cleanup(()=>context.close());
  if(cleanupErrors.length){
   if(primaryError)for(const error of cleanupErrors)test.info().annotations.push({type:'cleanup-error',description:String(error)});
   else throw new AggregateError(cleanupErrors,'Failed to restore isolated design test records');
  }
 }
});
