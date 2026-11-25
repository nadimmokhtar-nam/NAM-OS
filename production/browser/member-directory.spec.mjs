import {test,expect} from '@playwright/test';
import {actor,profiles,mutate} from './support.mjs';

test('Founder can find a suspended account and restore it through the complete member directory',async({browser})=>{
 const fixture=await profiles(),target=fixture.users.find(user=>user.key==='sales_2'),founder=await actor(browser,'founder'),sales=await actor(browser,'sales_2');
 let originallyActive,attemptedSuspend=false;
 const directory=async()=>{
  const response=await founder.context.request.get('/api/auth/members');expect(response.status()).toBe(200);return response.json();
 };
 try{
  const before=await directory(),original=before.accounts.find(member=>member.id===target.id);
  expect(original).toBeTruthy();expect(original.status).toBe('active');originallyActive=true;
  const accessResponse=await founder.context.request.get('/api/auth/access/'+target.id);expect(accessResponse.status()).toBe(200);
  const originalAccess=await accessResponse.json(),normalized=grants=>grants.map(({section,can_create})=>({section,can_create})).sort((a,b)=>a.section.localeCompare(b.section));
  expect((await sales.context.request.get('/api/bootstrap?view=tasks')).status()).toBe(200);
  expect((await sales.context.request.get('/api/auth/members')).status()).toBe(403);
  await founder.page.goto('/workspace#settings');
  await expect(founder.page.getByRole('heading',{name:'Workspace access',exact:true})).toBeVisible();
  const suspend=founder.page.locator('[data-security-action="suspend"][data-security-id="'+target.id+'"]');
  await expect(suspend).toBeVisible();
  founder.page.once('dialog',prompt=>prompt.accept());
  const suspended=founder.page.waitForResponse(response=>response.url().endsWith('/api/auth/members/'+target.id+'/suspend')&&response.request().method()==='POST');
  attemptedSuspend=true;await suspend.click();expect((await suspended).status()).toBe(200);
  // The refreshed directory must include the inactive membership. Hiding it
  // under ordinary active-only RLS would make the Restore action disappear.
  const restore=founder.page.locator('[data-security-action="restore"][data-security-id="'+target.id+'"]');
  await expect(restore).toBeVisible();
  const inactive=(await directory()).accounts.find(member=>member.id===target.id);
  expect(inactive?.status).toBe('suspended');expect(inactive?.role).toBe(original.role);expect(inactive?.email).toBe(original.email);
  expect((await sales.context.request.get('/api/bootstrap?view=tasks')).status()).toBe(403);
  const restored=founder.page.waitForResponse(response=>response.url().endsWith('/api/auth/members/'+target.id+'/restore')&&response.request().method()==='POST');
  await restore.click();expect((await restored).status()).toBe(200);await expect(suspend).toBeVisible();
  expect((await directory()).accounts.find(member=>member.id===target.id)?.status).toBe('active');
  // Suspension changes database authorization rather than fabricating another
  // Auth identity. The retained managed session regains its original access.
  const resumed=await sales.context.request.get('/api/bootstrap?view=tasks');expect(resumed.status()).toBe(200);
  const data=await resumed.json();expect(data.actor.id).toBe(target.id);expect(data.actor.role).toBe(originalAccess.role);
  const finalAccess=await (await founder.context.request.get('/api/auth/access/'+target.id)).json();
  expect(finalAccess.role).toBe(originalAccess.role);expect(normalized(finalAccess.grants)).toEqual(normalized(originalAccess.grants));
 }finally{
  try{
   if(originallyActive&&attemptedSuspend){
    const current=(await directory()).accounts.find(member=>member.id===target.id);expect(current).toBeTruthy();
    if(current.status!=='active')expect((await mutate(founder.context,'/auth/members/'+target.id+'/restore',{})).status()).toBe(200);
    expect((await directory()).accounts.find(member=>member.id===target.id)?.status).toBe('active');
   }
  }finally{await Promise.all([founder.context.close(),sales.context.close()]);}
 }
});
