import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,mutate} from './support.mjs';

async function fixture(browser){
 const founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),other=await actor(browser,'artist_2'),data=await profiles(),owner=data.users.find(user=>user.key==='artist_1'),lead=data.users.find(user=>user.key==='founder');
 const projectResponse=await mutate(founder.context,'/projects',{title:'[QA] Render version review '+Date.now().toString(36),lead_id:lead.id,member_ids:[owner.id]});expect(projectResponse.status()).toBe(201);const project=await projectResponse.json();
 const imageResponse=await mutate(founder.context,'/projects/'+project.id+'/deliverables',{code:'INT-01',title:'[QA] Living room render history',artist_id:owner.id,stage:'Draft production'});expect(imageResponse.status()).toBe(201);const image=await imageResponse.json();
 return {founder,artist,other,image,project,async close(){await Promise.all([founder.context.close(),artist.context.close(),other.context.close()]);}};
}
async function upload(run,color,note){
 const page=run.artist.page,dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Upload render',exact:true}).click();await dialog.getByLabel('Render file',{exact:true}).setInputFiles({name:'living-room.png',mimeType:'image/png',buffer:await sharp({create:{width:400,height:240,channels:3,background:color}}).png().toBuffer()});await dialog.getByLabel('Version note',{exact:true}).fill(note);
 const finished=page.waitForResponse(response=>/\/api\/renders\/[^/]+\/finish$/.test(response.url())&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Upload & verify',exact:true}).click();const response=await finished;expect(response.status()).toBe(200);const version=await response.json();
 await expect(dialog.getByRole('button',{name:'Review & compare versions',exact:true})).toBeVisible();return version;
}
async function openImage(run){await run.artist.page.goto('/workspace#projects/'+run.project.id+'/images');await run.artist.page.locator('.deliverable-row[data-id="'+run.image.id+'"]').click();await expect(run.artist.page.getByRole('dialog').getByLabel('Camera brief',{exact:true})).toBeVisible();}

test('an artist uploads real render versions, compares them and keeps feedback pinned to the selected version',async({browser},testInfo)=>{
 const run=await fixture(browser),page=run.artist.page;
 try{
  await openImage(run);const a=await upload(run,'#9b826e','First material pass');expect(a.number).toBe(1);const b=await upload(run,'#b8a592','Revised daylight');expect(b.number).toBe(2);
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Review & compare versions',exact:true}).click();await expect(dialog.locator('.render-review')).toBeVisible();await expect(dialog.locator('.render-image')).toHaveCount(1);await expect.poll(()=>dialog.locator('.render-image').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await dialog.getByLabel('Compare with version',{exact:true}).selectOption(a.id);await expect(dialog.locator('.render-figure')).toHaveCount(2);await expect(dialog.locator('.render-canvases')).toHaveClass(/comparing/);
  const canvas=dialog.locator('[data-render-canvas]');await canvas.focus();await canvas.press('Enter');await expect(dialog.getByLabel('Add internal feedback',{exact:true})).toBeFocused();await dialog.getByLabel('Add internal feedback',{exact:true}).fill('Keep this warmer material direction, with softer light at this point.');await dialog.getByRole('button',{name:'Post feedback',exact:true}).click();await expect(dialog.locator('.render-comment')).toContainText('softer light at this point');await expect(dialog.getByRole('button',{name:'Read feedback marker 1',exact:true})).toBeVisible();
  const assertMarkerPosition=async()=>{await expect.poll(()=>dialog.locator('[data-render-canvas]').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);const point=await dialog.getByRole('button',{name:'Read feedback marker 1',exact:true}).evaluate(marker=>{const pin=marker.getBoundingClientRect(),image=marker.parentElement.querySelector('.render-image').getBoundingClientRect();return {x:(pin.left+pin.width/2-image.left)/image.width,y:(pin.top+pin.height/2-image.top)/image.height};});expect(point.x).toBeCloseTo(0.5,2);expect(point.y).toBeCloseTo(0.5,2);};await assertMarkerPosition();
  const comments=await (await run.artist.context.request.get('/api/renders/'+b.id+'/comments')).json();expect(comments.items[0].point_x).toBe(0.5);expect(comments.items[0].point_y).toBe(0.5);expect(comments.items[0].number).toBe(1);expect((await (await run.artist.context.request.get('/api/renders/'+a.id+'/comments')).json()).total).toBe(0);
  await dialog.locator('.render-version-item[data-id="'+a.id+'"]').click();await expect(dialog.locator('.render-feedback')).toContainText('No feedback on this version yet.');await expect(dialog.locator('.render-figure')).toContainText('First material pass');
  const original=await run.artist.context.request.get('/api/renders/'+a.id+'/content?variant=original');expect(original.status()).toBe(200);expect(original.headers()['content-disposition']).toMatch(/^attachment/);expect((await sharp(await original.body()).metadata()).width).toBe(400);
  await page.screenshot({path:testInfo.outputPath('task-fidelity-render-review-1440.png'),animations:'disabled'});
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(audit.violations.map(item=>({id:item.id,impact:item.impact}))).toEqual([]);
  await page.setViewportSize({width:390,height:844});await expect(dialog.locator('.render-review')).toBeVisible();expect(await dialog.evaluate(node=>node.scrollWidth>node.clientWidth+1)).toBe(false);await expect(dialog.getByLabel('Add internal feedback',{exact:true})).toBeVisible();await dialog.locator('.render-version-item[data-id="'+b.id+'"]').click();await expect(dialog.getByRole('button',{name:'Read feedback marker 1',exact:true})).toBeVisible();await assertMarkerPosition();await page.screenshot({path:testInfo.outputPath('task-fidelity-render-review-390.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('heading',{name:'Images & deliverables',exact:true})).toBeVisible();
 }finally{await run.close();}
});

test('an interrupted render upload recovers its original reservation without creating another version',async({browser})=>{
 const run=await fixture(browser),page=run.artist.page;let interrupted=false;
 try{
  await openImage(run);await page.route('**/storage/v1/object/upload/sign/nam-render-versions/**',async route=>{if(!interrupted&&route.request().method()==='PUT'){interrupted=true;return route.abort('failed');}return route.continue();});
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Upload render',exact:true}).click();await dialog.getByLabel('Render file',{exact:true}).setInputFiles({name:'recoverable.png',mimeType:'image/png',buffer:await sharp({create:{width:80,height:60,channels:3,background:'#a88f79'}}).png().toBuffer()});await dialog.getByLabel('Version note',{exact:true}).fill('One reservation across an interrupted transfer.');await dialog.getByRole('button',{name:'Upload & verify',exact:true}).click();
  await expect(dialog.locator('.form-error')).toContainText('interrupted');const pending=await (await run.artist.context.request.get('/api/deliverables/'+run.image.id+'/renders')).json();expect(pending.pending).toHaveLength(1);expect(pending.total).toBe(0);const id=pending.pending[0].id;
  await dialog.getByRole('button',{name:'Retry upload & verify',exact:true}).click();await expect(dialog.getByRole('button',{name:'Review & compare versions',exact:true})).toBeVisible();const ready=await (await run.artist.context.request.get('/api/deliverables/'+run.image.id+'/renders')).json();expect(ready.total).toBe(1);expect(ready.pending).toHaveLength(0);expect(ready.items[0].id).toBe(id);
 }finally{await run.close();}
});

test('image changes during upload require explicit reload and a pending save cannot be closed',async({browser})=>{
 const run=await fixture(browser),page=run.artist.page;let release;
 try{
  await openImage(run);const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Upload render',exact:true}).click();await dialog.getByLabel('Render file',{exact:true}).setInputFiles({name:'conflict.png',mimeType:'image/png',buffer:await sharp({create:{width:80,height:60,channels:3,background:'#c4ad91'}}).png().toBuffer()});
  let started;const seen=new Promise(done=>started=done),hold=new Promise(done=>release=done);await page.route('**/api/renders/*/finish',async route=>{started();await hold;return route.continue();});await dialog.getByRole('button',{name:'Upload & verify',exact:true}).click();await seen;await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  const newer=await mutate(run.founder.context,'/deliverables/'+run.image.id,{expectedVersion:1,changes:{camera_notes:'A newer agreed camera brief.'}},'PATCH');expect(newer.status()).toBe(200);release();await expect(dialog.locator('.form-error')).toContainText('changed');expect(await dialog.getByLabel('Render file',{exact:true}).evaluate(input=>input.files?.[0]?.name)).toBe('conflict.png');
  await page.unroute('**/api/renders/*/finish');await dialog.getByRole('button',{name:'Reload image details',exact:true}).click();await expect(dialog.locator('[data-render-status]')).toContainText('reloaded');await expect(dialog.locator('[data-render-reloaded]')).toContainText('A newer agreed camera brief.');const retried=page.waitForResponse(response=>/\/api\/renders\/[^/]+\/finish$/.test(response.url())&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Retry upload & verify',exact:true}).click();expect((await retried).status()).toBe(200);await expect(dialog.getByLabel('Camera brief',{exact:true})).toHaveValue('A newer agreed camera brief.');expect((await (await run.artist.context.request.get('/api/deliverables/'+run.image.id+'/renders')).json()).total).toBe(1);
 }finally{release?.();await run.close();}
});

test('revoking a shared project immediately denies the render, preview, original and feedback',async({browser})=>{
 const run=await fixture(browser);
 try{
  await openImage(run);const version=await upload(run,'#96816d','Private project render.');
  for(const suffix of ['content','content?variant=original','comments'])expect([403,404]).toContain((await run.other.context.request.get('/api/renders/'+version.id+'/'+suffix)).status());
  const revoked=await mutate(run.founder.context,'/projects/'+run.project.id,{expectedVersion:run.project.version,changes:{member_ids:[]}},'PATCH');expect(revoked.status()).toBe(200);
  for(const suffix of ['content','content?variant=thumbnail','content?variant=original','comments'])expect([403,404]).toContain((await run.artist.context.request.get('/api/renders/'+version.id+'/'+suffix)).status());
 }finally{await run.close();}
});
