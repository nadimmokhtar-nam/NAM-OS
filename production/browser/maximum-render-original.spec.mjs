import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {actor,profiles,origin} from './support.mjs';
import {maximumRenderPNG,MAXIMUM_RENDER_BYTES} from './maximum-render-fixture.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const denied=response=>expect([403,404]).toContain(response.status());

async function mutation(context,path,body,method='POST'){
 const bootstrap=await context.request.get('/api/bootstrap');expect(bootstrap.status()).toBe(200);const {csrf}=await bootstrap.json();
 return context.request.fetch('/api'+path,{method,headers:{Origin:origin,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:body,timeout:60000});
}

async function upload(context,did,expectedVersion,bytes,fileName){
 const digest=hash(bytes),reserved=await mutation(context,'/deliverables/'+did+'/renders',{expectedVersion,file_name:fileName,mime:'image/png',byte_size:bytes.length,sha256:digest,note:'Synthetic maximum-original transport verification.'});
 expect(reserved.status()).toBe(201);const plan=await reserved.json(),target=new URL(plan.uploadUrl);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54321')throw Error('Maximum render uploads require the disposable local provider.');
 const transferred=await context.request.put(plan.uploadUrl,{headers:{'Content-Type':'image/png','x-upsert':'false'},data:bytes,timeout:60000});expect([200,201]).toContain(transferred.status());
 const finished=await mutation(context,'/renders/'+plan.id+'/finish',{expectedVersion});expect(finished.status()).toBe(200);const version=await finished.json();expect(version.status).toBe('ready');
 return {version,digest};
}

async function imageDetail(founder,did){const response=await founder.context.request.get('/api/deliverables/'+did);expect(response.status()).toBe(200);return response.json();}

async function original(context,path,digest,size){
 const response=await context.request.get(path,{timeout:60000});
 try{
  expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('private, no-store');expect(response.headers()['content-type']).toBe('image/png');expect(response.headers()['content-disposition']).toMatch(/^attachment;/);
  // Next streams route responses and may omit the supplied framing header.
  // The complete body length and fingerprint remain mandatory below.
  const contentLength=response.headers()['content-length'];if(contentLength!==undefined)expect(contentLength).toBe(String(size));
  const bytes=await response.body();expect(bytes.length).toBe(size);expect(hash(bytes)).toBe(digest);
 }finally{await response.dispose();}
}

async function signInClient(client,email){
 const invited=await client.context.request.post('/api/client/auth/link',{headers:{Origin:origin},data:{email}});expect(invited.status()).toBe(202);let messageId='';
 // Only the isolated capture inbox is read. Provider links and bearer material
 // stay out of diagnostics and retained summaries.
 await expect.poll(async()=>{
  const response=await client.context.request.get('http://127.0.0.1:54324/api/v1/messages?limit=100');if(response.status()!==200)return false;
  const data=await response.json(),message=(data.messages||[]).find(row=>(row.To||[]).some(person=>person.Address.toLowerCase()===email));messageId=message?.ID||'';return !!messageId;
 },{timeout:20000,message:'The synthetic maximum-original client link must reach the local capture inbox.'}).toBe(true);
 const response=await client.context.request.get('http://127.0.0.1:54324/api/v1/message/'+encodeURIComponent(messageId));expect(response.status()).toBe(200);
 const message=await response.json(),content=(message.HTML||message.Text||'').replaceAll('&amp;','&'),candidate=content.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0];
 if(!candidate)throw Error('The synthetic client email has no provider verification link.');const target=new URL(candidate);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54321'||target.pathname!=='/auth/v1/verify')throw Error('Maximum-original client sign-in requires the disposable local provider.');
 try{await client.page.goto(candidate,{timeout:15000});await expect(client.page.locator('.client-portal')).toBeVisible();}catch{throw Error('Synthetic maximum-original client sign-in did not reach the portal. The provider link was omitted.');}
 expect(new URL(client.page.url()).hash.includes('access_token')).toBe(false);
}

test('a 50 MiB verified original retains exact staff and issued-client bytes and stops serving revoked access',async({browser})=>{
 test.setTimeout(180000);
 const sessions=[];let founder,artist,client,project,image,asset,delivery,clientItem,manifest;
 try{
  await test.step('Prepare one exactly 50 MiB PNG and disposable project identities',async()=>{
   const data=await profiles(),owner=data.users.find(user=>user.key==='artist_1'),lead=data.users.find(user=>user.key==='founder');
   founder=await actor(browser,'founder');sessions.push(founder.context);artist=await actor(browser,'artist_1');sessions.push(artist.context);
   const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000}});sessions.push(context);client={context,page:await context.newPage(),email:'maximum-original-'+randomUUID()+'@client-qa.invalid'};
   const created=await mutation(founder.context,'/projects',{title:'[QA] Maximum original '+randomUUID().slice(0,8),lead_id:lead.id,member_ids:[owner.id]});expect(created.status()).toBe(201);project=await created.json();
   const added=await mutation(founder.context,'/projects/'+project.id+'/deliverables',{code:'INT-01',title:'[QA] Maximum-size original',artist_id:owner.id,stage:'Draft production'});expect(added.status()).toBe(201);image=await added.json();
   const shared=await mutation(founder.context,'/projects/'+project.id+'/clients',{name:'QA Maximum Original Client',email:client.email,active:true,can_approve:false});expect(shared.status()).toBe(201);client.grant=await shared.json();
   const bytes=await maximumRenderPNG();expect(bytes.length).toBe(MAXIMUM_RENDER_BYTES);expect(bytes.length).toBe(52428800);
   asset=await upload(artist.context,image.id,1,bytes,'maximum-original.png');expect(asset.version.number).toBe(1);
   const decoded=await sharp(bytes).metadata();expect(asset.version.width).toBe(decoded.width);expect(asset.version.height).toBe(decoded.height);
  });

  await test.step('Download the complete private original through the staff gateway',async()=>{
   await original(artist.context,'/api/renders/'+asset.version.id+'/content?variant=original',asset.digest,MAXIMUM_RENDER_BYTES);
  });

  await test.step('Issue the verified maximum-size original and download it as the client',async()=>{
   const current=await imageDetail(founder,image.id),approved=await mutation(founder.context,'/deliverables/'+image.id,{expectedVersion:current.version,changes:{stage:'Final approval'}},'PATCH');expect(approved.status()).toBe(200);const ready=await approved.json();
   const issued=await mutation(founder.context,'/projects/'+project.id+'/deliveries',{title:'[QA] Maximum original delivery',message:'Synthetic transport verification.',items:[{deliverable_id:image.id,render_id:asset.version.id,expected_version:ready.version}],recipients:[client.grant.user_id]});expect(issued.status()).toBe(201);delivery=await issued.json();
   expect(delivery.manifest).toHaveLength(1);expect(delivery.manifest[0].sha256).toBe(asset.digest);expect(delivery.manifest[0].byte_size).toBe(MAXIMUM_RENDER_BYTES);
   await signInClient(client,client.email);
   const review=await client.context.request.get('/api/client/reviews/'+delivery.review_request_id);expect(review.status()).toBe(200);const detail=await review.json();expect(detail.purpose).toBe('delivery');expect(detail.can_decide).toBe(false);clientItem=detail.items[0].id;
   await original(client.context,'/api/client/reviews/'+delivery.review_request_id+'/items/'+clientItem+'/content?variant=original',asset.digest,MAXIMUM_RENDER_BYTES);
   const response=await client.context.request.get('/api/client/reviews/'+delivery.review_request_id+'/manifest');expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('private, no-store');manifest=await response.json();expect(manifest.files[0].sha256).toBe(asset.digest);expect(manifest.files[0].byte_size).toBe(MAXIMUM_RENDER_BYTES);
  });

  await test.step('Upload a newer version while retaining the issued maximum-size bytes and manifest',async()=>{
   const current=await imageDetail(founder,image.id),bytes=await sharp({create:{width:400,height:240,channels:3,background:'#bda88f'}}).png().toBuffer(),newer=await upload(artist.context,image.id,current.version,bytes,'newer-original.png');expect(newer.version.number).toBe(2);expect(newer.digest).not.toBe(asset.digest);
   await original(client.context,'/api/client/reviews/'+delivery.review_request_id+'/items/'+clientItem+'/content?variant=original',asset.digest,MAXIMUM_RENDER_BYTES);
   const response=await client.context.request.get('/api/client/reviews/'+delivery.review_request_id+'/manifest');expect(response.status()).toBe(200);expect(await response.json()).toEqual(manifest);
  });

  await test.step('Cancel the client delivery and revoke project membership before later reads',async()=>{
   const cancelled=await mutation(founder.context,'/final-deliveries/'+delivery.id+'/cancel',{expectedVersion:delivery.version});expect(cancelled.status()).toBe(200);
   for(const suffix of ['','/manifest','/items/'+clientItem+'/content?variant=original'])denied(await client.context.request.get('/api/client/reviews/'+delivery.review_request_id+suffix));
   const response=await founder.context.request.get('/api/projects/'+project.id);expect(response.status()).toBe(200);const current=await response.json();
   const revoked=await mutation(founder.context,'/projects/'+project.id,{expectedVersion:current.version,changes:{member_ids:[]}},'PATCH');expect(revoked.status()).toBe(200);
   for(const suffix of ['content','content?variant=thumbnail','content?variant=original','comments'])denied(await artist.context.request.get('/api/renders/'+asset.version.id+'/'+suffix));
   denied(await artist.context.request.get('/api/deliverables/'+image.id+'/renders'));
  });
 }finally{
  // Ready versions retain their immutable history in this disposable workspace.
  await Promise.allSettled(sessions.map(context=>context.close()));
 }
});
