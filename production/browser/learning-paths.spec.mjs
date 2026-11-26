import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {actor,profiles,mutate,origin} from './support.mjs';

// Native managed sessions, browser forms and the disposable local Academy API.
// All authored text is synthetic; no routes, authorization or responses are mocked.
async function fixture(browser,label){
 const data=await profiles(),provider=new URL(data.origin),application=new URL(origin);
 if(!['localhost','127.0.0.1'].includes(provider.hostname)||provider.port!=='54321'||!['localhost','127.0.0.1'].includes(application.hostname)||application.port!=='3100')throw Error('Learning path QA requires the disposable loopback application and provider.');
 const founder=await actor(browser,'founder'),learner=await actor(browser,'artist_1'),member=data.users.find(user=>user.key==='artist_1'),marker='[QA] '+label+' '+randomUUID(),courseIds=[],pathIds=[];
 expect(member?.id,'The disposable learner must exist.').toBeTruthy();
 async function read(path,run=founder){const response=await run.context.request.get('/api'+path);expect(response.status(),'The native Academy read must succeed.').toBe(200);return response.json();}
 async function command(path,body,status=200,method='POST'){const response=await mutate(founder.context,path,body,method);expect(response.status(),'The synthetic Academy fixture must save through its native API.').toBe(status);return response.json();}
 async function course(label){
  let saved=await command('/academy/admin/courses',{title:marker+' / '+label,area:'3d',summary:'Synthetic browser verification only.'},201);courseIds.push(saved.id);
  const body='Synthetic written lesson for '+label+'. Record the sample result for this browser test.';
  saved=await command('/academy/admin/courses/'+saved.id+'/lessons',{expectedRevision:saved.revision,title:'Synthetic '+label+' lesson',body});
  saved=await command('/academy/admin/courses/'+saved.id+'/publish',{expectedRevision:saved.revision});
  expect(saved.version).toBe(1);expect(saved.lessons).toHaveLength(1);expect(saved.publications).toHaveLength(1);
  return {...saved,syntheticBody:body};
 }
 async function publishAgain(saved){
  const body='Revised synthetic written lesson. This content belongs only to publication two.';
  saved=await command('/academy/admin/courses/'+saved.id+'/lessons',{expectedRevision:saved.revision,id:saved.lessons[0].id,title:saved.lessons[0].title,body});
  saved=await command('/academy/admin/courses/'+saved.id+'/publish',{expectedRevision:saved.revision});expect(saved.version).toBe(2);
  return {...saved,syntheticBody:body};
 }
 async function close(){
  try{
   for(const id of pathIds){
    const saved=await read('/academy/admin/paths/'+id);expect(saved.title.startsWith(marker+' / ')).toBe(true);expect(saved.assignment_next_offset).toBeNull();
    for(const assignment of saved.assignments){expect(assignment.member_id).toBe(member.id);await command('/academy/admin/paths/'+id+'/revoke',{command_key:randomUUID(),expectedRevision:saved.revision,assignment_id:assignment.id});}
    if(!saved.archived)await command('/academy/admin/paths/'+id+'/archive',{command_key:randomUUID(),expectedRevision:saved.revision,archived:true});
   }
   for(const id of courseIds){
    let saved=await read('/academy/admin/courses/'+id);expect(saved.title.startsWith(marker+' / ')).toBe(true);
    if(saved.enrollments.some(enrollment=>enrollment.member_id===member.id))saved=await command('/academy/admin/courses/'+id+'/revoke',{member_id:member.id});
    if(!saved.archived)await command('/academy/admin/courses/'+id,{expectedRevision:saved.revision,archived:true},200,'PATCH');
   }
  }finally{await Promise.all([founder.context.close(),learner.context.close()]);}
 }
 return {founder,learner,member,marker,pathIds,read,command,course,publishAgain,close};
}
function responseFor(page,path,method='GET'){return page.waitForResponse(response=>new URL(response.url()).pathname==='/api'+path&&response.request().method()===method);}
const publication=(course,version)=>{const saved=course.publications.find(item=>item.version===version);expect(saved,'The fixture must contain the requested immutable publication.').toBeTruthy();return saved.id;};
async function openPaths(page,manage=false){
 await page.goto('/workspace#academy');await page.getByRole('button',{name:'Paths',exact:true}).click();await expect(page.locator('.learning-paths')).toBeVisible();
 if(manage){await page.getByRole('button',{name:'Manage paths',exact:true}).click();await expect(page.getByRole('button',{name:'New path',exact:true})).toBeVisible();}
}
async function refreshPaths(page,pathId){
 const refreshed=responseFor(page,pathId?'/academy/admin/paths/'+pathId:'/academy/paths'),refresh=page.locator('.learning-paths').getByRole('button',{name:'Refresh',exact:true});
 await refresh.click();expect((await refreshed).status()).toBe(200);await expect(refresh).toBeEnabled();
}
async function addCourse(page,course,publicationId){
 const dialog=page.getByRole('dialog'),choice=dialog.getByLabel('Published course',{exact:true});
 // Five catalog pages at most. Never turn a regression into an unbounded scan
 // or assume this file owns the first page of the shared synthetic catalog.
 for(let pageIndex=0;pageIndex<5;pageIndex++){
  if(await choice.locator('option[value="'+course.id+'"]').count()){
   await choice.selectOption(course.id);await dialog.getByRole('button',{name:'Add course',exact:true}).click();
   await dialog.getByLabel('Publication for '+course.title,{exact:true}).selectOption(publicationId);return;
  }
  if(pageIndex===4)throw Error('The synthetic course was not found within five bounded catalog pages.');
  const more=dialog.getByRole('button',{name:'Load more course choices',exact:true});await expect(more,'The native catalog must expose a continuation for the synthetic course.').toHaveCount(1);
  const loaded=responseFor(page,'/academy/admin/path-courses');await more.click();expect((await loaded).status()).toBe(200);
  await expect(dialog.locator('[data-path-action="more-editor-catalog"]:disabled')).toHaveCount(0);
 }
}
async function savePath(run,title,id){
 const page=run.founder.page,dialog=page.getByRole('dialog'),saved=responseFor(page,id?'/academy/admin/paths/'+id:'/academy/admin/paths',id?'PATCH':'POST');
 await dialog.getByRole('button',{name:'Save path',exact:true}).click();const response=await saved;expect(response.status()).toBe(id?200:201);const result=await response.json();
 if(!id)run.pathIds.push(result.id);
 await expect(dialog).not.toBeVisible();await expect(page.locator('.learning-paths').getByRole('heading',{name:title,exact:true})).toBeVisible();return run.read('/academy/admin/paths/'+result.id);
}
async function assignForm(run,path){
 const page=run.founder.page;await page.locator('.path-actions').getByRole('button',{name:'Assign path',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByText('Assign revision '+path.revision+', with 2 exact course publications.',{exact:false})).toBeVisible();
 await dialog.getByLabel('Studio member',{exact:true}).selectOption(run.member.id);await dialog.getByLabel('Required learning',{exact:true}).check();return dialog;
}
const assignedPath=(page,title)=>page.locator('.path-assigned').filter({has:page.getByRole('heading',{name:title,exact:true})});

test('native path assignment keeps publication, order and completed progress after later publication and path edits',async({browser})=>{
 test.setTimeout(90000);let run,first,second,path,assignmentId,completedSnapshot;
 try{
  await test.step('Author two isolated written publications through the native Academy API',async()=>{
   run=await fixture(browser,'Path snapshots');first=await run.course('First course');second=await run.course('Second course');
  });
  await test.step('Create and reorder a path through the Founder interface',async()=>{
   const page=run.founder.page;await openPaths(page,true);await page.getByRole('button',{name:'New path',exact:true}).click();
   const dialog=page.getByRole('dialog'),title=run.marker+' / Original path';await dialog.getByLabel('Path title',{exact:true}).fill(title);await dialog.getByLabel('Learning outcome',{exact:true}).fill('Complete two synthetic written courses in the reviewed order.');await dialog.getByLabel('Onboarding',{exact:true}).check();
   await addCourse(page,first,publication(first,1));await addCourse(page,second,publication(second,1));
   await dialog.locator('.path-course-list > li').nth(1).getByRole('button',{name:'Move up',exact:true}).click();await expect(dialog.locator('.path-course-list h4')).toHaveText([second.title,first.title]);
   path=await savePath(run,title);expect(path.courses.map(item=>[item.course_id,item.publication_id,item.position])).toEqual([[second.id,publication(second,1),1],[first.id,publication(first,1),2]]);expect(path.topics).toEqual(['onboarding']);
  });
  await test.step('Assign the saved path revision through the Founder interface',async()=>{
   const page=run.founder.page,dialog=await assignForm(run,path),assigned=responseFor(page,'/academy/admin/paths/'+path.id+'/assign','POST');await dialog.getByRole('button',{name:'Assign path',exact:true}).click();
   const response=await assigned;expect(response.status()).toBe(200);assignmentId=(await response.json()).assignment_id;expect(assignmentId).toBeTruthy();await expect(dialog).not.toBeVisible();
   const saved=await run.read('/academy/admin/paths/'+path.id);expect(saved.assignment_total).toBe(1);expect(saved.assignments[0]).toMatchObject({id:assignmentId,member_id:run.member.id,path_revision:path.revision,mandatory:true});
   for(const course of [first,second])expect((await run.read('/academy/admin/courses/'+course.id)).enrollments).toEqual([expect.objectContaining({member_id:run.member.id,course_version:1,mandatory:true})]);
  });
  await test.step('Open the exact publication and complete its lesson through the learner interface',async()=>{
   const page=run.learner.page;await openPaths(page);const card=assignedPath(page,path.title);await expect(card).toHaveCount(1);await expect(card.locator('.path-course-list h4')).toHaveText([second.title,first.title]);await expect(card.locator('.path-progress-label')).toHaveText('0 / 2 courses · 0 / 2 lessons');
   const start=card.locator('[data-action="course"][data-id="'+second.id+'"]');await expect(start).toHaveAttribute('data-publication',publication(second,1));const opened=responseFor(page,'/courses/'+second.id);await start.click();const response=await opened;expect(response.status()).toBe(200);const course=await response.json();expect(course).toMatchObject({publication_id:publication(second,1),version:1,completed:0});expect(course.lessons).toHaveLength(1);
   await expect(page.locator('.lesson-body .prose')).toHaveText(second.syntheticBody);const completed=responseFor(page,'/lessons/'+course.lessons[0].id+'/complete','POST');await page.getByRole('button',{name:'Complete lesson',exact:true}).click();expect((await completed).status()).toBe(200);await expect(page.getByText('Course completed. Your completion record has been saved.',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Return to courses',exact:true}).click();await expect(card.locator('.path-progress-label')).toHaveText('1 / 2 courses · 1 / 2 lessons');await expect(card.getByRole('progressbar',{name:path.title+' course progress',exact:true})).toHaveAttribute('value','1');
   completedSnapshot=await run.read('/academy/paths/'+assignmentId,run.learner);expect(completedSnapshot.courses[0]).toMatchObject({course_id:second.id,publication_id:publication(second,1),access_status:'available',completed:1,total:1,completion:{basis:'self_reported'}});expect(completedSnapshot.courses[1]).toMatchObject({course_id:first.id,completed:0,completion:null});
  });
  await test.step('Publish new course content and edit the current path through the Founder interface',async()=>{
   const revised=await run.publishAgain(second),page=run.founder.page;await refreshPaths(page,path.id);await page.getByRole('button',{name:'Edit path',exact:true}).click();
   const dialog=page.getByRole('dialog'),title=run.marker+' / Revised path';await dialog.getByLabel('Path title',{exact:true}).fill(title);await dialog.getByLabel('Learning outcome',{exact:true}).fill('A revised synthetic path for future learners.');await dialog.getByLabel('Publication for '+second.title,{exact:true}).selectOption(publication(revised,2));await dialog.locator('.path-course-list > li').first().getByRole('button',{name:'Move down',exact:true}).click();await expect(dialog.locator('.path-course-list h4')).toHaveText([first.title,second.title]);
   const saved=await savePath(run,title,path.id);expect(saved.revision).toBe(path.revision+1);expect(saved.courses.map(item=>[item.course_id,item.publication_id])).toEqual([[first.id,publication(first,1)],[second.id,publication(revised,2)]]);expect(saved.assignments[0].id).toBe(assignmentId);
  });
  await test.step('Refresh the original learner snapshot and retain its exact publication and progress',async()=>{
   const page=run.learner.page;await refreshPaths(page);const card=assignedPath(page,path.title);await expect(card.locator('.path-progress-label')).toHaveText('1 / 2 courses · 1 / 2 lessons');await expect(card.locator('.eyebrow')).toHaveText('Required path · Revision '+path.revision);await expect(card.locator('.path-course-list h4')).toHaveText([second.title,first.title]);await expect(assignedPath(page,run.marker+' / Revised path')).toHaveCount(0);
   expect(await run.read('/academy/paths/'+assignmentId,run.learner)).toEqual(completedSnapshot);
   const opened=responseFor(page,'/courses/'+second.id);await card.locator('[data-action="course"][data-id="'+second.id+'"]').click();const response=await opened;expect(response.status()).toBe(200);const course=await response.json();expect(course).toMatchObject({publication_id:publication(second,1),version:1,completed:1,completion:{basis:'self_reported'}});await expect(page.locator('.lesson-body .prose')).toHaveText(second.syntheticBody);
  });
 }finally{await run?.close();}
});

test('native path assignment conflict retains an existing publication and creates no other enrollment or path snapshot',async({browser})=>{
 test.setTimeout(60000);let run,existing,other,path,originalEnrollment,otherBefore,learnerPathTotal;
 try{
  await test.step('Keep an active first publication while authoring a second publication',async()=>{
   run=await fixture(browser,'Path conflict');existing=await run.course('Existing enrollment');other=await run.course('Unassigned course');await run.command('/academy/admin/courses/'+existing.id+'/enroll',{member_id:run.member.id,course_version:1,mandatory:false});
   originalEnrollment=await run.read('/courses/'+existing.id,run.learner);expect(originalEnrollment.publication_id).toBe(publication(existing,1));existing=await run.publishAgain(existing);otherBefore=await run.read('/academy/admin/courses/'+other.id);expect(otherBefore.enrollments).toEqual([]);learnerPathTotal=(await run.read('/academy/paths',run.learner)).total;
  });
  await test.step('Create a path that pins the conflicting publication and a separate unassigned course',async()=>{
   const page=run.founder.page;await openPaths(page,true);await page.getByRole('button',{name:'New path',exact:true}).click();const dialog=page.getByRole('dialog'),title=run.marker+' / Conflicting path';await dialog.getByLabel('Path title',{exact:true}).fill(title);await dialog.getByLabel('Learning outcome',{exact:true}).fill('Synthetic all-or-nothing enrollment verification.');
   await addCourse(page,other,publication(other,1));await addCourse(page,existing,publication(existing,2));path=await savePath(run,title);expect(path.courses.map(item=>[item.course_id,item.version])).toEqual([[other.id,1],[existing.id,2]]);expect(path.assignment_total).toBe(0);
  });
  await test.step('Reject the Founder assignment with a native conflict and preserve the submitted form',async()=>{
   const page=run.founder.page,dialog=await assignForm(run,path),assigned=responseFor(page,'/academy/admin/paths/'+path.id+'/assign','POST');await dialog.getByRole('button',{name:'Assign path',exact:true}).click();expect((await assigned).status()).toBe(409);
   await expect(dialog).toBeVisible();await expect(dialog.getByRole('alert')).toContainText('different course publication');await expect(dialog.getByRole('button',{name:'Reload saved records',exact:true})).toBeVisible();await expect(dialog.getByLabel('Studio member',{exact:true})).toHaveValue(run.member.id);await expect(dialog.getByLabel('Required learning',{exact:true})).toBeChecked();await expect(dialog.getByRole('button',{name:'Assign path',exact:true})).toBeEnabled();await expect(page.locator('.path-learners .path-assigned')).toHaveCount(0);
  });
  await test.step('Verify atomic failure through current native enrollment and path records',async()=>{
   const saved=await run.read('/academy/admin/paths/'+path.id);expect(saved.assignment_total).toBe(0);expect(saved.assignments).toEqual([]);expect(saved.events.filter(event=>event.kind==='assign')).toEqual([]);
   expect(await run.read('/courses/'+existing.id,run.learner)).toEqual(originalEnrollment);const current=await run.read('/academy/admin/courses/'+existing.id);expect(current.enrollments).toEqual([expect.objectContaining({member_id:run.member.id,course_version:1,mandatory:false})]);
   const untouched=await run.read('/academy/admin/courses/'+other.id);expect(untouched.enrollments).toEqual([]);expect(untouched.events).toEqual(otherBefore.events);expect((await run.learner.context.request.get('/api/courses/'+other.id)).status()).toBe(404);expect((await run.read('/academy/paths',run.learner)).total).toBe(learnerPathTotal);
  });
 }finally{await run?.close();}
});
