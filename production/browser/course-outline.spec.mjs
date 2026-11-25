import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {actor,profiles,mutate} from './support.mjs';

for(const width of [320,390,768])test(`course outline keeps readable modules and lesson context at ${width}px`,async({browser})=>{
 const fixture=await profiles(),learnerId=fixture.users.find(user=>user.key==='artist_1').id;
 const founder=await actor(browser,'founder'),{context,page}=await actor(browser,'artist_1',{viewport:{width,height:844}});
 let course,enrolled=false;
 const command=async(path,body,status=200,method='POST')=>{
  const response=await mutate(founder.context,path,body,method);
  expect(response.status(),'The isolated outline fixture must save through the real Academy API.').toBe(status);
  return response.json();
 };
 try{
  // Own the module fixture instead of assuming that the shared course contains
  // modules. Never rewrite its published lessons, enrollment or progress.
  course=await command('/academy/admin/courses',{title:'[QA] Module outline '+width+' '+randomUUID(),area:'3d',summary:'Isolated layout regression for a published module and two written lessons.'},201);
  const path='/academy/admin/courses/'+course.id,moduleTitle='Composition and camera placement';
  course=await command(path+'/modules',{expectedRevision:course.revision,title:moduleTitle});
  const moduleId=course.modules.find(module=>module.title===moduleTitle)?.id;
  expect(moduleId,'The saved course must contain the actual module.').toBeTruthy();
  for(const title of ['Read the architectural brief','Compose the first camera']){
   course=await command(path+'/lessons',{expectedRevision:course.revision,title,body:'Identify the architectural subject, set a clear camera and record the intended result before reviewing the image.'});
   const lessonId=course.lessons.find(lesson=>lesson.title===title)?.id;
   expect(lessonId).toBeTruthy();
   course=await command(path+'/assign-module',{expectedRevision:course.revision,lesson_id:lessonId,module_id:moduleId});
  }
  course=await command(path+'/publish',{expectedRevision:course.revision});
  expect(course.version).toBe(1);
  await command(path+'/enroll',{member_id:learnerId,course_version:course.version,mandatory:false});
  enrolled=true;
  const assignedResponse=await context.request.get('/api/courses/'+course.id);
  expect(assignedResponse.status()).toBe(200);
  const assigned=await assignedResponse.json();
  expect(assigned.lessons).toHaveLength(2);
  expect(assigned.lessons.every(lesson=>lesson.module_title===moduleTitle)).toBe(true);

  await page.goto('/workspace#academy');
  await page.locator('[data-action="course"][data-id="'+course.id+'"]').first().click();
  await expect(page.locator('.lesson-body h2')).toBeVisible();
  const outline=page.locator('.lesson-outline');
  if(await outline.count()&&!await outline.evaluate(node=>node.open))await outline.locator(':scope > summary').click();
  const modules=page.locator('.lesson-nav .lesson-module');
  expect(await modules.count(),'The published module must be rendered in the course outline.').toBe(1);
  for(const heading of await modules.all()){
   await expect(heading).toBeVisible();
   const box=await heading.evaluate(node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return {width:rect.width,height:rect.height,lineHeight:parseFloat(style.lineHeight),fontSize:parseFloat(style.fontSize),text:node.textContent.trim()};});
   expect(box.text).toBe(moduleTitle);
   expect(box.width,'A module heading must not shrink to a vertical strip.').toBeGreaterThanOrEqual(160);
   expect(box.height,'The synthetic module title must wrap into at most four normal lines.').toBeLessThanOrEqual(box.lineHeight*4+1);
   expect(box.fontSize).toBeGreaterThanOrEqual(12);
  }
  await page.locator('.lesson-nav [data-action="lesson"]').first().click();
  await expect(page.locator('.lesson-nav [data-action="lesson"]').first()).toHaveAttribute('aria-current','step');
  await expect(page.locator('.lesson-body h2')).toBeVisible();
  await expect(page.locator('.lesson-body h2')).toBeFocused();
  await expect(page.locator('.lesson-body > .eyebrow')).toContainText('Lesson 1');
  expect(await page.locator('.lesson-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'The lesson itself must not conceal internal horizontal overflow.').toBe(true);
 }finally{
  try{
   if(course?.id){
    const path='/academy/admin/courses/'+course.id;
    if(enrolled)await command(path+'/revoke',{member_id:learnerId});
    const saved=await founder.context.request.get('/api'+path);
    expect(saved.status()).toBe(200);
    const current=await saved.json();
    await command(path,{expectedRevision:current.revision,archived:true},200,'PATCH');
   }
  }finally{await Promise.all([context.close(),founder.context.close()]);}
 }
});
