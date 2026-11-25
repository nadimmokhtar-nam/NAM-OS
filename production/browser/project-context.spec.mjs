import {test,expect} from '@playwright/test';
import {actor,profiles,mutate} from './support.mjs';

const label=prefix=>'[QA] '+prefix+' '+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
async function projectFixture(context,data,title,dueDate='2030-01-01'){
 const founder=data.users.find(user=>user.key==='founder'),artist=data.users.find(user=>user.key==='artist_1');
 const response=await mutate(context,'/projects',{title,brief:'Keep the agreed camera and soft directional daylight.',outcome:'An internally reviewed image with its delivery checklist complete.',lead_id:founder.id,member_ids:[artist.id],due_date:dueDate});
 expect(response.status()).toBe(201);
 return response.json();
}
async function openWorkTask(page,title){
 await page.locator('#task-search').fill(title);
 const task=page.locator('.task-open').filter({hasText:title});
 await expect(task).toHaveCount(1);await task.click();
 await expect(page.getByRole('dialog').getByLabel('Task name',{exact:true})).toHaveValue(title);
}

// These checks use eight-user setup sessions and the actual isolated provider.
// They never modify a hosted tenant or substitute a passing API response.
test('global Work creation changes from Sales to project work and assigns one real linked deliverable',async({browser})=>{
 const data=await profiles(),founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1');
 try{
  const person=data.users.find(user=>user.key==='artist_1'),other=data.users.find(user=>user.key==='artist_2'),lead=data.users.find(user=>user.key==='founder');
  const project=await projectFixture(founder.context,data,label('Global creation project')),title=label('Global linked render');
  await founder.page.goto('/workspace#tasks');
  await founder.page.getByRole('button',{name:'Create task',exact:true}).click();
  const dialog=founder.page.getByRole('dialog'),section=dialog.getByLabel('Section',{exact:true});
  await expect(section).toHaveValue('sales');
  await section.selectOption('projects');
  const picker=dialog.getByLabel('Project',{exact:true}),stage=dialog.getByLabel('Production stage',{exact:true}),owner=dialog.getByLabel('Owner',{exact:true});
  await expect(picker).toBeVisible();await expect(stage).toBeVisible();
  await expect(picker.locator('option[value="'+project.id+'"]')).toHaveCount(1);
  await picker.selectOption(project.id);
  await expect(owner).toBeEnabled();
  await expect.poll(()=>owner.evaluate(control=>Array.from(control.options,option=>option.value).sort())).toEqual([lead.id,person.id].sort());
  expect(await owner.locator('option[value="'+other.id+'"]').count()).toBe(0);
  await owner.selectOption(person.id);await stage.selectOption('Lighting');
  await dialog.getByLabel('Task name',{exact:true}).fill(title);
  await dialog.getByLabel('What needs to happen?',{exact:true}).fill('Prepare the first lighting pass using the shared brief.');
  const response=founder.page.waitForResponse(result=>result.url().endsWith('/api/tasks')&&result.request().method()==='POST');
  await dialog.getByRole('button',{name:'Create task',exact:true}).click();
  const createdResponse=await response;expect(createdResponse.status()).toBe(201);const task=await createdResponse.json();
  await expect(dialog.locator('.context-title')).toHaveText(project.title);
  expect(task.project_id).toBe(project.id);expect(task.owner_id).toBe(person.id);expect(task.production_stage).toBe('Lighting');
  const listing=await founder.context.request.get('/api/tasks?project_id='+project.id+'&page=1');expect(listing.status()).toBe(200);
  const items=await listing.json();expect(items.total).toBe(1);expect(items.items.filter(row=>row.id===task.id&&row.title===title)).toHaveLength(1);
  expect((await artist.context.request.get('/api/projects/'+project.id)).status()).toBe(200);
  const assigned=await artist.context.request.get('/api/tasks/'+task.id);expect(assigned.status()).toBe(200);expect((await assigned.json()).project.id).toBe(project.id);
 }finally{await Promise.all([founder.context.close(),artist.context.close()]);}
});

test('opening a project then editing standalone Work preserves its explicit lack of project context',async({browser})=>{
 const data=await profiles(),founder=await actor(browser,'founder');
 try{
  const project=await projectFixture(founder.context,data,label('Visited project')),title=label('Standalone production work'),lead=data.users.find(user=>user.key==='founder');
  const created=await mutate(founder.context,'/tasks',{title,section:'projects',owner_id:lead.id,description:'A studio operation without a project.'});
  expect(created.status()).toBe(201);const task=await created.json();expect(task.project_id).toBeNull();
  await founder.page.goto('/workspace#projects/'+project.id);await expect(founder.page.getByRole('heading',{name:project.title,exact:true})).toBeVisible();
  // Keep the same mounted application so the previously selected project remains
  // in the controller; a full reload would fail to reproduce the original defect.
  await founder.page.getByRole('button',{name:'Back to projects',exact:true}).click();
  await expect(founder.page.locator('#main h1')).toHaveText('Projects');
  await founder.page.locator('.sidebar .nav-link[href="#tasks"]').click();
  await openWorkTask(founder.page,title);
  const dialog=founder.page.getByRole('dialog');await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue('');
  await dialog.getByLabel('What needs to happen?',{exact:true}).fill('Clarify the standalone studio responsibility.');
  const response=founder.page.waitForResponse(result=>result.url().endsWith('/api/tasks/'+task.id)&&result.request().method()==='PATCH');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  const savedResponse=await response;expect(savedResponse.status()).toBe(200);
  const changes=savedResponse.request().postDataJSON().changes;expect(changes).not.toHaveProperty('project_id');expect(changes).not.toHaveProperty('production_stage');
  const saved=await (await founder.context.request.get('/api/tasks/'+task.id)).json();
  expect(saved.project_id).toBeNull();expect(saved.production_stage).toBeNull();expect(saved.description).toBe('Clarify the standalone studio responsibility.');
 }finally{await founder.context.close();}
});

test('revoked project sharing retains the assigned task and ordinary edits preserve its hidden project association',async({browser})=>{
 const data=await profiles(),founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1');
 try{
  const person=data.users.find(user=>user.key==='artist_1'),project=await projectFixture(founder.context,data,label('Revoked shared brief'),'0001-01-01'),title=label('Assigned task after brief revocation');
  const created=await mutate(founder.context,'/tasks',{title,section:'projects',owner_id:person.id,project_id:project.id,production_stage:'Lighting',status:'In progress',description:'Resolve the assigned lighting adjustment.'});
  expect(created.status()).toBe(201);const task=await created.json();
  const before=await artist.context.request.get('/api/brief');expect(before.status()).toBe(200);expect((await before.json()).projects.some(row=>row.id===project.id)).toBe(true);
  const removed=await mutate(founder.context,'/projects/'+project.id,{expectedVersion:project.version,changes:{member_ids:[]}},'PATCH');expect(removed.status()).toBe(200);
  expect((await artist.context.request.get('/api/projects/'+project.id)).status()).toBe(404);
  await artist.page.goto('/workspace#tasks');await openWorkTask(artist.page,title);
  const dialog=artist.page.getByRole('dialog');
  await expect(dialog.locator('.notice').filter({hasText:'project brief is not shared'})).toBeVisible();
  await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue(project.id);await expect(dialog.getByText(project.title,{exact:true})).toHaveCount(0);
  await dialog.getByLabel('What needs to happen?',{exact:true}).fill('The assigned lighting adjustment is ready for the next internal review.');
  await dialog.getByLabel('Priority',{exact:true}).selectOption('High');
  const response=artist.page.waitForResponse(result=>result.url().endsWith('/api/tasks/'+task.id)&&result.request().method()==='PATCH');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  const savedResponse=await response;expect(savedResponse.status()).toBe(200);
  const changes=savedResponse.request().postDataJSON().changes;expect(changes).not.toHaveProperty('project_id');expect(changes).not.toHaveProperty('production_stage');
  const saved=await (await artist.context.request.get('/api/tasks/'+task.id)).json();
  expect(saved.project_id).toBe(project.id);expect(saved.production_stage).toBe('Lighting');expect(saved.owner_id).toBe(person.id);expect(saved.priority).toBe('High');expect(saved.description).toBe('The assigned lighting adjustment is ready for the next internal review.');expect(saved.project).toBeNull();
  expect((await artist.context.request.get('/api/projects/'+project.id)).status()).toBe(404);
  const after=await artist.context.request.get('/api/brief');expect(after.status()).toBe(200);expect((await after.json()).projects.some(row=>row.id===project.id)).toBe(false);
 }finally{await Promise.all([founder.context.close(),artist.context.close()]);}
});
