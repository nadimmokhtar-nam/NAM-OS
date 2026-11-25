import {test,expect} from '@playwright/test';
import {actor,profiles,mutate} from './support.mjs';

// Actual disposable-provider records, never hosted studio data or mocked Auth.
test('task workspace keeps project context, direct URLs, Back and mobile reading order',async({browser},testInfo)=>{
 const run=await actor(browser,'founder'),data=await profiles();
 try{
  const founder=data.users.find(person=>person.key==='founder'),suffix=Date.now().toString(36);
  const projectResponse=await mutate(run.context,'/projects',{title:'[QA] Workspace fidelity '+suffix,brief:'Review the camera and material direction.',lead_id:founder.id,member_ids:[]});
  expect(projectResponse.status()).toBe(201);const project=await projectResponse.json();
  const taskResponse=await mutate(run.context,'/tasks',{title:'[QA] Review lighting '+suffix,section:'projects',owner_id:founder.id,project_id:project.id,production_stage:'Lighting'});
  expect(taskResponse.status()).toBe(201);const task=await taskResponse.json();
  const parent='/workspace#projects/'+project.id+'/work';
  await run.page.goto(parent);await expect(run.page.locator('#main h1')).toHaveText('Project Management');
  const group=run.page.locator('.task-group[data-group-status="Todo"]');
  await expect(group.locator('[data-action="open-task"]')).toHaveCount(1);
  const list=await group.evaluate(node=>({width:node.getBoundingClientRect().width,header:node.querySelector('.task-group-head').getBoundingClientRect().height,row:node.querySelector('.task-row').getBoundingClientRect().height}));
  expect(list.width).toBeCloseTo(720,0);expect(list.header).toBeCloseTo(44,0);expect(list.row).toBeCloseTo(46,0);
  await run.page.screenshot({path:testInfo.outputPath('task-fidelity-list-1440.png'),animations:'disabled'});
  await run.page.locator('[data-action="open-task"][data-id="'+task.id+'"]').click();
  const detail=run.page.getByRole('dialog'),title=detail.getByLabel('Task name',{exact:true});
  await expect(title).toHaveValue(task.title);await expect(run.page).toHaveURL(new RegExp('task='+task.id+'$'));
  await expect(detail).toHaveAttribute('aria-modal','false');
  expect(await detail.evaluate(node=>node.matches(':modal'))).toBe(false);
  await expect(run.page.locator('.sidebar [data-project-navigation]')).toBeVisible();
  await expect(run.page.locator('.sidebar .nav-link[href="#tasks"]')).toHaveCount(0);
  const desktop=await detail.evaluate(node=>({left:node.getBoundingClientRect().left,rail:node.querySelector('.task-detail-rail').getBoundingClientRect().width}));
  expect(desktop.left).toBeCloseTo(228,0);expect(desktop.rail).toBeCloseTo(400,0);
  await run.page.screenshot({path:testInfo.outputPath('task-fidelity-1440.png'),animations:'disabled'});

  await run.page.goBack();await expect(detail).not.toBeVisible();
  await expect(run.page.locator('#main h1')).toHaveText('Project Management');
  await run.page.goForward();await expect(title).toHaveValue(task.title);
  await run.page.reload();await expect(title).toHaveValue(task.title);

  await run.page.setViewportSize({width:390,height:844});
  await expect.poll(()=>detail.evaluate(node=>Math.round(node.getBoundingClientRect().left))).toBe(8);
  const mobile=await detail.evaluate(node=>{const support=node.querySelector('.task-detail-support').getBoundingClientRect(),rail=node.querySelector('.task-detail-rail').getBoundingClientRect();return {width:node.getBoundingClientRect().width,supportBottom:support.bottom,railTop:rail.top,overflow:node.scrollWidth>node.clientWidth+1};});
  expect(mobile.width).toBeCloseTo(374,0);expect(mobile.overflow).toBe(false);
  expect(mobile.railTop).toBeGreaterThanOrEqual(mobile.supportBottom-1);
  await run.page.screenshot({path:testInfo.outputPath('task-fidelity-390.png'),animations:'disabled'});

  await title.fill('Unsaved camera direction');
  run.page.once('dialog',dialog=>dialog.dismiss());await run.page.goBack();
  await expect(title).toHaveValue('Unsaved camera direction');
  await expect(run.page).toHaveURL(new RegExp('task='+task.id+'$'));
  await detail.locator('#task-menu-trigger').click();
  await expect(run.page.locator('.sidebar')).toBeVisible();
  run.page.once('dialog',dialog=>dialog.accept());
  await run.page.locator('[data-project-navigation] .nav-link').filter({hasText:'Overview'}).click();
  await expect(detail).not.toBeVisible();await expect(run.page.locator('#main h1')).toHaveText(project.title);
 }finally{await run.context.close();}
});

test('a task deep link cannot reveal a different artists private work',async({browser})=>{
 const founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),data=await profiles();
 try{
  const owner=data.users.find(person=>person.key==='artist_2');
  const response=await mutate(founder.context,'/tasks',{title:'[QA] Private task URL '+Date.now().toString(36),section:'projects',owner_id:owner.id});
  expect(response.status()).toBe(201);const task=await response.json();
  const denied=await artist.context.request.get('/api/tasks/'+task.id);expect([403,404]).toContain(denied.status());
  await artist.page.goto('/workspace#tasks?task='+task.id);
  await expect(artist.page.locator('#main [role="alert"]')).toBeVisible();
  await expect(artist.page.getByRole('dialog')).not.toBeVisible();
  expect(await artist.page.locator('#app').innerText()).not.toContain(task.title);
 }finally{await Promise.all([founder.context.close(),artist.context.close()]);}
});
