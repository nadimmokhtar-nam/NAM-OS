import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {actor,profiles,origin} from './support.mjs';

async function mutation(context,path,body,method='POST',key=randomUUID()){
 const bootstrap=await context.request.get('/api/bootstrap');expect(bootstrap.status()).toBe(200);const {csrf}=await bootstrap.json();
 return context.request.fetch('/api'+path,{method,headers:{Origin:origin,'X-CSRF-Token':csrf,'Idempotency-Key':key},data:body});
}
async function upload(context,did,expectedVersion,color){
 const bytes=await sharp({create:{width:400,height:240,channels:3,background:color}}).png().toBuffer(),digest=createHash('sha256').update(bytes).digest('hex');
 const reserved=await mutation(context,'/deliverables/'+did+'/renders',{expectedVersion,file_name:'final-image.png',mime:'image/png',byte_size:bytes.length,sha256:digest,note:'PRIVATE internal render direction'});expect(reserved.status()).toBe(201);const plan=await reserved.json(),target=new URL(plan.uploadUrl);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54321')throw Error('Render uploads require the disposable local provider.');
 const transferred=await context.request.put(plan.uploadUrl,{headers:{'Content-Type':'image/png','x-upsert':'false'},data:bytes});expect([200,201]).toContain(transferred.status());
 const finished=await mutation(context,'/renders/'+plan.id+'/finish',{expectedVersion});expect(finished.status()).toBe(200);return {version:await finished.json(),bytes,digest};
}
async function fixture(browser,{withClient=false}={}){
 const founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),sessions=[founder.context,artist.context];
 try{
  const data=await profiles(),owner=data.users.find(user=>user.key==='artist_1'),lead=data.users.find(user=>user.key==='founder');
  const projectResponse=await mutation(founder.context,'/projects',{title:'[QA] Revision and final files '+randomUUID().slice(0,8),lead_id:lead.id,member_ids:[owner.id]});expect(projectResponse.status()).toBe(201);const project=await projectResponse.json();
  const imageResponse=await mutation(founder.context,'/projects/'+project.id+'/deliverables',{code:'INT-01',title:'[QA] Final living room',artist_id:owner.id,stage:'Draft production',camera_notes:'PRIVATE artist camera notes'});expect(imageResponse.status()).toBe(201);const image=await imageResponse.json(),asset=await upload(artist.context,image.id,1,'#ac927c');
  let client=null,person=null,grant=null;
  if(withClient){
   person={name:'QA Final Delivery Client',email:'delivery-'+randomUUID()+'@client-qa.invalid',active:true,can_approve:true};const shared=await mutation(founder.context,'/projects/'+project.id+'/clients',person);expect(shared.status()).toBe(201);grant=await shared.json();
   const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000},acceptDownloads:true});sessions.push(context);client={context,page:await context.newPage()};
  }
  return {founder,artist,owner,project,image,asset,client,person,grant,async close(){await Promise.all(sessions.map(context=>context.close()));}};
 }catch(error){await Promise.allSettled(sessions.map(context=>context.close()));throw error;}
}
async function imageDetail(run){const response=await run.founder.context.request.get('/api/deliverables/'+run.image.id);expect(response.status()).toBe(200);return response.json();}
async function clientSignIn(run){
 const invited=await run.client.context.request.post('/api/client/auth/link',{headers:{Origin:origin},data:{email:run.person.email}});expect(invited.status()).toBe(202);let messageId='';
 // Read only the disposable capture inbox. Neither provider links nor bearer
 // material are included in test diagnostics or retained safe summaries.
 await expect.poll(async()=>{const response=await run.client.context.request.get('http://127.0.0.1:54324/api/v1/messages?limit=100');if(response.status()!==200)return false;const data=await response.json(),message=(data.messages||[]).find(row=>(row.To||[]).some(person=>person.Address.toLowerCase()===run.person.email));messageId=message?.ID||'';return !!messageId;},{timeout:20000,message:'The synthetic sign-in email must reach the local capture inbox.'}).toBe(true);
 const response=await run.client.context.request.get('http://127.0.0.1:54324/api/v1/message/'+encodeURIComponent(messageId));expect(response.status()).toBe(200);const message=await response.json(),content=(message.HTML||message.Text||'').replaceAll('&amp;','&'),candidate=content.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0];
 if(!candidate)throw Error('The synthetic sign-in email has no provider verification link.');const target=new URL(candidate);if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54321'||target.pathname!=='/auth/v1/verify')throw Error('Client sign-in requires the disposable local provider.');
 try{await run.client.page.goto(candidate,{timeout:15000});await expect(run.client.page.locator('.client-portal')).toBeVisible();}catch{throw Error('Synthetic client sign-in did not reach the portal. The provider link was omitted.');}
 expect(new URL(run.client.page.url()).hash.includes('access_token')).toBe(false);
}
async function downloadedBytes(download){expect(await download.failure()).toBeNull();const stream=await download.createReadStream();if(!stream)throw Error('The disposable browser download has no readable bytes.');const chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}

test('a stale image requires reload before a revision round creates one real assigned task that the artist resolves and Founder closes',async({browser},testInfo)=>{
 let run,round,task,savedRequest;
 try{
  await test.step('Prepare a disposable project with a verified artist image',async()=>{run=await fixture(browser);});
  await test.step('Reject a stale image while retaining the entered revision instruction',async()=>{
   const page=run.founder.page;await page.goto('/workspace#projects/'+run.project.id+'/revisions');await page.getByRole('button',{name:'Open revision round',exact:true}).click();const dialog=page.getByRole('dialog');
   await dialog.getByLabel('Round title',{exact:true}).fill('[QA] Softer daylight round');await dialog.getByLabel('Shared round brief',{exact:true}).fill('Retain the approved camera and soften the light.');await dialog.getByLabel('Revision deadline',{exact:true}).fill('2026-12-12');await dialog.locator('[data-round-image][value="'+run.image.id+'"]').check();await dialog.getByLabel('Revision instruction · INT-01',{exact:true}).fill('Soften the highlight on the timber wall.');
   const current=await imageDetail(run);expect((await mutation(run.artist.context,'/deliverables/'+run.image.id,{expectedVersion:current.version,changes:{camera_notes:'PRIVATE camera notes changed in another session'}},'PATCH')).status()).toBe(200);
   const rejected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/projects/'+run.project.id+'/revisions'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create revision work',exact:true}).click();expect((await rejected).status()).toBe(409);await expect(dialog.locator('.form-error')).toContainText('Reload');await expect(dialog.getByLabel('Revision instruction · INT-01',{exact:true})).toHaveValue('Soften the highlight on the timber wall.');
   await dialog.getByRole('button',{name:'Reload current image versions',exact:true}).click();await expect(dialog.locator('.form-error')).toContainText('Current versions loaded.');await expect(dialog.locator('[data-round-image]:checked')).toHaveCount(0);await dialog.locator('[data-round-image][value="'+run.image.id+'"]').check();await expect(dialog.getByLabel('Round title',{exact:true})).toHaveValue('[QA] Softer daylight round');await expect(dialog.getByLabel('Revision instruction · INT-01',{exact:true})).toHaveValue('Soften the highlight on the timber wall.');
  });
  await test.step('Create and exactly replay one central production task',async()=>{
   const page=run.founder.page,dialog=page.getByRole('dialog'),saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/projects/'+run.project.id+'/revisions'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create revision work',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);round=await response.json();savedRequest={body:response.request().postDataJSON(),key:response.request().headers()['idempotency-key']};await expect(dialog.locator('.project-round-detail')).toBeVisible();
   expect(round.items).toHaveLength(1);const actual=await run.artist.context.request.get('/api/tasks/'+round.items[0].task_id);expect(actual.status()).toBe(200);task=await actual.json();expect(task.owner_id).toBe(run.owner.id);expect(task.project_id).toBe(run.project.id);expect(task.deliverable_id).toBe(run.image.id);expect(task.production_stage).toBe('Revisions');expect(task.description).toBe('Soften the highlight on the timber wall.');expect(task.status).toBe('Todo');
   const before=await imageDetail(run),replayed=await mutation(run.founder.context,'/projects/'+run.project.id+'/revisions',savedRequest.body,'POST',savedRequest.key);expect(replayed.status()).toBe(201);expect((await replayed.json()).id).toBe(round.id);expect((await imageDetail(run)).version).toBe(before.version);
   const tasks=await (await run.founder.context.request.get('/api/tasks?section=projects&project_id='+run.project.id+'&page=1')).json();expect(tasks.total).toBe(1);expect(tasks.items.map(item=>item.id)).toEqual([task.id]);await page.screenshot({path:testInfo.outputPath('task-fidelity-project-revision-round.png'),animations:'disabled'});
  });
  await test.step('Resolve that same task through the assigned artist workspace',async()=>{
   const page=run.artist.page;await page.goto('/workspace#projects/'+run.project.id+'/revisions');await expect(page.locator('.project-round-scope')).toContainText('your assigned work');await expect(page.getByRole('button',{name:'Open revision round',exact:true})).toHaveCount(0);await page.locator('.project-round-row[data-id="'+round.id+'"]').click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.project-round-item')).toHaveCount(1);await dialog.getByRole('button',{name:'Open production task',exact:true}).click();await expect(dialog.locator('form[data-form="edit-task"]')).toBeVisible();
   await dialog.getByLabel('Status',{exact:true}).selectOption('Done');const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/'+task.id&&response.request().method()==='PATCH');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();const response=await saved;expect(response.status()).toBe(200);expect((await response.json()).status).toBe('Done');await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  });
  await test.step('Close the resolved round while preserving independent image approval',async()=>{
   const page=run.founder.page;await page.goto('/workspace#projects/'+run.project.id+'/revisions');await page.locator('.project-round-row[data-id="'+round.id+'"]').click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.project-round-item')).toContainText('Done');page.once('dialog',confirmation=>confirmation.accept());const closed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/revision-rounds/'+round.id+'/close'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Close resolved round',exact:true}).click();expect((await closed).status()).toBe(200);await expect(dialog.locator('.project-round-detail>.spread .badge')).toHaveText('closed');expect((await imageDetail(run)).stage).toBe('Revisions');expect((await (await run.founder.context.request.get('/api/projects/'+run.project.id+'/reviews')).json()).total).toBe(0);
  });
 }finally{await run?.close();}
});

test('final delivery downloads retain the exact issued bytes and manifest after a newer render and are denied after cancellation',async({browser},testInfo)=>{
 test.setTimeout(90000);let run,delivery,issuedManifest,clientItem;
 try{
  await test.step('Prepare a final-approved image and an invited disposable client',async()=>{run=await fixture(browser,{withClient:true});const current=await imageDetail(run);expect((await mutation(run.founder.context,'/deliverables/'+run.image.id,{expectedVersion:current.version,changes:{stage:'Final approval'}},'PATCH')).status()).toBe(200);});
  await test.step('Issue the selected final image and client through the Founder interface',async()=>{
   const page=run.founder.page;await page.goto('/workspace#projects/'+run.project.id+'/delivery');await page.getByRole('button',{name:'Issue final delivery',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Delivery title',{exact:true}).fill('[QA] Final project files');await dialog.getByLabel('Message to clients',{exact:true}).fill('The approved originals are ready to download.');await dialog.locator('[data-round-image][value="'+run.image.id+'"]').check();await dialog.locator('[data-delivery-client][value="'+run.grant.user_id+'"]').check();await dialog.locator('[name="confirm_final"]').check();
   const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/projects/'+run.project.id+'/deliveries'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Issue final files',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);delivery=await response.json();await expect(dialog.locator('.project-round-detail')).toBeVisible();expect(delivery.manifest).toHaveLength(1);expect(delivery.manifest[0].render_id).toBe(run.asset.version.id);expect(delivery.manifest[0].sha256).toBe(run.asset.digest);expect(delivery.recipients.map(item=>item.user_id)).toEqual([run.grant.user_id]);
  });
  await test.step('Sign in through local email and download view-only final originals and manifest',async()=>{
   await clientSignIn(run);const page=run.client.page;await page.goto('/review#reviews/'+delivery.review_request_id);await expect(page.locator('.client-portal-header')).toContainText('Final delivery');await expect(page.locator('.client-portal-main')).toContainText('Final file · Version 1');await expect(page.getByRole('button',{name:'Accept',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Reject',exact:true})).toHaveCount(0);await expect(page.locator('#client-response-form')).toHaveCount(0);expect(await page.locator('#client-review-app').innerText()).not.toContain('PRIVATE');
   const originalDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download original',exact:true}).click();const original=await downloadedBytes(await originalDownload);expect(createHash('sha256').update(original).digest('hex')).toBe(run.asset.digest);
   const manifestDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download file manifest',exact:true}).click();issuedManifest=JSON.parse((await downloadedBytes(await manifestDownload)).toString('utf8'));expect(issuedManifest.files).toHaveLength(1);expect(issuedManifest.files[0].version).toBe(1);expect(issuedManifest.files[0].sha256).toBe(run.asset.digest);expect(issuedManifest.files[0].render_id).toBeUndefined();expect(issuedManifest.files[0].deliverable_id).toBeUndefined();
   const review=await (await run.client.context.request.get('/api/client/reviews/'+delivery.review_request_id)).json();expect(review.purpose).toBe('delivery');expect(review.can_decide).toBe(false);clientItem=review.items[0].id;await page.screenshot({path:testInfo.outputPath('task-fidelity-client-final-delivery.png'),animations:'disabled'});
  });
  await test.step('Upload a newer verified image without changing the issued files',async()=>{
   const current=await imageDetail(run),newer=await upload(run.artist.context,run.image.id,current.version,'#bda88f');expect(newer.digest).not.toBe(run.asset.digest);expect(newer.version.number).toBe(2);
   const original=await run.client.context.request.get('/api/client/reviews/'+delivery.review_request_id+'/items/'+clientItem+'/content?variant=original');expect(original.status()).toBe(200);expect(createHash('sha256').update(await original.body()).digest('hex')).toBe(run.asset.digest);
   const manifest=await run.client.context.request.get('/api/client/reviews/'+delivery.review_request_id+'/manifest');expect(manifest.status()).toBe(200);expect(manifest.headers()['cache-control']).toBe('private, no-store');expect(await manifest.json()).toEqual(issuedManifest);await run.client.page.reload();await expect(run.client.page.locator('.client-portal-main')).toContainText('Final file · Version 1');
  });
  await test.step('Cancel through the Founder interface and deny client metadata, originals and manifest',async()=>{
   const page=run.founder.page,dialog=page.getByRole('dialog');page.once('dialog',confirmation=>confirmation.accept());const cancelled=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/final-deliveries/'+delivery.id+'/cancel'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Cancel this delivery',exact:true}).click();expect((await cancelled).status()).toBe(200);await expect(dialog.locator('.project-round-detail>.spread .badge')).toHaveText('cancelled');
   for(const suffix of ['','/manifest','/items/'+clientItem+'/content?variant=original'])expect([403,404]).toContain((await run.client.context.request.get('/api/client/reviews/'+delivery.review_request_id+suffix)).status());await run.client.page.reload();await expect(run.client.page.locator('.client-issued-image')).toHaveCount(0);await expect(run.client.page.getByRole('link',{name:'Download file manifest',exact:true})).toHaveCount(0);await expect(run.client.page.getByRole('button',{name:'Accept',exact:true})).toHaveCount(0);
  });
 }finally{await run?.close();}
});
