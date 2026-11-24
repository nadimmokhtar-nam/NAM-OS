const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const KEYS=['founder','sales_manager','sales_1','sales_2','production_manager','artist_1','artist_2','freelancer'];
const VIEWPORTS=[{width:320,height:640},{width:375,height:812},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}];
let fixtures,helpers;
const tag=`ci-${Date.now().toString(36)}`;
function stage(info,value){info.annotations.push({type:'nam-stage',description:value});}
function ownURL(value){const url=new URL(value);return url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);}

test.beforeAll(async()=>{
  helpers=await import(pathToFileURL(path.join(__dirname,'auth-helpers.mjs')).href);
  fixtures=await helpers.loadFixtures();
  if(!ownURL(fixtures.baseURL)||!ownURL(fixtures.supabase.url))throw new Error('Only isolated local services may be tested.');
  if(new URL(fixtures.baseURL).origin!==new URL(process.env.NAM_E2E_BASE_URL||'http://127.0.0.1:3000').origin)throw new Error('The isolated app and fixture origins differ.');
  expect(Object.keys(fixtures.accounts).sort()).toEqual([...KEYS].sort());
});

async function openAccount(browser,key,info,{viewport}={}){
  const context=await browser.newContext({baseURL:fixtures.baseURL,viewport:viewport||{width:1440,height:900},locale:'en-GB',timezoneId:'Europe/Paris',colorScheme:'light',reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage(),account=fixtures.accounts[key],errors=[];
  page.on('pageerror',()=>errors.push('UNCAUGHT_PAGE_ERROR'));
  try{
    stage(info,'login_page');await page.goto('/login');
    await page.getByLabel('Work email',{exact:true}).fill(account.email);
    await page.getByLabel('Password',{exact:true}).fill(account.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    if(account.totp){
      stage(info,'verify_authenticator');
      const input=page.locator('#auth-code, #mfa-code');await expect(input).toBeVisible();
      // A new time step avoids reusing an OTP consumed by provisioning or the
      // preceding real-auth test process. This value is never logged or saved.
      const code=await helpers.nextTotpCode(account.totp.secret,{afterStep:Math.floor(Date.now()/30000)});
      await input.fill(code);
      await page.getByRole('button',{name:/^(Verify sign in|Verify authenticator)$/}).click();
    }
    stage(info,'workspace_loading');await page.waitForURL(url=>url.pathname==='/workspace');
    await expect(page.locator('#studio-navigation')).toBeVisible();
    await expect(page.locator('#main h1')).toHaveText('A clear view of the studio.');
    await expect(page.locator('#preview-member')).toHaveCount(0);
    const response=await context.request.get('/api/bootstrap');expect(response.status()).toBe(200);const bootstrap=await response.json();expect(bootstrap.mode).toBe('authenticated');expect(bootstrap.actor.id).toBe(account.id);expect(bootstrap.actor.role).toBe(account.role);stage(info,'authenticated_workspace');
    return {context,page,account,errors};
  }catch(error){await context.close();throw error;}
}
async function visit(page,hash,heading){await page.goto('/workspace#'+hash);await expect(page.locator('#main h1')).toHaveText(heading);}
async function api(context,endpoint,{method='GET',body}={}){
  const bootstrap=await context.request.get('/api/bootstrap');expect(bootstrap.status()).toBe(200);const {csrf}=await bootstrap.json();
  return context.request.fetch(endpoint,{method,headers:method==='GET'?{}:{Origin:new URL(fixtures.baseURL).origin,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body!==undefined?{data:body}:{})});
}
async function createFixtureTask(context,title,ownerId){const result=await api(context,'/api/tasks',{method:'POST',body:{title,description:'Synthetic browser-test work only.',section:'sales',owner_id:ownerId,status:'Todo',priority:'Normal'}});expect(result.status()).toBe(201);return result.json();}
async function openTask(page,title){const button=page.locator('.task-open').filter({hasText:title});await expect(button).toHaveCount(1);await button.click();await expect(page.locator('#dialog')).toBeVisible();await expect(page.locator('#dialog').getByLabel('Task name',{exact:true})).toHaveValue(title);}
async function closeDialog(page){await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible();}
function expectNoPageErrors(errors){expect(errors).toEqual([]);}

for(const key of KEYS)test(`AUTH_${key.toUpperCase()} role navigation, protected APIs and logout`,async({browser},info)=>{
  const session=await openAccount(browser,key,info),{page,context,account,errors}=session;
  try{
    stage(info,'role_navigation');
    const role=account.role,sales=['sales','sales_manager'].includes(role),production=['artist','production_manager','freelancer'].includes(role),founder=role==='founder';
    for(const [name,allowed]of [['Sales',founder||sales],['Projects',founder||production],['Library',founder||production],['Team',founder]])await expect(page.locator(`.sidebar a[href="#${name.toLowerCase()}"]`)).toHaveCount(allowed?1:0);
    await expect(page.locator('.sidebar a[href="#academy"]')).toHaveCount(1);await expect(page.locator('.sidebar a[href="#tasks"]')).toHaveCount(1);
    stage(info,'direct_permission_denials');
    if(!founder){expect((await context.request.get('/api/academy/admin/courses')).status()).toBe(403);expect((await context.request.get('/api/auth/members')).status()).toBe(403);}
    if(production)expect((await context.request.get('/api/sales')).status()).toBe(403);
    const work=await context.request.get('/api/tasks?page=1&page_size=100');expect(work.status()).toBe(200);const records=await work.json();if(!founder)expect(records.items.every(t=>t.owner_id===account.id)).toBe(true);
    stage(info,'logout');await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(url=>url.pathname==='/login');await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();expect((await context.request.get('/api/bootstrap')).status()).toBe(401);expectNoPageErrors(errors);
  }finally{await context.close();}
});

test('TASK_LIFECYCLE founder assignment, sales accountability, archive, delete and restore',async({browser},info)=>{
  const owner=await openAccount(browser,'founder',info),worker=await openAccount(browser,'sales_1',info),title=`${tag} accountable task`,subtask=`${tag} prepare review`,comment='Synthetic sales outcome: next review confirmed.';
  try{
    stage(info,'create_assigned_task');await visit(owner.page,'sales','Sales');await owner.page.getByRole('button',{name:'Create task',exact:true}).click();let dialog=owner.page.locator('#dialog');
    await dialog.getByLabel('Task name',{exact:true}).fill(title);await dialog.getByLabel('Description',{exact:true}).fill('Synthetic task used to test the actual saved team workflow.');await dialog.getByLabel('Section',{exact:true}).selectOption('sales');await dialog.getByLabel('Owner',{exact:true}).selectOption(worker.account.id);await dialog.getByLabel('Priority',{exact:true}).selectOption('High');await dialog.getByLabel('Due date',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,10));
    const created=owner.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'Create task',exact:true}).click();const createdResponse=await created;expect(createdResponse.status()).toBe(201);const task=await createdResponse.json();await expect(dialog.getByLabel('Task name',{exact:true})).toHaveValue(title);
    await dialog.locator('form[data-form="subtask"] input[name="title"]').fill(subtask);await dialog.locator('form[data-form="subtask"]').getByRole('button',{name:'Add',exact:true}).click();await expect(dialog.getByLabel(subtask,{exact:true})).toBeVisible();await closeDialog(owner.page);
    stage(info,'sales_member_responds');await visit(worker.page,'tasks','The work, made visible.');await openTask(worker.page,title);dialog=worker.page.locator('#dialog');await dialog.getByLabel('Add a comment',{exact:true}).fill(comment);await dialog.getByRole('button',{name:'Add comment',exact:true}).click();await expect(dialog.locator('.comment p').filter({hasText:comment})).toBeVisible();await expect(dialog.locator('form[data-form="comment"] button[type="submit"]')).toBeFocused();
    const checkbox=dialog.getByLabel(subtask,{exact:true});await checkbox.focus();await worker.page.keyboard.press('Space');await expect(checkbox).toBeChecked();await expect(checkbox).toBeFocused();await dialog.getByLabel('Status',{exact:true}).selectOption('Done');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByLabel('Status',{exact:true})).toHaveValue('Done');await closeDialog(worker.page);await worker.page.reload();await expect(worker.page.locator('.task-row').filter({hasText:title}).locator('.badge')).toHaveText('Done');
    stage(info,'board_list_consistency');await worker.page.getByRole('button',{name:'Board',exact:true}).click();const doneCard=worker.page.locator('.board-col[data-drop="Done"] .task-card').filter({hasText:title});await expect(doneCard).toHaveCount(1);await doneCard.click();await expect(worker.page.locator('#dialog').getByLabel('Status',{exact:true})).toHaveValue('Done');await closeDialog(worker.page);await worker.page.getByRole('button',{name:'List',exact:true}).click();await expect(worker.page.locator('.task-row').filter({hasText:title}).locator('.badge')).toHaveText('Done');
    stage(info,'founder_reviews_and_archives');await visit(owner.page,'tasks','The work, made visible.');await owner.page.getByRole('button',{name:'Studio tasks',exact:true}).click();await owner.page.getByLabel('Search tasks',{exact:true}).fill(title);await openTask(owner.page,title);dialog=owner.page.locator('#dialog');await expect(dialog.locator('.comment p').filter({hasText:comment})).toBeVisible();await expect(dialog.getByLabel('Status',{exact:true})).toHaveValue('Done');await dialog.getByRole('button',{name:'Archive task',exact:true}).click();await expect(dialog).not.toBeVisible();
    await owner.page.getByRole('button',{name:'Active',exact:true}).click();await openTask(owner.page,title);dialog=owner.page.locator('#dialog');stage(info,'delete_and_restore');owner.page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Delete task',exact:true}).click();await expect(dialog).not.toBeVisible();await owner.page.getByRole('button',{name:'Deleted records',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Deleted tasks',exact:true})).toBeVisible();await dialog.locator(`[data-action="restore-task"][data-id="${task.id}"]`).click();await expect(dialog).not.toBeVisible();await openTask(owner.page,title);await dialog.getByRole('button',{name:'Restore task',exact:true}).click();
    await worker.page.reload();await expect(worker.page.locator('.task-row').filter({hasText:title}).locator('.badge')).toHaveText('Done');const saved=await worker.context.request.get('/api/tasks/'+task.id);expect(saved.status()).toBe(200);const record=await saved.json();expect(record.archived).toBe(false);expect(record.deleted_at).toBeNull();expect(record.comments.some(c=>c.body===comment&&c.author_id===worker.account.id)).toBe(true);expectNoPageErrors(owner.errors);expectNoPageErrors(worker.errors);
  }finally{await owner.context.close();await worker.context.close();}
});

test('TASK_FAILURES stale edits and offline saves retain drafts without overwriting records',async({browser},info)=>{
  const owner=await openAccount(browser,'founder',info),one=await openAccount(browser,'sales_1',info),two=await openAccount(browser,'sales_1',info),title=`${tag} conflict task`;
  try{
    const task=await createFixtureTask(owner.context,title,one.account.id);await visit(one.page,'tasks','The work, made visible.');await visit(two.page,'tasks','The work, made visible.');await openTask(one.page,title);await openTask(two.page,title);
    stage(info,'concurrent_stale_edit');await one.page.locator('#dialog').getByLabel('Priority',{exact:true}).selectOption('Urgent');await one.page.locator('#dialog').getByRole('button',{name:'Save changes',exact:true}).click();await expect(one.page.locator('#toast')).toHaveText('Task saved');
    const draft=`${title} unsaved second edit`;await two.page.locator('#dialog').getByLabel('Task name',{exact:true}).fill(draft);await two.page.locator('#dialog').getByRole('button',{name:'Save changes',exact:true}).click();await expect(two.page.locator('#dialog .form-error').first()).toContainText('changed elsewhere');await expect(two.page.locator('#dialog').getByLabel('Task name',{exact:true})).toHaveValue(draft);
    const current=await one.context.request.get('/api/tasks/'+task.id);expect(current.status()).toBe(200);expect((await current.json()).title).toBe(title);
    two.page.once('dialog',d=>d.accept());await two.page.locator('#dialog').getByRole('button',{name:'Reload latest',exact:true}).click();await expect(two.page.locator('#dialog').getByLabel('Task name',{exact:true})).toHaveValue(title);
    stage(info,'offline_save_recovery');await two.context.setOffline(true);await two.page.locator('#dialog').getByLabel('Description',{exact:true}).fill('A retained offline draft.');await two.page.locator('#dialog').getByRole('button',{name:'Save changes',exact:true}).click();await expect(two.page.locator('#dialog .form-error').first()).not.toBeEmpty();await expect(two.page.locator('#dialog').getByLabel('Description',{exact:true})).toHaveValue('A retained offline draft.');await two.context.setOffline(false);await two.page.locator('#dialog').getByRole('button',{name:'Save changes',exact:true}).click();await expect(two.page.locator('#toast')).toHaveText('Task saved');
    stage(info,'csrf_rejected');const denied=await two.context.request.post('/api/tasks',{headers:{Origin:new URL(fixtures.baseURL).origin,'Content-Type':'application/json'},data:{title:'Should never be created',section:'sales'}});expect(denied.status()).toBe(403);expectNoPageErrors(owner.errors);expectNoPageErrors(one.errors);expectNoPageErrors(two.errors);
  }finally{await owner.context.close();await one.context.close();await two.context.close();}
});

test('ACADEMY_LIFECYCLE authored modules, private resource, publication, enrollment and personal progress',async({browser},info)=>{
  const owner=await openAccount(browser,'founder',info),learner=await openAccount(browser,'sales_1',info),title=`${tag} sales onboarding`,moduleTitle='Discovery module',lessonTitle='Prepare the discovery call',resourceTitle='Call preparation checklist',resourceBody='Synthetic resource: confirm scope, owner and next action.';
  try{
    stage(info,'academy_authoring');await visit(owner.page,'academy','Academy');await owner.page.getByRole('button',{name:'Manage courses',exact:true}).click();await owner.page.getByRole('button',{name:'Create course',exact:true}).click();let dialog=owner.page.locator('#dialog');await dialog.getByLabel('Course title',{exact:true}).fill(title);await dialog.getByLabel('Learning area',{exact:true}).selectOption('sales');await dialog.getByLabel('Summary',{exact:true}).fill('Synthetic written onboarding for isolated browser testing.');await dialog.getByRole('button',{name:'Create draft',exact:true}).click();await expect(owner.page.locator('[data-academy-form="metadata"]')).toBeVisible();
    await owner.page.getByRole('button',{name:'Add module',exact:true}).click();await dialog.getByLabel('Module title',{exact:true}).fill(moduleTitle);await dialog.getByRole('button',{name:'Add module',exact:true}).click();await expect(owner.page.locator('.data-row h3').filter({hasText:moduleTitle})).toBeVisible();
    await owner.page.getByRole('button',{name:'Add lesson',exact:true}).click();await dialog.getByLabel('Lesson title',{exact:true}).fill(lessonTitle);await dialog.getByLabel('Written lesson',{exact:true}).fill('Read the brief, clarify the scope and assign the next follow-up.');await dialog.getByRole('button',{name:'Add lesson',exact:true}).click();await owner.page.locator('.data-row').filter({has:owner.page.getByRole('heading',{name:'1. '+lessonTitle,exact:true})}).getByRole('button',{name:'Choose module',exact:true}).click();await dialog.getByLabel('Module',{exact:true}).selectOption({label:moduleTitle});await dialog.getByRole('button',{name:'Save lesson module',exact:true}).click();
    await owner.page.getByRole('button',{name:'Add text resource',exact:true}).click();await dialog.getByLabel('Resource title',{exact:true}).fill(resourceTitle);await dialog.getByLabel('Available with',{exact:true}).selectOption({label:lessonTitle});await dialog.getByLabel('Written resource content',{exact:true}).fill(resourceBody);await dialog.getByRole('button',{name:'Add text resource',exact:true}).click();
    stage(info,'academy_publish_and_enroll');await owner.page.getByRole('button',{name:'Review and publish',exact:true}).click();await dialog.getByRole('button',{name:'Publish version 1',exact:true}).click();await owner.page.getByRole('button',{name:'Assign learner',exact:true}).click();await dialog.getByLabel('Learner',{exact:true}).selectOption(learner.account.id);await dialog.getByLabel('Mandatory onboarding or training',{exact:true}).check();await dialog.getByRole('button',{name:'Save enrollment',exact:true}).click();
    stage(info,'academy_learner_and_download');await visit(learner.page,'academy','Academy');for(const area of ['Sales','3D','Post-production'])await expect(learner.page.locator('[data-action="area"]').filter({hasText:area})).toHaveCount(1);const card=learner.page.locator('.course-card').filter({hasText:title});await expect(card).toBeVisible();await card.getByRole('button',{name:'Start learning',exact:true}).click();await expect(learner.page.locator('.lesson-body h2')).toHaveText(lessonTitle);await expect(learner.page.locator('.lesson-module')).toHaveText(moduleTitle);
    const downloadEvent=learner.page.waitForEvent('download');await learner.page.getByRole('link',{name:'Download TXT',exact:true}).click();const download=await downloadEvent,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);expect(Buffer.concat(chunks).toString('utf8')).toBe(resourceBody);expect(download.suggestedFilename()).toMatch(/\.txt$/);
    stage(info,'academy_persistent_completion');await learner.page.getByRole('button',{name:'Mark lesson complete',exact:true}).click();await expect(learner.page.getByText('Course completed. Your completion record has been saved.',{exact:true})).toBeVisible();await learner.page.reload();const completed=learner.page.locator('.course-card').filter({hasText:title});await expect(completed.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');await completed.getByRole('button',{name:'Continue learning',exact:true}).click();await learner.page.getByRole('button',{name:'Reopen lesson',exact:true}).click();await expect(learner.page.getByRole('button',{name:'Mark lesson complete',exact:true})).toBeVisible();await learner.page.getByRole('button',{name:'Mark lesson complete',exact:true}).click();
    stage(info,'academy_area_isolation');await visit(learner.page,'academy','Academy');await learner.page.locator('[data-action="area"][data-value="3d"]').click();await expect(learner.page.locator('.course-card').filter({hasText:title})).toHaveCount(0);await learner.page.locator('[data-action="area"][data-value="post_production"]').click();await expect(learner.page.locator('.course-card').filter({hasText:title})).toHaveCount(0);expectNoPageErrors(owner.errors);expectNoPageErrors(learner.errors);
  }finally{await owner.context.close();await learner.context.close();}
});

test('RESPONSIVE_KEYBOARD authenticated layout at five widths and native dialog/menu focus',async({browser},info)=>{
  const owner=await openAccount(browser,'founder',info),title=`${tag} viewport review`;
  try{
    await createFixtureTask(owner.context,title,owner.account.id);await visit(owner.page,'tasks','The work, made visible.');
    for(const viewport of VIEWPORTS){
      stage(info,`viewport_${viewport.width}x${viewport.height}`);await owner.page.setViewportSize(viewport);await expect(owner.page.locator('#main h1')).toHaveText('The work, made visible.');await owner.page.evaluate(()=>document.fonts.ready);
      expect(await owner.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(owner.page.locator('#app .topbar')).toBeVisible();await expect(owner.page.locator('.task-open').filter({hasText:title})).toBeVisible();
      if(viewport.width===1440){const geometry=await owner.page.evaluate(()=>({sidebar:document.querySelector('.sidebar').getBoundingClientRect().width,header:document.querySelector('.topbar').getBoundingClientRect().height,titleLeft:document.querySelector('#main h1').getBoundingClientRect().left,panelLeft:document.querySelector('#task-results>.panel').getBoundingClientRect().left}));expect(Math.abs(geometry.sidebar-240)).toBeLessThanOrEqual(1);expect(Math.abs(geometry.header-72)).toBeLessThanOrEqual(1);expect(Math.abs(geometry.titleLeft-264)).toBeLessThanOrEqual(1);expect(Math.abs(geometry.titleLeft-geometry.panelLeft)).toBeLessThanOrEqual(1);}
      if(viewport.width<=700){await expect(owner.page.locator('#studio-navigation')).toHaveJSProperty('inert',true);const trigger=owner.page.getByRole('button',{name:'Open navigation',exact:true});await trigger.focus();await owner.page.keyboard.press('Enter');await expect(owner.page.locator('#studio-navigation')).toHaveJSProperty('inert',false);await expect(owner.page.locator('.sidebar .nav-link').first()).toBeFocused();await owner.page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(owner.page.locator('#studio-navigation')).toHaveJSProperty('inert',true);}
      if(process.env.NAM_E2E_SAFE_SCREENSHOTS==='1'){
        stage(info,`safe_capture_${viewport.width}x${viewport.height}`);expect(new URL(owner.page.url()).pathname).toBe('/workspace');expect(new URL(owner.page.url()).search).toBe('');await expect(owner.page.locator('dialog[open]')).toHaveCount(0);await expect(owner.page.locator('input[type="password"],input[id*="secret"],input[id*="token"],input[name*="password"],input[autocomplete="one-time-code"],textarea[id*="recovery"],img[alt*="QR"]')).toHaveCount(0);
        const directory=path.join(__dirname,'.runtime','safe-visuals');await fs.mkdir(directory,{recursive:true});await owner.page.screenshot({path:path.join(directory,`${viewport.width}x${viewport.height}.png`),fullPage:true,animations:'disabled',caret:'hide',mask:[owner.page.locator('.identity'),owner.page.locator('.top-actions>.muted')],maskColor:'#f1f1f1'});
      }
    }
    stage(info,'keyboard_dialog_validation');await owner.page.setViewportSize({width:1440,height:900});const create=owner.page.getByRole('button',{name:'Create task',exact:true});await create.focus();await owner.page.keyboard.press('Enter');const dialog=owner.page.locator('#dialog');await expect(dialog).toBeVisible();await expect(dialog).toHaveAttribute('aria-labelledby','dialog-title');const name=dialog.getByLabel('Task name',{exact:true});await expect(name).toBeFocused();await dialog.getByRole('button',{name:'Create task',exact:true}).click();expect(await name.evaluate(input=>input.validity.valueMissing)).toBe(true);await name.fill('Unsaved keyboard-only draft');await owner.page.keyboard.press('Tab');await expect(dialog.getByLabel('Description',{exact:true})).toBeFocused();owner.page.once('dialog',d=>d.dismiss());await owner.page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(name).toHaveValue('Unsaved keyboard-only draft');owner.page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(create).toBeFocused();expectNoPageErrors(owner.errors);
  }finally{await owner.context.close();}
});
