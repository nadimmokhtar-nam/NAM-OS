import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {actor,profiles,origin} from './support.mjs';

// Actual managed sessions, PostgREST/RPCs and native browser forms. No route,
// authorization or task-response fixtures replace the application backend.
async function fixture(browser,label){
 const data=await profiles(),provider=new URL(data.origin),application=new URL(origin);
 if(!['127.0.0.1','localhost'].includes(provider.hostname)||provider.port!=='54321'||!['127.0.0.1','localhost'].includes(application.hostname)||application.port!=='3100')throw Error('Task scheduling QA requires the disposable loopback application and provider.');
 const founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),owner=data.users.find(user=>user.key==='artist_1'),other=data.users.find(user=>user.key==='artist_2'),marker='[QA] '+label+' '+randomUUID();
 async function headers(run){const response=await run.context.request.get('/api/bootstrap');expect(response.status()).toBe(200);const bootstrap=await response.json();return {bootstrap,value:{Origin:origin,'X-CSRF-Token':bootstrap.csrf}};}
 try{
  const founderAuth=await headers(founder),artistAuth=await headers(artist);
  async function create(title,changes={},run=founder){const response=await run.context.request.post('/api/tasks',{headers:{...(run===founder?founderAuth.value:artistAuth.value),'Idempotency-Key':randomUUID()},data:{title:marker+' / '+title,section:'projects',owner_id:owner.id,description:'Synthetic scheduling verification.',status:'Todo',priority:'Normal',...changes}});expect(response.status()).toBe(201);return response.json();}
  async function close(){
   try{
    const auth=await headers(founder),response=await founder.context.request.get('/api/tasks?'+new URLSearchParams({page:'1',page_size:'200',search:marker,sort:'newest'}));expect(response.status()).toBe(200);const records=await response.json();expect(records.hasMore).toBe(false);
    // Newest first removes dependents and repeat successors before the earlier
    // prerequisite. Only this test's synthetic marker is eligible for cleanup.
    for(const task of records.items){expect(task.title.startsWith(marker+' / ')).toBe(true);const removed=await founder.context.request.delete('/api/tasks/'+task.id,{headers:auth.value,data:{expectedVersion:task.version}});expect(removed.status()).toBe(200);}
   }finally{await Promise.all([founder.context.close(),artist.context.close()]);}
  }
  return {founder,artist,owner,other,marker,today:artistAuth.bootstrap.today,artistHeaders:artistAuth.value,create,close};
 }catch(error){await Promise.all([founder.context.close(),artist.context.close()]);throw error;}
}
const plus=(value,days)=>new Date(Date.parse(value+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const dayAfter=value=>plus(value,1);
function monthBounds(value){const start=value.slice(0,7)+'-01',next=new Date(start+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);return {from:start,to:new Date(next.getTime()-86400000).toISOString().slice(0,10),next:next.toISOString().slice(0,10)};}
function responseFor(page,path,query={}){return page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api'+path&&response.request().method()==='GET'&&Object.entries(query).every(([key,value])=>url.searchParams.get(key)===String(value));});}
async function search(page,value){const loaded=responseFor(page,'/tasks',{search:value,page:1});await page.locator('#task-search').fill(value);const response=await loaded;expect(response.status()).toBe(200);return response.json();}
async function scheduling(run,id){const response=await run.artist.context.request.get('/api/tasks/'+id+'/scheduling');expect(response.status()).toBe(200);return response.json();}
async function saveParent(page,id,status){const dialog=page.getByRole('dialog');await dialog.getByLabel('Status',{exact:true}).selectOption(status);const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/'+id&&response.request().method()==='PATCH');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();return saved;}

test('calendar date windows and filters use authorized server records across calendar navigation',async({browser})=>{
 let run;
 try{
  let current,outside,hidden,window;
  await test.step('Create isolated dated and undated tasks for distinct assignees',async()=>{
   run=await fixture(browser,'Calendar records');window=monthBounds(run.today);
   current=await run.create('Current month',{due_date:run.today,status:'Blocked',priority:'High'});outside=await run.create('Following month',{due_date:window.next,status:'Blocked',priority:'High'});hidden=await run.create('Other assignee private',{owner_id:run.other.id,due_date:run.today,status:'Blocked',priority:'High'});await run.create('No due date',{due_date:null,status:'Blocked',priority:'High'});
  });
  await test.step('Show the exact month and exclude another assignee and dates outside it',async()=>{
   const page=run.artist.page;await page.goto('/workspace#tasks');await search(page,run.marker);
   const loaded=responseFor(page,'/tasks/calendar',{from:window.from,to:window.to,search:run.marker});await page.locator('[data-action="view-mode"][data-value="calendar"]').click();const response=await loaded;expect(response.status()).toBe(200);const result=await response.json();
   expect(result.items.map(task=>task.id)).toEqual([current.id]);expect(result.total).toBe(1);expect(result.unscheduled_total).toBe(1);expect(result.scope).toBe('assigned');expect(result.timezone).toBe('Europe/Paris');
   await expect(page.locator('.calendar-summary')).toContainText('1 of 1 matching scheduled tasks loaded');await expect(page.locator('[data-schedule-action="task"][data-id="'+current.id+'"]').first()).toBeVisible();await expect(page.locator('[data-schedule-action="task"][data-id="'+outside.id+'"]')).toHaveCount(0);expect(await page.locator('#main').innerText()).not.toContain(hidden.title);
   expect([403,404]).toContain((await run.artist.context.request.get('/api/tasks/'+hidden.id)).status());
   const studio=await run.founder.context.request.get('/api/tasks/calendar?'+new URLSearchParams({from:window.from,to:window.to,search:run.marker}));expect(studio.status()).toBe(200);expect((await studio.json()).total).toBe(2);
  });
  await test.step('Apply server priority filters and advance to a different explicit window',async()=>{
   const page=run.artist.page;let loaded=responseFor(page,'/tasks/calendar',{from:window.from,to:window.to,search:run.marker,priority:'Low'});await page.locator('#filter-priority').selectOption('Low');expect((await loaded).status()).toBe(200);await expect(page.locator('.calendar-summary')).toContainText('0 of 0 matching scheduled tasks loaded');
   loaded=responseFor(page,'/tasks/calendar',{from:window.from,to:window.to,search:run.marker,priority:'High'});await page.locator('#filter-priority').selectOption('High');expect((await loaded).status()).toBe(200);await expect(page.locator('.calendar-summary')).toContainText('1 of 1 matching scheduled tasks loaded');
   const next=monthBounds(window.next);loaded=responseFor(page,'/tasks/calendar',{from:next.from,to:next.to,search:run.marker,priority:'High'});await page.locator('.task-calendar-tools [data-schedule-action="next"]').click();const response=await loaded;expect(response.status()).toBe(200);expect((await response.json()).items.map(task=>task.id)).toEqual([outside.id]);await expect(page.locator('[data-schedule-action="task"][data-id="'+outside.id+'"]').first()).toBeVisible();await expect(page.locator('[data-schedule-action="task"][data-id="'+current.id+'"]')).toHaveCount(0);
  });
 }finally{await run?.close();}
});

test('native task sorting orders the complete matching set before first and subsequent pages',async({browser})=>{
 test.setTimeout(120000);let run;
 try{
  await test.step('Create a bounded task set whose alphabetical first item has the latest due date',async()=>{
   run=await fixture(browser,'Server sort');
   // Four isolated requests per batch keep setup bounded. Unique due dates
   // fix the initial reverse-name order independently of completion timing.
   for(let number=61;number>=1;number-=4)await Promise.all(Array.from({length:Math.min(4,number)},(_,offset)=>number-offset).map(value=>run.create(String(value).padStart(3,'0'),{due_date:plus(run.today,61-value)},run.artist)));
  });
  await test.step('Choose Name and receive the correct first fifty from the server',async()=>{
   const page=run.artist.page;await page.goto('/workspace#tasks');const initial=await search(page,run.marker);expect(initial.total).toBe(61);expect(initial.items).toHaveLength(50);expect(initial.items[0].title).toBe(run.marker+' / 061');
   const loaded=responseFor(page,'/tasks',{search:run.marker,sort:'title',page:1});await page.locator('#filter-sort').selectOption('title');const response=await loaded;expect(response.status()).toBe(200);const result=await response.json();expect(result.total).toBe(61);expect(result.sort).toBe('title');expect(result.items[0].title).toBe(run.marker+' / 001');expect(result.items.at(-1).title).toBe(run.marker+' / 050');
   await expect(page.locator('#task-results .task-open .title')).toHaveText(Array.from({length:50},(_,index)=>run.marker+' / '+String(index+1).padStart(3,'0')));
  });
  await test.step('Load the remaining page and retain the same stable server order in Board view',async()=>{
   const page=run.artist.page;let loaded=responseFor(page,'/tasks',{search:run.marker,sort:'title',page:2});await page.locator('[data-action="load-more"]').click();const response=await loaded;expect(response.status()).toBe(200);const second=await response.json();expect(second.items).toHaveLength(11);expect(second.items[0].title).toBe(run.marker+' / 051');
   const titles=Array.from({length:61},(_,index)=>run.marker+' / '+String(index+1).padStart(3,'0'));await expect(page.locator('#task-results .task-open .title')).toHaveText(titles);const ids=await page.locator('#task-results .task-open').evaluateAll(nodes=>nodes.map(node=>node.dataset.id));expect(new Set(ids).size).toBe(61);
   loaded=responseFor(page,'/tasks',{search:run.marker,sort:'title',page:1});await page.locator('[data-action="view-mode"][data-value="board"]').click();expect((await loaded).status()).toBe(200);await expect(page.locator('#filter-sort')).toHaveValue('title');await expect(page.locator('.board-col[data-drop="Todo"] .task-card h3')).toHaveText(titles.slice(0,50));
  });
 }finally{await run?.close();}
});

test('task rail prerequisites gate completion and repeating completion creates one stable real successor',async({browser})=>{
 test.setTimeout(90000);let run;
 try{
  let prerequisite,current,next;
  await test.step('Create a prerequisite and a task with a dated repeat',async()=>{
   run=await fixture(browser,'Repeat dependencies');prerequisite=await run.create('Prerequisite',{due_date:run.today});current=await run.create('Recurring task',{due_date:run.today});
   const page=run.artist.page;await page.goto('/workspace#tasks');await search(page,run.marker);await page.locator('[data-action="open-task"][data-id="'+current.id+'"]').click();await expect(page.locator('[data-schedule-form="'+current.id+'"]')).toBeVisible();
  });
  await test.step('Save repeat and prerequisite settings without replacing an unsaved parent draft',async()=>{
   const page=run.artist.page,dialog=page.getByRole('dialog'),rail=dialog.locator('[data-task-schedule="'+current.id+'"]');await dialog.getByLabel('What needs to happen?',{exact:true}).fill('Unsaved parent draft survives independent scheduling.');
   await rail.getByLabel('Repeat',{exact:true}).selectOption('daily');await rail.getByLabel('Every',{exact:true}).fill('1');await rail.getByLabel('Repeat until',{exact:true}).fill(dayAfter(run.today));await rail.getByLabel('Find a prerequisite',{exact:true}).fill(prerequisite.title);
   const choices=responseFor(page,'/tasks',{search:prerequisite.title,page:1});await rail.locator('[data-schedule-action="search"]').click();expect((await choices).status()).toBe(200);await rail.locator('[data-schedule-action="add-prerequisite"][data-id="'+prerequisite.id+'"]').click();await expect(rail.locator('.task-prerequisites')).toContainText(prerequisite.title);
   const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/'+current.id+'/scheduling'&&response.request().method()==='PATCH');await rail.getByRole('button',{name:'Save schedule',exact:true}).click();const response=await saved;expect(response.status()).toBe(200);const result=await response.json();expect(result.version).toBe(current.version+1);expect(result.can_complete).toBe(false);expect(response.request().postDataJSON().changes.prerequisite_ids).toEqual([prerequisite.id]);expect(response.request().headers()['idempotency-key']).toBeTruthy();
   await expect(dialog.getByLabel('What needs to happen?',{exact:true})).toHaveValue('Unsaved parent draft survives independent scheduling.');await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();
  });
  await test.step('Reject completion until the prerequisite is completed through its own task',async()=>{
   const page=run.artist.page,dialog=page.getByRole('dialog');const rejected=await saveParent(page,current.id,'Done');expect(rejected.status()).toBe(409);await expect(dialog.locator('#task-edit-form .form-error')).toContainText('Complete the prerequisites');const unchanged=await run.artist.context.request.get('/api/tasks/'+current.id);expect(unchanged.status()).toBe(200);expect((await unchanged.json()).status).toBe('Todo');
   page.once('dialog',confirmation=>confirmation.accept());await dialog.locator('.task-prerequisites [data-schedule-action="task"][data-id="'+prerequisite.id+'"]').click();await expect(dialog.getByLabel('Task name',{exact:true})).toHaveValue(prerequisite.title);await expect(page.locator('[data-schedule-form="'+prerequisite.id+'"]')).toBeVisible();const completed=await saveParent(page,prerequisite.id,'Done');expect(completed.status()).toBe(200);await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();
  });
  await test.step('Complete and recomplete the recurring occurrence without duplicating its successor',async()=>{
   const page=run.artist.page;await page.goto('/workspace#tasks?task='+current.id);const dialog=page.getByRole('dialog');await expect(page.locator('[data-schedule-form="'+current.id+'"]')).toBeVisible();await expect(dialog.locator('.task-prerequisites .badge')).toHaveText('Done');let completed=await saveParent(page,current.id,'Done');expect(completed.status()).toBe(200);await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();
   const saved=await scheduling(run,current.id);expect(saved.status).toBe('Done');next=saved.next_task;expect(next).toBeTruthy();expect(next.id).not.toBe(current.id);expect(next.due_date).toBe(dayAfter(run.today));
   let response=await saveParent(page,current.id,'Todo');expect(response.status()).toBe(200);await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();response=await saveParent(page,current.id,'Done');expect(response.status()).toBe(200);await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();expect((await scheduling(run,current.id)).next_task.id).toBe(next.id);
   const records=await run.artist.context.request.get('/api/tasks?'+new URLSearchParams({page:'1',search:run.marker}));expect(records.status()).toBe(200);expect((await records.json()).total).toBe(3);
   await expect(dialog.locator('[data-schedule-action="task"][data-id="'+next.id+'"]')).toBeVisible();await dialog.locator('[data-schedule-action="task"][data-id="'+next.id+'"]').click();await expect(dialog.getByLabel('Task name',{exact:true})).toHaveValue(current.title);await expect(dialog.getByLabel('Status',{exact:true})).toHaveValue('Todo');await expect(dialog.getByLabel('Due date',{exact:true})).toHaveValue(dayAfter(run.today));await expect(page).toHaveURL(new RegExp('task='+next.id+'$'));
  });
 }finally{await run?.close();}
});
