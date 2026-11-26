import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,origin} from './support.mjs';

async function mutation(context,path,body,method='POST'){
 const bootstrap=await context.request.get('/api/bootstrap');expect(bootstrap.status()).toBe(200);const {csrf}=await bootstrap.json();
 return context.request.fetch('/api'+path,{method,headers:{Origin:origin,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:body});
}
async function fixture(browser,{clientUI=false,canApprove=true}={}){
 const founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),data=await profiles();
 const owner=data.users.find(user=>user.key==='artist_1'),lead=data.users.find(user=>user.key==='founder');
 const response=await mutation(founder.context,'/projects',{title:'[QA] Issued client review '+randomUUID().slice(0,8),lead_id:lead.id,member_ids:[owner.id]});expect(response.status()).toBe(201);const project=await response.json();
 const imageResponse=await mutation(founder.context,'/projects/'+project.id+'/deliverables',{code:'INT-01',title:'[QA] Client living room',artist_id:owner.id,camera_notes:'PRIVATE artist camera direction'});expect(imageResponse.status()).toBe(201);const image=await imageResponse.json();
 const version=await upload(artist.context,image.id,1,'#ac927c');
 const person={name:'QA Review Client',email:'review-'+randomUUID()+'@client-qa.invalid',active:true,can_approve:canApprove};
 let grant;
 if(clientUI){
  const page=founder.page;await page.goto('/workspace#projects/'+project.id+'/reviews');await page.getByRole('button',{name:'Clients',exact:true}).click();await page.getByRole('button',{name:'Share with a client',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Client name',{exact:true}).fill(person.name);await dialog.getByLabel('Email address',{exact:true}).fill(person.email);
  if(canApprove)await dialog.getByRole('checkbox',{name:'Allow this client to accept or reject images',exact:true}).check();
  const mailed=page.waitForResponse(res=>res.url().includes('/api/projects/'+project.id+'/clients/')&&res.url().endsWith('/invite')&&res.request().method()==='POST');
  const saved=page.waitForResponse(res=>res.url().endsWith('/api/projects/'+project.id+'/clients')&&res.request().method()==='POST');await dialog.getByRole('button',{name:'Share with client',exact:true}).click();const result=await saved;expect(result.status()).toBe(201);grant=await result.json();expect((await mailed).status()).toBe(202);
  await expect(dialog.getByRole('button',{name:'Save access',exact:true})).toBeEnabled();
 }else{
  const result=await mutation(founder.context,'/projects/'+project.id+'/clients',person);expect(result.status()).toBe(201);grant=await result.json();
 }
 const client=await actorWithoutStudioMembership(browser);
 return {founder,artist,client,project,image,version,person,grant,async close(){await Promise.all([founder.context.close(),artist.context.close(),client.context.close()]);}};
}
async function actorWithoutStudioMembership(browser){const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000}});return {context,page:await context.newPage()};}
async function upload(context,did,expectedVersion,color){
 const bytes=await sharp({create:{width:400,height:240,channels:3,background:color}}).png().toBuffer();
 const digest=await import('node:crypto').then(({createHash})=>createHash('sha256').update(bytes).digest('hex'));
 const reserved=await mutation(context,'/deliverables/'+did+'/renders',{expectedVersion,file_name:'issued-image.png',mime:'image/png',byte_size:bytes.length,sha256:digest,note:'PRIVATE internal lighting note'});expect(reserved.status()).toBe(201);const plan=await reserved.json();
 const transferred=await context.request.put(plan.uploadUrl,{headers:{'Content-Type':'image/png','x-upsert':'false'},data:bytes});expect([200,201]).toContain(transferred.status());
 const finished=await mutation(context,'/renders/'+plan.id+'/finish',{expectedVersion});expect(finished.status()).toBe(200);return finished.json();
}
async function issue(run,{ui=false,canDecide=true,allowDownload=true}={}){
 if(ui){
  const page=run.founder.page,dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Issue review request',exact:true}).click();
  await dialog.getByLabel('Request title',{exact:true}).fill('[QA] Materials · round 1');await dialog.getByLabel('Message to clients',{exact:true}).fill('Please review the issued material and daylight.');
  await dialog.locator('[data-review-image="'+run.image.id+'"]').check();await dialog.locator('[data-review-recipient="'+run.grant.user_id+'"]').check();
  if(canDecide)await dialog.locator('[data-review-decision="'+run.grant.user_id+'"]').check();
  if(allowDownload)await dialog.getByRole('checkbox',{name:'Allow original image downloads',exact:true}).check();
  const saved=page.waitForResponse(res=>res.url().endsWith('/api/projects/'+run.project.id+'/reviews')&&res.request().method()==='POST');await dialog.getByRole('button',{name:'Issue review request',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);const record=await response.json();await expect(dialog.locator('.studio-review-detail')).toBeVisible();return record;
 }
 const current=await (await run.founder.context.request.get('/api/deliverables/'+run.image.id)).json();
 const response=await mutation(run.founder.context,'/projects/'+run.project.id+'/reviews',{title:'[QA] Issued client review',message:'Review this version.',allow_download:allowDownload,items:[{deliverable_id:run.image.id,render_id:run.version.id,expected_version:current.version}],recipients:[{user_id:run.grant.user_id,can_decide:canDecide}]});expect(response.status()).toBe(201);return response.json();
}
async function clientSignIn(run,{emailAlreadyRequested=false}={}){
 if(!emailAlreadyRequested){const response=await run.client.context.request.post('/api/client/auth/link',{headers:{Origin:origin},data:{email:run.person.email}});expect(response.status()).toBe(202);}
 // Only the disposable local capture mailbox is read. Sign-in links and all
 // bearer/session material remain in private browser output, never summaries.
 let messageId='';
 await expect.poll(async()=>{
  const response=await run.client.context.request.get('http://127.0.0.1:54324/api/v1/messages?limit=100');if(response.status()!==200)return false;
  const data=await response.json(),message=(data.messages||[]).find(row=>(row.To||[]).some(person=>person.Address.toLowerCase()===run.person.email));messageId=message?.ID||'';return !!messageId;
 },{timeout:20000,message:'Synthetic client sign-in email must reach the local capture inbox.'}).toBe(true);
 const response=await run.client.context.request.get('http://127.0.0.1:54324/api/v1/message/'+encodeURIComponent(messageId));expect(response.status()).toBe(200);const message=await response.json();
 const content=(message.HTML||message.Text||'').replaceAll('&amp;','&'),candidate=content.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0];
 if(!candidate)throw Error('Synthetic sign-in email has no provider verification link.');
 const target=new URL(candidate);if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54321'||target.pathname!=='/auth/v1/verify')throw Error('Refusing a sign-in link outside the isolated provider.');
 await run.client.page.goto(candidate);await expect(run.client.page.locator('.client-portal')).toBeVisible();expect(new URL(run.client.page.url()).hash).not.toContain('access_token');
}

test('the founder issues exact render versions and the invited client signs in by email, accepts and revises a response',async({browser},testInfo)=>{
 const run=await fixture(browser,{clientUI:true});
 try{
  const review=await issue(run,{ui:true});await clientSignIn(run,{emailAlreadyRequested:true});const page=run.client.page;
  await page.goto('/review#reviews/'+review.id);await expect(page.getByRole('heading',{name:'INT-01 · [QA] Client living room',exact:true})).toBeVisible();await expect.poll(()=>page.locator('.client-issued-image').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  expect(await page.locator('#client-review-app').innerText()).not.toContain('PRIVATE');expect((await run.client.context.request.get('/api/tasks')).status()).toBe(403);expect((await run.client.context.request.get('/api/renders/'+run.version.id+'/content')).status()).toBe(403);
  await page.getByLabel('Comment (optional)',{exact:true}).fill('Accepted material direction.');await page.getByRole('button',{name:'Accept',exact:true}).click();await expect(page.locator('.client-response-record')).toContainText('Accepted');
  await page.getByLabel('Comment (optional)',{exact:true}).fill('Please soften the material reflection.');await page.getByRole('button',{name:'Reject',exact:true}).click();await expect(page.locator('.client-response-record')).toContainText('Rejected');
  const saved=await (await run.client.context.request.get('/api/client/reviews/'+review.id)).json();expect(saved.items[0].response.version).toBe(2);expect(saved.items[0].response.message).toBe('Please soften the material reflection.');
  const original=await run.client.context.request.get('/api/client/reviews/'+review.id+'/items/'+saved.items[0].id+'/content?variant=original');expect(original.status()).toBe(200);expect(original.headers()['content-disposition']).toMatch(/^attachment/);
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(audit.violations.map(row=>({id:row.id,impact:row.impact}))).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('task-fidelity-client-review-1440.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Accept',exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'Reject',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)).toBe(false);await page.screenshot({path:testInfo.outputPath('task-fidelity-client-review-390.png'),animations:'disabled'});
  await run.artist.page.goto('/workspace#projects/'+run.project.id+'/images');await run.artist.page.locator('.deliverable-row[data-id="'+run.image.id+'"]').click();await run.artist.page.getByRole('dialog').getByRole('button',{name:'Review & compare versions',exact:true}).click();await expect(run.artist.page.locator('.render-client-feedback')).toContainText('Please soften the material reflection.');expect(await run.artist.page.locator('.render-client-feedback').innerText()).not.toContain(run.person.email);
 }finally{await run.close();}
});

test('view-only recipients can read issued images but cannot submit decisions or download unshared originals',async({browser})=>{
 const run=await fixture(browser,{canApprove:false});
 try{
  const review=await issue(run,{canDecide:false,allowDownload:false});await clientSignIn(run);await run.client.page.goto('/review#reviews/'+review.id);await expect(run.client.page.locator('.client-issued-image')).toBeVisible();await expect(run.client.page.getByRole('button',{name:'Accept',exact:true})).toHaveCount(0);
  const saved=await (await run.client.context.request.get('/api/client/reviews/'+review.id)).json(),auth=await (await run.client.context.request.get('/api/client/auth')).json(),iid=saved.items[0].id;
  const forged=await run.client.context.request.post('/api/client/reviews/'+review.id+'/items/'+iid+'/response',{headers:{Origin:origin,'X-CSRF-Token':auth.csrf,'Idempotency-Key':randomUUID()},data:{expectedVersion:0,decision:'accepted',message:'Attempt'}});expect(forged.status()).toBe(403);
  expect((await run.client.context.request.get('/api/client/reviews/'+review.id+'/items/'+iid+'/content?variant=original')).status()).toBe(404);
 }finally{await run.close();}
});

test('revoking client access immediately hides metadata, previews and response controls',async({browser})=>{
 const run=await fixture(browser);
 try{
  const review=await issue(run);await clientSignIn(run);const saved=await (await run.client.context.request.get('/api/client/reviews/'+review.id)).json(),iid=saved.items[0].id;
  const revoked=await mutation(run.founder.context,'/projects/'+run.project.id+'/clients',{...run.person,user_id:run.grant.user_id,active:false,expectedVersion:1});expect(revoked.status()).toBe(200);
  expect([403,404]).toContain((await run.client.context.request.get('/api/client/reviews/'+review.id)).status());expect([403,404]).toContain((await run.client.context.request.get('/api/client/reviews/'+review.id+'/items/'+iid+'/content')).status());
  await run.client.page.goto('/review#reviews/'+review.id);await expect(run.client.page.locator('.client-issued-image')).toHaveCount(0);await expect(run.client.page.getByRole('button',{name:'Email sign-in link',exact:true})).toBeVisible();
 }finally{await run.close();}
});

test('new renders leave an earlier issued image and its accepted response unchanged',async({browser})=>{
 const run=await fixture(browser);
 try{
  const first=await issue(run);await clientSignIn(run);await run.client.page.goto('/review#reviews/'+first.id);await run.client.page.getByRole('button',{name:'Accept',exact:true}).click();await expect(run.client.page.locator('.client-response-record')).toContainText('Accepted');
  const before=await (await run.founder.context.request.get('/api/deliverables/'+run.image.id)).json(),newer=await upload(run.artist.context,run.image.id,before.version,'#bda88f');
  const retained=await (await run.client.context.request.get('/api/client/reviews/'+first.id)).json();expect(retained.items[0].number).toBe(1);expect(retained.items[0].response.decision).toBe('accepted');
  run.version=newer;const next=await issue(run),fresh=await (await run.client.context.request.get('/api/client/reviews/'+next.id)).json();expect(fresh.items[0].number).toBe(2);expect(fresh.items[0].response).toBeNull();
 }finally{await run.close();}
});

test('pending response saves block navigation and closure makes a client review read-only',async({browser})=>{
 const run=await fixture(browser);let release;
 try{
  const review=await issue(run);await clientSignIn(run);const page=run.client.page;await page.goto('/review#reviews/'+review.id);let began;const started=new Promise(done=>began=done),held=new Promise(done=>release=done);
  await page.route('**/api/client/reviews/*/items/*/response',async route=>{began();await held;return route.continue();});await page.getByRole('button',{name:'Accept',exact:true}).click();await started;await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled();await expect(page.locator('.client-issued-images button')).toBeDisabled();release();await expect(page.locator('.client-response-record')).toContainText('Accepted');
  const closed=await mutation(run.founder.context,'/reviews/'+review.id,{expectedVersion:1,status:'closed'},'PATCH');expect(closed.status()).toBe(200);await page.reload();await expect(page.locator('.client-response-record')).toContainText('Accepted');await expect(page.getByRole('button',{name:'Accept',exact:true})).toHaveCount(0);await expect(page.locator('.client-portal-main')).toContainText('This review is closed.');
 }finally{release?.();await run.close();}
});

test('client mutations require the review CSRF token and explicit same-origin requests',async({browser})=>{
 const run=await fixture(browser);
 try{
  const review=await issue(run);await clientSignIn(run);const detail=await (await run.client.context.request.get('/api/client/reviews/'+review.id)).json(),auth=await (await run.client.context.request.get('/api/client/auth')).json(),url='/api/client/reviews/'+review.id+'/items/'+detail.items[0].id+'/response',body={expectedVersion:0,decision:'accepted',message:''};
  expect((await run.client.context.request.post(url,{headers:{Origin:origin,'Idempotency-Key':randomUUID()},data:body})).status()).toBe(403);
  expect((await run.client.context.request.post(url,{headers:{Origin:'https://other.invalid','X-CSRF-Token':auth.csrf,'Idempotency-Key':randomUUID()},data:body})).status()).toBe(403);
  const stored=await (await run.client.context.request.get('/api/client/reviews/'+review.id)).json();expect(stored.items[0].response).toBeNull();
 }finally{await run.close();}
});
