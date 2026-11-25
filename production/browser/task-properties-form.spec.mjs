import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {actor,profiles,mutate} from './support.mjs';

// Native form association and real isolated-provider writes. Authentication,
// authorization, reads and child writes are never mocked. Only the second
// case's first parent PATCH receives a named, safe503 failure fixture.
async function fixture(browser){
 const run=await actor(browser,'founder'),data=await profiles();
 const founder=data.users.find(user=>user.key==='founder'),artist=data.users.find(user=>user.key==='artist_1');
 const marker='[QA] Associated properties '+randomUUID(),projects=[];let task;
 async function cleanup(){
  try{
   if(task){
    const response=await run.context.request.get('/api/tasks/'+task.id);
    if(response.status()===200){const current=await response.json();expect(current.title.startsWith(marker)).toBe(true);expect((await mutate(run.context,'/tasks/'+task.id,{expectedVersion:current.version},'DELETE')).status()).toBe(200);}
    else expect(response.status()).toBe(404);
   }
   for(const project of projects){
    const response=await run.context.request.get('/api/projects/'+project.id);expect(response.status()).toBe(200);
    const current=await response.json();expect(current.title.startsWith(marker)).toBe(true);
    expect((await mutate(run.context,'/projects/'+project.id,{expectedVersion:current.version,changes:{archived:true}},'PATCH')).status()).toBe(200);
   }
  }finally{await run.context.close();}
 }
 try{
  for(const suffix of ['Initial brief','Selected brief']){
   const response=await mutate(run.context,'/projects',{title:marker+' / '+suffix,brief:'Synthetic form-association verification only.',outcome:'All parent properties persist together.',lead_id:founder.id,member_ids:[founder.id,artist.id]});
   expect(response.status()).toBe(201);projects.push(await response.json());
  }
  const response=await mutate(run.context,'/tasks',{title:marker+' / Initial task',description:'Saved initial direction.',section:'projects',owner_id:founder.id,status:'Todo',priority:'Normal',due_date:'2026-12-08',project_id:projects[0].id,production_stage:'Brief'});
  expect(response.status()).toBe(201);task=await response.json();
  await run.page.goto('/workspace#tasks');await run.page.locator('#task-search').fill(task.title);
  await run.page.locator('[data-action="open-task"][data-id="'+task.id+'"]').click();
  const dialog=run.page.getByRole('dialog');await expect(dialog.locator('#task-edit-form')).toBeVisible();
  const save=dialog.getByRole('button',{name:'Save changes',exact:true});await expect(save).toBeEnabled();
  return {...run,marker,projects,task,artist,founder,dialog,save,cleanup};
 }catch(error){await cleanup();throw error;}
}

async function ownership(run){
 const result=await run.dialog.evaluate(dialog=>{
  const form=dialog.querySelector('#task-edit-form'),names=['status','priority','due_date','owner_id','section','project_id','production_stage'];
  const properties=names.map(name=>{const control=form.elements.namedItem(name);return {name,present:!!control,owned:control?.form===form,outside:!!control&&!form.contains(control)};});
  const save=dialog.querySelector('button[type="submit"][form="task-edit-form"]');
  const children=[...dialog.querySelectorAll('form[data-form="comment"],form[data-form="subtask"],form[data-file-form]')];
  return {properties,saveOwned:save?.form===form,saveOutside:!!save&&!form.contains(save),childCount:children.length,childrenIndependent:children.every(child=>[...child.elements].every(control=>control.form===child&&control.form!==form)),parentKeys:[...new FormData(form).keys()].sort()};
 });
 expect(result.properties).toEqual(['status','priority','due_date','owner_id','section','project_id','production_stage'].map(name=>({name,present:true,owned:true,outside:true})));
 expect(result.saveOwned).toBe(true);expect(result.saveOutside).toBe(true);
 expect(result.childCount).toBe(3);expect(result.childrenIndependent).toBe(true);
 expect(result.parentKeys).toEqual(['title','description','status','priority','due_date','owner_id','section','project_id','production_stage'].sort());
}

async function draft(run,{regenerate=false}={}){
 const values={title:run.marker+' / Reviewed image',description:'The whole parent draft must remain intact during independent child saves.',status:'Blocked',priority:'Urgent',due_date:'2026-12-18',owner_id:run.artist.id,section:'projects',project_id:run.projects[1].id,production_stage:'Internal review'};
 await run.dialog.getByLabel('Task name',{exact:true}).fill(values.title);await run.dialog.getByLabel('What needs to happen?',{exact:true}).fill(values.description);
 if(regenerate){
  await run.dialog.getByLabel('Section',{exact:true}).selectOption('operations');await expect(run.dialog.getByLabel('Project',{exact:true})).toHaveCount(0);
  await run.dialog.getByLabel('Section',{exact:true}).selectOption('projects');await expect(run.dialog.getByLabel('Project',{exact:true})).toBeVisible();
  await expect(run.dialog.getByLabel('Owner',{exact:true})).toBeEnabled();await expect(run.save).toBeEnabled();
  await ownership(run);
 }
 await run.dialog.getByLabel('Project',{exact:true}).selectOption(values.project_id);
 await expect(run.dialog.getByLabel('Owner',{exact:true})).toBeEnabled();await expect(run.save).toBeEnabled();
 await run.dialog.getByLabel('Owner',{exact:true}).selectOption(values.owner_id);
 await run.dialog.getByLabel('Production stage',{exact:true}).selectOption(values.production_stage);
 await run.dialog.getByLabel('Status',{exact:true}).selectOption(values.status);await run.dialog.getByLabel('Priority',{exact:true}).selectOption(values.priority);await run.dialog.getByLabel('Due date',{exact:true}).fill(values.due_date);
 return values;
}

async function expectDraft(run,values){
 await expect(run.save).toBeEnabled();
 const actual=await run.dialog.locator('#task-edit-form').evaluate(form=>Object.fromEntries(new FormData(form)));
 expect(actual).toEqual(values);await ownership(run);
}
async function saved(run){const response=await run.context.request.get('/api/tasks/'+run.task.id);expect(response.status()).toBe(200);return response.json();}
function expectOriginal(actual,run){for(const key of ['title','description','status','priority','due_date','owner_id','section','project_id','production_stage'])expect(actual[key],key+' must remain unchanged until the parent save').toBe(run.task[key]);}
function expectPersisted(actual,values){for(const [key,value]of Object.entries(values))expect(actual[key],key+' must persist through the same parent revision').toBe(value);}

test('native associated properties persist as one parent save while child forms retain independent drafts and writes',async({browser})=>{
 const run=await fixture(browser),parentRequests=[];
 run.page.on('request',request=>{if(new URL(request.url()).pathname==='/api/tasks/'+run.task.id&&request.method()==='PATCH')parentRequests.push(request);});
 try{
  await ownership(run);const values=await draft(run,{regenerate:true});await expectDraft(run,values);
  expectOriginal(await saved(run),run);expect(parentRequests.length).toBe(0);
  const comment='[QA] Independent comment '+run.marker;
  await run.dialog.getByLabel('Add a comment',{exact:true}).fill(comment);
  const commentSaved=run.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/'+run.task.id+'/comments'&&response.request().method()==='POST');
  await run.dialog.getByRole('button',{name:'Add comment',exact:true}).click();expect((await commentSaved).status()).toBe(200);
  await expect(run.dialog.locator('.comment')).toContainText(comment);await expectDraft(run,values);
  const childTitle='[QA] Independent subtask '+run.marker;await run.dialog.getByLabel('New subtask',{exact:true}).fill(childTitle);
  const childSaved=run.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/'+run.task.id+'/subtasks'&&response.request().method()==='POST');
  await run.dialog.locator('form[data-form="subtask"]').getByRole('button',{name:'Add',exact:true}).click();expect((await childSaved).status()).toBe(200);
  await expect(run.dialog.locator('.check-row')).toContainText(childTitle);await expectDraft(run,values);
  const beforeParent=await saved(run);expectOriginal(beforeParent,run);expect(beforeParent.comments.some(item=>item.body===comment)).toBe(true);expect(beforeParent.subtasks.some(item=>item.title===childTitle)).toBe(true);expect(parentRequests.length).toBe(0);
  const committed=run.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/'+run.task.id&&response.request().method()==='PATCH');
  await run.save.click();const response=await committed;expect(response.status()).toBe(200);await expect(run.page.locator('#toast')).toContainText('Task saved');await expect(run.save).toBeEnabled();
  expect(parentRequests.length).toBe(1);const body=parentRequests[0].postDataJSON();expect(body.expectedVersion).toBe(beforeParent.version);expect(body.changes).toEqual(values);
  const actual=await saved(run);expectPersisted(actual,values);expect(actual.comments.some(item=>item.body===comment)).toBe(true);expect(actual.subtasks.some(item=>item.title===childTitle)).toBe(true);
 }finally{await run.cleanup();}
});

test('a rejected associated parent save retains every property and restores external Save focus before a real retry',async({browser})=>{
 const run=await fixture(browser);let attempts=0;
 try{
  const values=await draft(run);await expectDraft(run,values);
  await run.page.route('**/api/tasks/'+run.task.id,async route=>{
   if(route.request().method()!=='PATCH')return route.continue();attempts++;
   if(attempts===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic parent save interruption. The saved task was unchanged.'})});
   return route.continue();
  });
  await run.save.focus();await run.save.press('Enter');await expect(run.dialog.locator('form[data-form="edit-task"] .form-error')).toContainText('Synthetic parent save interruption');
  await expectDraft(run,values);await expect(run.save).toBeFocused();expectOriginal(await saved(run),run);
  const committed=run.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/'+run.task.id&&response.request().method()==='PATCH'&&response.status()===200);
  await run.save.press('Enter');expect((await committed).status()).toBe(200);await expect(run.page.locator('#toast')).toContainText('Task saved');await expect(run.save).toBeEnabled();
  expect(attempts).toBe(2);expectPersisted(await saved(run),values);
 }finally{await run.cleanup();}
});
