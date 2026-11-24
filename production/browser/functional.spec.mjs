import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {actor,profiles,mutate,uiLogin,screenshot} from './support.mjs';
import {rangeFixture} from './range-fixture.mjs';

test('password-only Founder reaches an actionable daily workspace',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://localhost:3100'}),page=await context.newPage();
 await uiLogin(page,'founder');await expect(page.getByRole('heading',{name:'The studio, in focus.'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Needs attention',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Team commitments',exact:true})).toBeVisible();
 await expect(page.locator('.daily-metrics').getByRole('button',{name:/^Overdue/})).toBeVisible();await expect(page.locator('[data-action="preview-member"]')).toHaveCount(0);
 await screenshot(page,'after-today-desktop');await context.close();
});

test('a real project shares its brief without exposing another owner’s deliverable',async({browser})=>{
 const data=await profiles(),{context,page}=await actor(browser,'founder'),artist=data.users.find(u=>u.key==='artist_1');
 const title='[QA] Project '+Date.now(),taskTitle='Interior / reading corner';
 await page.goto('/workspace#projects');await page.getByRole('button',{name:'Create project',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Project name',{exact:true}).fill(title);await dialog.getByLabel('Creative brief',{exact:true}).fill('Use warm daylight and a restrained material palette. Keep the approved camera.');await dialog.getByLabel('Definition of done',{exact:true}).fill('An internally reviewed image and checked final delivery files.');await dialog.getByLabel('Project delivery deadline',{exact:true}).fill('2026-12-10');await dialog.getByLabel('QA Interior Artist',{exact:true}).check();
 const created=page.waitForResponse(response=>response.url().endsWith('/api/projects')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create project',exact:true}).click();const project=await (await created).json();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Create task',exact:true}).click();await dialog.getByLabel('Task name',{exact:true}).fill(taskTitle);await dialog.getByLabel('What needs to happen?',{exact:true}).fill('Match the agreed composition and submit a first lighting pass.');await dialog.getByLabel('Owner',{exact:true}).selectOption(artist.id);await dialog.getByLabel('Production stage',{exact:true}).selectOption('Lighting');await dialog.getByRole('button',{name:'Create task',exact:true}).click();
 await expect(dialog.locator('.context-title')).toHaveText(title+' ↗');await expect(dialog.getByLabel('Task name',{exact:true})).toHaveValue(taskTitle);await page.keyboard.press('Escape');
 const task=page.locator('.task-open').filter({hasText:taskTitle});await expect(task).toBeVisible();await task.click();await expect(dialog.locator('.context-title')).toHaveText(title+' ↗');await expect(dialog.locator('.task-context')).toContainText('Keep the approved camera.');await page.keyboard.press('Escape');
 await mutate(context,'/tasks',{title:'Founder-only review notes',section:'projects',owner_id:data.users.find(u=>u.key==='founder').id,project_id:project.id,description:'Do not expose this task through project membership.'});
 const learner=await actor(browser,'artist_1');await learner.page.goto('/workspace#projects/'+project.id);await expect(learner.page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(learner.page.locator('.task-open').filter({hasText:taskTitle})).toBeVisible();await expect(learner.page.getByText('Founder-only review notes')).toHaveCount(0);
 const unauthorized=await actor(browser,'artist_2');expect((await unauthorized.context.request.get('/api/projects/'+project.id)).status()).toBe(404);
 const own=await learner.context.request.get('/api/tasks?project_id='+project.id+'&page=1');expect((await own.json()).items.every(t=>t.owner_id===artist.id)).toBe(true);
 await screenshot(learner.page,'after-project-artist');await Promise.all([context.close(),learner.context.close(),unauthorized.context.close()]);
});

test('real managed sessions retain optimistic conflict protection',async({browser})=>{
 const fixture=await profiles(),owner=await actor(browser,'artist_1'),founder=await actor(browser,'founder'),id=fixture.records.tasks[0];
 const original=await (await owner.context.request.get('/api/tasks/'+id)).json();
 const first=await mutate(owner.context,'/tasks/'+id,{expectedVersion:original.version,changes:{description:'First editor’s reviewed direction.'}},'PATCH');expect(first.status()).toBe(200);
 const stale=await mutate(founder.context,'/tasks/'+id,{expectedVersion:original.version,changes:{description:'This stale write must not replace the first.'}},'PATCH');expect(stale.status()).toBe(409);
 const saved=await (await owner.context.request.get('/api/tasks/'+id)).json();expect(saved.description).toBe('First editor’s reviewed direction.');expect(saved.version).toBe(original.version+1);
 expect((await mutate(owner.context,'/tasks/'+id,{expectedVersion:saved.version,changes:{description:original.description}},'PATCH')).status()).toBe(200);
 await Promise.all([owner.context.close(),founder.context.close()]);
});

test('private video uploads to real Storage, publishes immutably and plays with authenticated seeking',async({browser})=>{
 const fixture=await profiles(),media=await rangeFixture(),founder=await actor(browser,'founder'),learner=await actor(browser,'artist_1'),learnerId=fixture.users.find(u=>u.key==='artist_1').id;
 const response=await mutate(founder.context,'/academy/admin/courses',{title:'[QA] Video workflow '+Date.now(),area:'3d',summary:'Real isolated Storage upload and playback verification.'});expect(response.status()).toBe(201);let course=await response.json();
 course=await (await mutate(founder.context,'/academy/admin/courses/'+course.id+'/lessons',{expectedRevision:course.revision,title:'The light study',body:'Written steps and a descriptive transcript accompany the video.'})).json();
 course=await (await mutate(founder.context,'/academy/admin/courses/'+course.id+'/publish',{expectedRevision:course.revision})).json();
 expect((await mutate(founder.context,'/academy/admin/courses/'+course.id+'/enroll',{member_id:learnerId,course_version:1,mandatory:true})).status()).toBe(200);
 await founder.page.goto('/workspace#academy');await founder.page.getByRole('button',{name:'Manage courses',exact:true}).click();await founder.page.locator('[data-academy-action="open"][data-course="'+course.id+'"]').click();
 await founder.page.getByRole('button',{name:'Upload video',exact:true}).click();const dialog=founder.page.getByRole('dialog');await dialog.getByLabel('Video title',{exact:true}).fill('A complete light study');await dialog.getByLabel('Video file',{exact:true}).setInputFiles(media.path);await dialog.getByLabel('English captions (optional WebVTT file)',{exact:true}).setInputFiles(resolve('browser/fixtures/academy-demo.vtt'));await dialog.getByRole('button',{name:'Upload & verify',exact:true}).click();
 await expect(dialog).not.toBeVisible({timeout:30000});await expect(founder.page.getByText('Verified · publish to make available to learners',{exact:true})).toBeVisible();
 let previous=await (await learner.context.request.get('/api/courses/'+course.id)).json();expect(previous.version).toBe(1);expect(previous.videos).toEqual([]);
 await founder.page.locator('[data-academy-action="publish"]').click();await founder.page.locator('form[data-academy-form="publish"] button[type="submit"]').click();await expect(founder.page.getByRole('dialog')).not.toBeVisible();
 course=await (await founder.context.request.get('/api/academy/admin/courses/'+course.id)).json();expect(course.version).toBe(2);expect(course.videos[0].status).toBe('ready');
 previous=await (await learner.context.request.get('/api/courses/'+course.id)).json();expect(previous.version).toBe(1);expect(previous.videos).toEqual([]);
 await mutate(founder.context,'/academy/admin/courses/'+course.id+'/enroll',{member_id:learnerId,course_version:2,mandatory:true});
 await learner.page.goto('/workspace#academy');await learner.page.locator('[data-action="course"][data-id="'+course.id+'"]').first().click();const video=learner.page.locator('video[data-academy-video]');await expect(video).toBeVisible();await expect.poll(()=>video.evaluate(v=>v.readyState),{timeout:20000}).toBeGreaterThanOrEqual(1);await video.evaluate(v=>{v.muted=true;return v.play();});await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0.2);await video.evaluate(v=>{v.pause();v.currentTime=0.7;});await expect.poll(()=>video.evaluate(v=>v.textTracks[0]?.cues?.length||0)).toBeGreaterThan(0);
 const partial=await learner.context.request.get('/api/academy/videos/'+course.videos[0].id+'/content',{headers:{Range:'bytes=0-31'}});expect(partial.status()).toBe(206);expect((await partial.body()).length).toBe(32);expect(partial.headers()['cache-control']).toContain('no-store');
 const bounded=await learner.context.request.get('/api/academy/videos/'+course.videos[0].id+'/content',{headers:{Range:'bytes=0-'}});expect(bounded.status()).toBe(206);expect((await bounded.body()).length).toBe(media.chunk);expect(bounded.headers()['content-range']).toBe(`bytes 0-${media.chunk-1}/${media.size}`);
 await screenshot(learner.page,'after-academy-video');
 await mutate(founder.context,'/academy/admin/courses/'+course.id+'/revoke',{member_id:learnerId});expect((await learner.context.request.get('/api/academy/videos/'+course.videos[0].id+'/content',{headers:{Range:'bytes=0-31'}})).status()).toBe(404);
 await Promise.all([founder.context.close(),learner.context.close()]);
});

test('sales activity remains grounded in the actual authorized ledger',async({browser})=>{
 const {context,page}=await actor(browser,'sales_1');const before=await (await context.request.get('/api/sales')).json();await page.goto('/workspace#sales');await page.getByRole('button',{name:'Activities',exact:true}).click();await page.getByRole('button',{name:'Log activity',exact:true}).click();const dialog=page.getByRole('dialog'),name='[QA] Prospect follow-up '+Date.now();await dialog.getByLabel('Company or context',{exact:true}).fill(name);await dialog.getByLabel('Outcome',{exact:true}).fill('Agreed the next meeting; CRM remains the opportunity source.');await dialog.getByRole('button',{name:'Save activity',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByText(name,{exact:true})).toBeVisible();const after=await (await context.request.get('/api/sales')).json();expect(after.activity_total).toBe(before.activity_total+1);expect(after.activities[0].owner_id).toBe((await profiles()).users.find(u=>u.key==='sales_1').id);await context.close();
});
