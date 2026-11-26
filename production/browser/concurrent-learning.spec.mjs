import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {actor,profiles,mutate} from './support.mjs';

test('eight managed learners retain independent progress through simultaneous repeated completion and reload',async({browser})=>{
 test.setTimeout(120000);
 const fixture=await profiles();expect(fixture.users).toHaveLength(8);
 const people=await Promise.all(fixture.users.map(async user=>({...await actor(browser,user.key),user})));
 const founder=people.find(person=>person.user.role==='founder'),assigned=[];let course;
 const save=async(path,body,expected=200,method='POST')=>{
  const response=await mutate(founder.context,path,body,method);expect(response.status()).toBe(expected);return response.json();
 };
 const read=async person=>{
  const response=await person.context.request.get('/api/courses/'+course.id);expect(response.status()).toBe(200);return response.json();
 };
 try{
  course=await save('/academy/admin/courses',{title:'[QA] Concurrent learning '+randomUUID(),area:'3d',summary:'A private, disposable course for eight actual managed identities.'},201);
  const path='/academy/admin/courses/'+course.id;
  for(const title of ['Read the production brief','Check the final image'])course=await save(path+'/lessons',{expectedRevision:course.revision,title,body:'Read the brief, check the intended result and confirm the work meets the studio standard.'});
  course=await save(path+'/publish',{expectedRevision:course.revision});expect(course.version).toBe(1);
  for(const person of people){await save(path+'/enroll',{member_id:person.user.id,course_version:1,mandatory:true});assigned.push(person.user.id);}
  const initial=await Promise.all(people.map(read));
  expect(initial.every(value=>value.completed===0&&value.total===2&&value.version===1&&value.completion===null)).toBe(true);
  const first=initial[0].lessons[0].id,last=initial[0].lessons[1].id;
  expect(initial.every(value=>value.lessons[0].id===first&&value.lessons[1].id===last)).toBe(true);
  // Three overlapping requests per person exercise provider-level serialization
  // and idempotent progress. These are distinct sessions, not one mocked user.
  await Promise.all(people.flatMap(person=>Array.from({length:3},async()=>{
   expect((await mutate(person.context,'/lessons/'+first+'/complete',{})).status()).toBe(200);
  })));
  const partial=await Promise.all(people.map(read));
  expect(partial.every(value=>value.completed===1&&value.completion===null&&value.lessons[0].completed_at&&!value.lessons[1].completed_at)).toBe(true);
  await Promise.all(people.flatMap(person=>Array.from({length:2},async()=>{
   expect((await mutate(person.context,'/lessons/'+last+'/complete',{})).status()).toBe(200);
  })));
  const complete=await Promise.all(people.map(read));
  complete.forEach((value,index)=>{
   expect(value.completed).toBe(2);expect(value.completion.member_id).toBe(people[index].user.id);
   expect(value.completion.course_id).toBe(course.id);expect(value.completion.course_version).toBe(1);
   expect(value.completion.basis).toBe('self_reported');expect(value.completion.completed_at).toBeTruthy();
  });
  expect(new Set(complete.map(value=>value.completion.member_id)).size).toBe(8);
  // Reload the real rendered reader for all eight identities concurrently.
  await Promise.all(people.map(async person=>{
   await person.page.goto('/workspace#academy');
   await person.page.locator('[data-action="course"][data-id="'+course.id+'"]').first().click();
   await expect(person.page.locator('.lesson-nav [data-action="lesson"] small')).toHaveText(['Completed','Completed']);
   await expect(person.page.getByText('Course completed. Your completion record has been saved.',{exact:true})).toBeVisible();
  }));
  const changed=people.findIndex(person=>person.user.key==='artist_1');expect(changed).toBeGreaterThanOrEqual(0);
  const reopened=await mutate(people[changed].context,'/lessons/'+first+'/progress',{completed:false,course_id:course.id,course_version:1});expect(reopened.status()).toBe(200);
  const after=await Promise.all(people.map(read));
  after.forEach((value,index)=>{
   expect(value.completed).toBe(index===changed?1:2);
   if(index===changed)expect(value.completion).toBeNull();else expect(value.completion).toEqual(complete[index].completion);
  });
  expect((await mutate(people[changed].context,'/lessons/'+first+'/complete',{})).status()).toBe(200);
  expect((await read(people[changed])).completion).toEqual(complete[changed].completion);
 }finally{
  try{
   if(course?.id){
    const path='/academy/admin/courses/'+course.id;
    for(const id of assigned)await save(path+'/revoke',{member_id:id});
    const response=await founder.context.request.get('/api'+path);expect(response.status()).toBe(200);const current=await response.json();
    await save(path,{expectedRevision:current.revision,archived:true},200,'PATCH');
   }
  }finally{await Promise.all(people.map(person=>person.context.close()));}
 }
});
