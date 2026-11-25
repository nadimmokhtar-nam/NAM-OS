import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,mutate} from './support.mjs';

const unique=prefix=>'[QA] '+prefix+' '+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);
async function fixture(browser){
 const data=await profiles(),founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),other=await actor(browser,'artist_2');
 const primary=data.users.find(user=>user.key==='artist_1'),secondary=data.users.find(user=>user.key==='artist_2'),lead=data.users.find(user=>user.key==='founder');
 const response=await mutate(founder.context,'/projects',{title:unique('Camera inventory'),brief:'Retain the camera eye level and agreed composition.',lead_id:lead.id,member_ids:[primary.id,secondary.id]});expect(response.status()).toBe(201);
 const project=await response.json();return {founder,artist,other,primary,secondary,project,async close(){await Promise.all([founder.context.close(),artist.context.close(),other.context.close()]);}};
}
async function add(run,changes={}){const response=await mutate(run.founder.context,'/projects/'+run.project.id+'/deliverables',{code:'INT-01',title:unique('Living room hero'),artist_id:run.primary.id,stage:'Camera approval',...changes});expect(response.status()).toBe(201);return response.json();}
const route=run=>'/workspace#projects/'+run.project.id+'/images';
const row=(page,id)=>page.locator('.deliverable-row[data-id="'+id+'"]');

test('camera inventory creates one real image and its task remains the same record in central Work',async({browser})=>{
 const run=await fixture(browser),page=run.founder.page;
 try{
  await page.goto(route(run));await page.getByRole('button',{name:'Add deliverable',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Camera code',{exact:true}).fill('int-01');await dialog.getByLabel('Deliverable name',{exact:true}).fill(unique('Living room hero'));
  await dialog.getByLabel('Assigned artist',{exact:true}).selectOption(run.primary.id);await dialog.getByLabel('Production stage',{exact:true}).selectOption('Camera approval');await dialog.getByLabel('Camera brief',{exact:true}).fill('Keep the camera at the agreed eye level.');
  const saving=page.waitForResponse(response=>response.url().includes('/deliverables')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create deliverable',exact:true}).click();const saved=await saving;expect(saved.status()).toBe(201);const image=await saved.json();
  await expect(dialog).not.toBeVisible();await expect(row(page,image.id)).toContainText('INT-01');
  await row(page,image.id).click();await dialog.getByRole('button',{name:'Add task',exact:true}).click();
  await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue(run.project.id);await expect(dialog.getByLabel('Image / deliverable',{exact:true})).toHaveValue(image.id);await expect(dialog.getByLabel('Owner',{exact:true})).toHaveValue(run.primary.id);await expect(dialog.getByLabel('Production stage',{exact:true})).toHaveValue('Camera approval');
  const title=unique('Prepare image camera');await dialog.getByLabel('Task name',{exact:true}).fill(title);
  const created=page.waitForResponse(response=>response.url().endsWith('/api/tasks')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create task',exact:true}).click();const taskResponse=await created;expect(taskResponse.status()).toBe(201);const task=await taskResponse.json();
  expect(task.deliverable_id).toBe(image.id);await expect(dialog.getByLabel('Task name',{exact:true})).toHaveValue(title);
  await dialog.locator('[data-action="close-dialog"]').click();await page.goto('/workspace#tasks');await page.locator('#task-search').fill(title);const central=page.locator('.task-open[data-id="'+task.id+'"]');await expect(central).toHaveCount(1);await expect(central).toContainText('INT-01');await central.click();await expect(dialog.getByLabel('Image / deliverable',{exact:true})).toHaveValue(image.id);
  const completed=await mutate(run.founder.context,'/tasks/'+task.id,{expectedVersion:task.version,changes:{status:'Done'}},'PATCH');expect(completed.status()).toBe(200);
  const unchanged=await (await run.founder.context.request.get('/api/deliverables/'+image.id)).json();expect(unchanged.stage).toBe('Camera approval');expect(unchanged).not.toHaveProperty('approved');
 }finally{await run.close();}
});

test('artists receive only assigned images and explicitly linked task briefs without private task disclosure',async({browser})=>{
 const run=await fixture(browser);
 try{
  const image=await add(run),second=await add(run,{code:'INT-02',artist_id:run.secondary.id});
  const privateTask=await mutate(run.founder.context,'/tasks',{title:unique('Private management notes'),section:'projects',owner_id:(await profiles()).users.find(user=>user.key==='founder').id,project_id:run.project.id,deliverable_id:image.id});expect(privateTask.status()).toBe(201);const privateRecord=await privateTask.json();
  await run.artist.page.goto(route(run));await expect(row(run.artist.page,image.id)).toBeVisible();await expect(row(run.artist.page,second.id)).toHaveCount(0);await row(run.artist.page,image.id).click();
  const editor=run.artist.page.getByRole('dialog');await expect(editor.getByLabel('Camera brief',{exact:true})).toBeVisible();await expect(editor.getByLabel('Deliverable name',{exact:true})).toHaveCount(0);
  expect((await run.other.context.request.get('/api/deliverables/'+image.id)).status()).toBe(404);
  const sharedTask=await mutate(run.founder.context,'/tasks',{title:unique('Shared secondary camera work'),section:'projects',owner_id:run.secondary.id,project_id:run.project.id,deliverable_id:image.id});expect(sharedTask.status()).toBe(201);const shared=await sharedTask.json();
  await run.other.page.goto(route(run));await expect(row(run.other.page,image.id)).toBeVisible();await row(run.other.page,image.id).click();const reader=run.other.page.getByRole('dialog');await expect(reader.getByRole('button',{name:'Save deliverable',exact:true})).toHaveCount(0);await expect(reader.getByText(shared.title,{exact:true})).toBeVisible();await expect(reader.getByText(privateRecord.title,{exact:true})).toHaveCount(0);
  const denied=await mutate(run.other.context,'/deliverables/'+image.id,{expectedVersion:1,changes:{stage:'Delivery'}},'PATCH');expect([403,404]).toContain(denied.status());
  const direct=await run.other.context.request.get('/api/tasks/'+privateRecord.id);expect([403,404]).toContain(direct.status());
 }finally{await run.close();}
});

test('conflicting image edits preserve the draft and pending saves retain the drawer until acknowledged',async({browser})=>{
 const run=await fixture(browser);let release;
 try{
  const image=await add(run),page=run.artist.page;await page.goto(route(run));await row(page,image.id).click();const dialog=page.getByRole('dialog'),brief=dialog.getByLabel('Camera brief',{exact:true});await brief.fill('My unsaved camera direction.');
  const newer=await mutate(run.founder.context,'/deliverables/'+image.id,{expectedVersion:1,changes:{title:unique('Updated management title')}},'PATCH');expect(newer.status()).toBe(200);
  await dialog.getByRole('button',{name:'Save deliverable',exact:true}).click();await expect(dialog.locator('.form-error')).toContainText('changed elsewhere');await expect(brief).toHaveValue('My unsaved camera direction.');
  page.once('dialog',prompt=>prompt.accept());await dialog.locator('.form-error').getByRole('button',{name:'Reload latest',exact:true}).click();await expect(brief).toHaveValue('');
  await brief.fill('Acknowledged camera direction.');let started;const seen=new Promise(done=>started=done),hold=new Promise(done=>release=done);
  await page.route('**/api/deliverables/'+image.id,async intercepted=>{if(intercepted.request().method()!=='PATCH')return intercepted.continue();const response=await intercepted.fetch();started();await hold;await intercepted.fulfill({response});});
  await dialog.getByRole('button',{name:'Save deliverable',exact:true}).click();await seen;await expect(brief).toBeDisabled();await expect(dialog.locator('[data-action="close-dialog"]')).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();release();await expect(dialog).not.toBeVisible();
  const saved=await (await run.founder.context.request.get('/api/deliverables/'+image.id)).json();expect(saved.version).toBe(3);expect(saved.camera_notes).toBe('Acknowledged camera direction.');
 }finally{release?.();await run.close();}
});

test('image rows keep their reference dimensions, remain usable on mobile, and archive restores their identity',async({browser},testInfo)=>{
 const run=await fixture(browser),page=run.founder.page;
 try{
  const image=await add(run,{due_date:'2030-01-01'});await page.goto(route(run));const imageRow=row(page,image.id);await expect(imageRow).toBeVisible();const geometry=await imageRow.evaluate(node=>({height:node.getBoundingClientRect().height,radius:getComputedStyle(node).borderRadius}));expect(geometry.height).toBeCloseTo(48,0);expect(geometry.radius).toBe('10px');
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(audit.violations.map(item=>({id:item.id,impact:item.impact}))).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('task-fidelity-deliverables-1440.png'),animations:'disabled'});await page.setViewportSize({width:390,height:844});await expect(imageRow).toBeVisible();expect(await imageRow.evaluate(node=>node.scrollWidth>node.clientWidth+1)).toBe(false);await expect(imageRow.locator('.deliverable-stage')).toBeVisible();await expect(imageRow.locator('.deliverable-artist')).toBeVisible();
  await imageRow.click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Archive deliverable',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(imageRow).toHaveCount(0);
  await page.getByRole('button',{name:'Archived',exact:true}).click();await expect(imageRow).toBeVisible();await imageRow.click();await expect(dialog.getByRole('button',{name:'Save deliverable',exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Restore deliverable',exact:true}).click();await expect(dialog).not.toBeVisible();await page.getByRole('button',{name:'Active',exact:true}).click();await expect(imageRow).toBeVisible();
  expect((await (await run.founder.context.request.get('/api/deliverables/'+image.id)).json()).version).toBe(3);await page.screenshot({path:testInfo.outputPath('task-fidelity-deliverables-390.png'),animations:'disabled'});
 }finally{await run.close();}
});
