import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,origin} from './support.mjs';

async function mutation(context,path,body,method='POST'){
 const response=await context.request.get('/api/bootstrap');expect(response.status()).toBe(200);const {csrf}=await response.json();
 return context.request.fetch('/api'+path,{method,headers:{Origin:origin,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:body});
}
const plus=(value,days)=>new Date(Date.parse(value+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
async function fixture(browser){
 const founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),data=await profiles(),owner=data.users.find(row=>row.key==='founder'),person=data.users.find(row=>row.key==='artist_1'),today=(await (await founder.context.request.get('/api/bootstrap')).json()).today;
 const created=await mutation(founder.context,'/projects',{title:'[QA] Planned residence '+randomUUID().slice(0,8),brief:'Preserve the approved camera and soft directional daylight.',lead_id:owner.id,member_ids:[person.id],client_name:'QA Architecture',project_type:'Residential',location:'Paris',start_date:today,due_date:plus(today,21)});expect(created.status()).toBe(201);const project=await created.json();
 return {founder,artist,owner,person,today,project,async close(){await Promise.all([founder.context.close(),artist.context.close()]);}};
}
async function timeline(run,who='founder'){
 const page=run[who].page;await page.goto('/workspace#projects/'+run.project.id+'/work');await page.getByRole('button',{name:'Timeline',exact:true}).click();await expect(page.locator('.project-timeline')).toBeVisible();return page;
}
async function phase(run,title='[QA] Materials and light'){
 const page=run.founder.page;await page.getByRole('button',{name:'New phase',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Phase title',{exact:true}).fill(title);await dialog.getByLabel('Start date',{exact:true}).fill(plus(run.today,2));await dialog.getByLabel('End date',{exact:true}).fill(plus(run.today,8));await dialog.getByLabel('Linked production stage',{exact:true}).selectOption('Materials and lighting');await dialog.getByLabel('Phase status',{exact:true}).selectOption('in_progress');
 const saved=page.waitForResponse(response=>response.url().endsWith('/api/projects/'+run.project.id+'/phases')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create phase',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);const record=await response.json();await expect(dialog).not.toBeVisible();return record.plan.phases.find(row=>row.id===record.id);
}
async function render(run){
 const created=await mutation(run.founder.context,'/projects/'+run.project.id+'/deliverables',{code:'EXT-01',title:'[QA] Shared project cover',artist_id:run.owner.id,camera_notes:'PRIVATE founder camera notes'});expect(created.status()).toBe(201);const image=await created.json();
 const bytes=await sharp({create:{width:800,height:400,channels:3,background:'#a6927c'}}).png().toBuffer(),digest=createHash('sha256').update(bytes).digest('hex');
 const reserved=await mutation(run.founder.context,'/deliverables/'+image.id+'/renders',{expectedVersion:1,file_name:'project-cover.png',mime:'image/png',byte_size:bytes.length,sha256:digest,note:'PRIVATE render version note'});expect(reserved.status()).toBe(201);const upload=await reserved.json();
 expect([200,201]).toContain((await run.founder.context.request.put(upload.uploadUrl,{headers:{'Content-Type':'image/png','x-upsert':'false'},data:bytes})).status());
 const finished=await mutation(run.founder.context,'/renders/'+upload.id+'/finish',{expectedVersion:1});expect(finished.status()).toBe(200);return {image,version:await finished.json()};
}

test('dated production phases use the measured timeline and preserve individual task visibility at desktop and mobile sizes',async({browser},testInfo)=>{
 const run=await fixture(browser);
 try{
  for(const owner of [run.owner,run.person])expect((await mutation(run.founder.context,'/tasks',{title:owner.id===run.owner.id?'PRIVATE planning task':'[QA] Assigned materials',section:'projects',project_id:run.project.id,production_stage:'Materials and lighting',owner_id:owner.id})).status()).toBe(201);
  const page=await timeline(run),saved=await phase(run),row=page.locator('.timeline-phase-link[data-id="'+saved.id+'"]');await expect(row).toContainText('0 of 2 tasks');await expect(row).toContainText('In progress');
  const geometry=await row.evaluate(node=>{const rect=node.closest('th').getBoundingClientRect();return {width:rect.width,height:rect.height};});expect(geometry).toEqual({width:320,height:90});
  await page.getByLabel('Timeline scale',{exact:true}).selectOption('month');await expect(page.getByLabel('Timeline scale',{exact:true})).toHaveValue('month');await page.getByRole('button',{name:'Today',exact:true}).click();
  const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(scan.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.length}))).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('task-fidelity-project-timeline-1440.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await expect(row).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);await expect(page.getByRole('button',{name:'New phase',exact:true})).toBeInViewport();await page.screenshot({path:testInfo.outputPath('task-fidelity-project-timeline-390.png'),animations:'disabled'});
  const artist=await timeline(run,'artist'),assigned=artist.locator('.timeline-phase-link[data-id="'+saved.id+'"]');await expect(assigned).toContainText('0 of 1 tasks');await expect(artist.getByRole('button',{name:'New phase',exact:true})).toHaveCount(0);expect(await artist.locator('#main').innerText()).not.toContain('PRIVATE');
  await assigned.click();await expect(artist.getByRole('dialog').locator('.phase-readonly')).toContainText('In progress');await expect(artist.getByRole('dialog').getByRole('button',{name:'Save phase',exact:true})).toHaveCount(0);
 }finally{await run.close();}
});

test('a selected private project cover is shared with the brief without sharing the underlying render or internal notes',async({browser},testInfo)=>{
 const run=await fixture(browser);
 try{
  const asset=await render(run);expect([403,404]).toContain((await run.artist.context.request.get('/api/renders/'+asset.version.id+'/content')).status());
  const page=run.founder.page;await page.goto('/workspace#projects/'+run.project.id);await page.getByRole('button',{name:'Choose project cover',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('input[name="cover_render_id"][value="'+asset.version.id+'"]').check();
  const changed=page.waitForResponse(response=>response.url().endsWith('/api/projects/'+run.project.id)&&response.request().method()==='PATCH');await dialog.getByRole('button',{name:'Save project cover',exact:true}).click();expect((await changed).status()).toBe(200);await expect(dialog).not.toBeVisible();await expect.poll(()=>page.locator('.project-cover>img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.locator('.project-overview-intro')).toContainText('QA Architecture');await expect(page.locator('.project-overview-metrics')).toContainText('Images & deliverables');
  let audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(audit.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.length}))).toEqual([]);await page.screenshot({path:testInfo.outputPath('task-fidelity-project-overview-1440.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);await page.screenshot({path:testInfo.outputPath('task-fidelity-project-overview-390.png'),animations:'disabled'});
  await run.artist.page.goto('/workspace#projects/'+run.project.id);await expect.poll(()=>run.artist.page.locator('.project-cover>img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);expect(await run.artist.page.locator('#main').innerText()).not.toContain('PRIVATE');expect((await run.artist.context.request.get('/api/projects/'+run.project.id+'/cover')).status()).toBe(200);expect([403,404]).toContain((await run.artist.context.request.get('/api/renders/'+asset.version.id+'/content?variant=original')).status());
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Back to projects',exact:true}).click();const card=page.locator('.project-card[data-id="'+run.project.id+'"] img');await expect.poll(()=>card.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 }finally{await run.close();}
});

test('phase saves prevent abandonment, concurrent changes require reload, and archived phases retain a restore path',async({browser})=>{
 const run=await fixture(browser);let release;
 try{
  const page=await timeline(run);await page.getByRole('button',{name:'New phase',exact:true}).click();let started;const began=new Promise(done=>started=done),held=new Promise(done=>release=done);await page.route('**/api/projects/*/phases',async route=>{if(route.request().method()!=='POST')return route.continue();started();await held;return route.continue();});
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Phase title',{exact:true}).fill('[QA] Camera approval');await dialog.getByRole('button',{name:'Create phase',exact:true}).click();await began;await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();release();await expect(dialog).not.toBeVisible();
  const plan=await (await run.founder.context.request.get('/api/projects/'+run.project.id+'/plan')).json(),record=plan.phases[0];await page.locator('.timeline-phase-link[data-id="'+record.id+'"]').click();await dialog.getByLabel('Shared phase notes',{exact:true}).fill('Local draft');
  expect((await mutation(run.founder.context,'/projects/'+run.project.id+'/phases/'+record.id,{expectedVersion:record.version,changes:{note:'Changed in another session'}},'PATCH')).status()).toBe(200);
  await dialog.getByRole('button',{name:'Save phase',exact:true}).click();await expect(dialog.locator('.form-error')).toContainText('changed elsewhere');await expect(dialog.getByLabel('Shared phase notes',{exact:true})).toHaveValue('Local draft');page.once('dialog',dialog=>dialog.accept());await dialog.getByRole('button',{name:'Reload saved plan',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.locator('.timeline-phase-link[data-id="'+record.id+'"]').click();await expect(dialog.getByLabel('Shared phase notes',{exact:true})).toHaveValue('Changed in another session');await dialog.getByRole('checkbox',{name:'Archive this phase and keep its history',exact:true}).check();await dialog.getByRole('button',{name:'Save phase',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.timeline-phase-link[data-id="'+record.id+'"]')).toBeVisible();await expect(page.getByRole('checkbox',{name:'Archived phases',exact:true})).toBeChecked();
  await page.locator('.timeline-phase-link[data-id="'+record.id+'"]').click();await dialog.getByRole('checkbox',{name:'Archive this phase and keep its history',exact:true}).uncheck();await dialog.getByRole('button',{name:'Save phase',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('checkbox',{name:'Archived phases',exact:true})).not.toBeChecked();await expect(page.locator('.timeline-phase-link[data-id="'+record.id+'"]')).toBeVisible();
 }finally{release?.();await run.close();}
});
