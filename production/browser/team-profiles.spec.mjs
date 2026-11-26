import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {actor,profiles,origin} from './support.mjs';

async function read(context,path){
 const response=await context.request.get('/api'+path);expect(response.status()).toBe(200);return response.json();
}
async function save(context,path,body,method='PATCH'){
 const {csrf}=await read(context,'/bootstrap');
 return context.request.fetch('/api'+path,{method,headers:{Origin:origin,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:body});
}
const grants=value=>value.map(({section,can_create})=>({section,can_create})).sort((a,b)=>a.section.localeCompare(b.section));
const responseFor=(page,path,method)=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api'+path&&response.request().method()===method);

test('Founder department assignment and an artist profile save persist in the filtered Team directory without changing access',async({browser})=>{
 test.setTimeout(60000);
 const fixture=await profiles(),person=fixture.users.find(user=>user.key==='artist_1');expect(person).toBeTruthy();
 const founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),suffix=randomUUID().slice(0,12),departmentName='[QA] Native team '+suffix,jobTitle='[QA] Profile specialist '+suffix;
 let original,originalAccess,created,attemptedCreate=false;
 const uniqueDepartment=async()=>{
  for(let number=1;number<=4;number++){
   const page=await read(founder.context,'/team/departments?archived=1&page='+number),match=page.items.find(row=>row.name===departmentName);
   if(match)return match;if(!page.hasMore)return null;
  }
  throw new Error('The disposable department list exceeded its supported bound.');
 };
 try{
  original=await read(artist.context,'/team/profile');expect(original.id).toBe(person.id);
  // A previously archived assignment cannot be newly assigned again. Check the
  // shared fixture before changing it so the original department is restorable.
  expect(original.department?.archived,'The shared artist department must be restorable').not.toBe(true);
  originalAccess=await read(founder.context,'/auth/access/'+person.id);expect(originalAccess.role).toBe('artist');
  await founder.page.goto('/workspace#settings');
  const settings=founder.page.getByRole('navigation',{name:'Settings',exact:true});
  await expect(settings.getByRole('button',{name:'Profile',exact:true})).toHaveAttribute('aria-current','page');
  await expect(founder.page.getByRole('heading',{name:'Professional profile',exact:true})).toBeVisible();
  await settings.getByRole('button',{name:'Departments',exact:true}).click();
  await founder.page.getByRole('button',{name:'New department',exact:true}).click();
  const dialog=founder.page.getByRole('dialog');
  await dialog.getByLabel('Department name',{exact:true}).fill(departmentName);
  const creation=responseFor(founder.page,'/team/departments','POST');attemptedCreate=true;
  await dialog.getByRole('button',{name:'Save department',exact:true}).click();
  const createdResponse=await creation;expect(createdResponse.status()).toBe(201);created=await createdResponse.json();
  expect(created.name).toBe(departmentName);expect(created.archived).toBe(false);await expect(dialog).not.toBeVisible();

  await founder.page.goto('/workspace#team');
  const memberAction=founder.page.locator('[data-team-action="member-department"][data-id="'+person.id+'"]');
  await expect(memberAction).toBeVisible();await memberAction.click();
  await dialog.getByLabel('Department',{exact:true}).selectOption(created.id);
  const assignment=responseFor(founder.page,'/team/members/'+person.id+'/department','PATCH');
  await dialog.getByRole('button',{name:'Save department',exact:true}).click();
  const assignedResponse=await assignment;expect(assignedResponse.status()).toBe(200);
  expect((await assignedResponse.json()).department.id).toBe(created.id);await expect(dialog).not.toBeVisible();

  await artist.page.goto('/workspace#settings');
  await expect(artist.page.getByRole('navigation',{name:'Settings',exact:true}).getByRole('button',{name:'Profile',exact:true})).toHaveAttribute('aria-current','page');
  await expect(artist.page.locator('.team-profile-details dd')).toHaveText(departmentName);
  await expect(artist.page.getByLabel('Full name',{exact:true})).toHaveValue(original.name);
  await artist.page.getByLabel('Job title',{exact:true}).fill(jobTitle);
  const profileSave=responseFor(artist.page,'/team/profile','PATCH');
  await artist.page.getByRole('button',{name:'Save profile',exact:true}).click();
  const profileResponse=await profileSave;expect(profileResponse.status()).toBe(200);const saved=await profileResponse.json();
  expect(saved).toMatchObject({id:person.id,name:original.name,job_title:jobTitle,department:{id:created.id},notifications:original.notifications});
  await expect(artist.page.getByLabel('Job title',{exact:true})).toHaveValue(jobTitle);

  await founder.page.getByLabel('Find a team member',{exact:true}).fill(jobTitle);
  const filtered=founder.page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/team/directory'&&url.searchParams.get('search')===jobTitle&&response.request().method()==='GET';});
  await founder.page.getByRole('button',{name:'Search',exact:true}).click();
  const filteredResponse=await filtered;expect(filteredResponse.status()).toBe(200);const directory=await filteredResponse.json();
  expect(directory.total).toBe(1);expect(directory.items).toHaveLength(1);
  expect(directory.items[0]).toMatchObject({id:person.id,name:original.name,role:originalAccess.role,job_title:jobTitle,department:{id:created.id,name:departmentName}});
  const row=founder.page.locator('.team-directory-table tbody tr');await expect(row).toHaveCount(1);
  await expect(row.getByRole('rowheader',{name:original.name,exact:true})).toBeVisible();
  for(const text of [jobTitle,departmentName,'CGI Artist'])await expect(row.getByRole('cell',{name:text,exact:true})).toBeVisible();
  const access=await read(founder.context,'/auth/access/'+person.id);expect(access.role).toBe(originalAccess.role);expect(grants(access.grants)).toEqual(grants(originalAccess.grants));
  const persisted=await read(artist.context,'/team/profile');expect(persisted.name).toBe(original.name);expect(persisted.notifications).toEqual(original.notifications);
 }finally{
  try{
   if(original){
    // Each restoration uses the latest revision after the preceding save. Do
    // not overwrite names, inbox flags, roles or grants on this shared actor.
    let current=await read(artist.context,'/team/profile');
    if(current.job_title!==original.job_title){
     const restored=await save(artist.context,'/team/profile',{expectedRevision:current.revision,changes:{name:current.name,job_title:original.job_title}});
     expect(restored.status()).toBe(200);current=await restored.json();
    }
    if((current.department?.id||null)!==(original.department?.id||null)){
     const restored=await save(founder.context,'/team/members/'+person.id+'/department',{expectedRevision:current.revision,changes:{department_id:original.department?.id||null}});
     expect(restored.status()).toBe(200);
    }
    current=await read(artist.context,'/team/profile');expect(current.name).toBe(original.name);expect(current.job_title).toBe(original.job_title);expect(current.department).toEqual(original.department);expect(current.notifications).toEqual(original.notifications);
    if(originalAccess){const access=await read(founder.context,'/auth/access/'+person.id);expect(access.role).toBe(originalAccess.role);expect(grants(access.grants)).toEqual(grants(originalAccess.grants));}
   }
  }finally{
   try{
    if(attemptedCreate){
     const department=await uniqueDepartment();
     if(department){
      expect(department.name).toBe(departmentName);if(created)expect(department.id).toBe(created.id);
      if(!department.archived){const archived=await save(founder.context,'/team/departments/'+department.id,{expectedRevision:department.revision,changes:{name:departmentName,archived:true}});expect(archived.status()).toBe(200);expect((await archived.json()).archived).toBe(true);}
     }
    }
   }finally{await Promise.all([founder.context.close(),artist.context.close()]);}
  }
 }
});
