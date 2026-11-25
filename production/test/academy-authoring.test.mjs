import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

// Actual authoring and video controllers, with a bounded DOM/HTTP boundary.
// These checks cover workflow/draft behavior, not native layout or accessibility.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fixture=id=>({id,title:'Studio lighting '+id,area:'3d',summary:'A clear learning outcome.',revision:7,archived:false,version:1,publication_status:'draft',
 modules:[{id:'module-one',title:'The lighting method',position:1,lesson_count:2}],
 lessons:[{id:'lesson-one',title:'Set the camera',body:'First lesson working body.',position:1,module_id:'module-one'},{id:'lesson-two',title:'Balance the light',body:'Second lesson working body.',position:2,module_id:'module-one'}],
 videos:[{id:'video-one',title:'First lesson video',lesson_id:'lesson-one',status:'ready',size:1024},{id:'video-two',title:'Second lesson video',lesson_id:'lesson-two',status:'ready',size:2048}],
 resources:[{id:'resource-shared',title:'Shared standard',body:'Course reference',lesson_id:null},{id:'resource-one',title:'Camera checklist',body:'Camera reference',lesson_id:'lesson-one'},{id:'resource-two',title:'Light checklist',body:'Light reference',lesson_id:'lesson-two'}],
 publications:[{version:1,title:'Published lighting course',published_at:'2026-11-24T12:00:00Z'}],
 enrollments:[{member_id:'artist',name:'Studio Artist',course_version:1,mandatory:true}],
 assignments:[{id:'assignment-one',title:'A daylight study',instructions:'Describe the intended result.',course_version:1,submissions:[{id:'response-one',name:'Studio Artist',status:'submitted',body:'Original artist response.',revision:1,submitted_at:'2026-11-24T12:00:00Z',feedback:'',history:[]}]}],
 completion_records:[{name:'Studio Artist',course_version:1,basis:'self_reported',completed_at:'2026-11-24T12:00:00Z'}]});

async function harness(){
 const listeners={},courses=new Map([['course-one',fixture('course-one')],['course-two',fixture('course-two')]]),calls=[],messages=[];let modal='',views=0,changes=0,hold=null;
 const document={querySelector(){return null;},querySelectorAll(){return [];},addEventListener(type,listener){(listeners[type]??=[]).push(listener);}};
 class FormData{constructor(form){this.values=Object.entries(form.values||{});}[Symbol.iterator](){return this.values[Symbol.iterator]();}}
 const context=vm.createContext({document,FormData,Intl,Date,Map,Set,JSON,String,Number,encodeURIComponent});
 const {createAcademyAdmin}=await loadBrowserModule(context,'academy-admin.js');
 const module=createAcademyAdmin({request:async(path,method='GET',body)=>{
  calls.push({path,method,body:structuredClone(body)});
  if(path==='/bootstrap')return {members:[{id:'artist',name:'Studio Artist'}]};
  if(path==='/academy/admin/courses')return [...courses.values()].map(course=>({...structuredClone(course),lesson_count:course.lessons.length,enrollment_count:course.enrollments.length}));
  const match=/^\/academy\/admin\/courses\/(course-one|course-two)(?:\/(lessons))?$/.exec(path);assert(match,'Unexpected request '+path);let course=courses.get(match[1]);
  if(method==='PATCH'){
   if(body.expectedRevision!==course.revision)throw Object.assign(new Error('Course changed elsewhere.'),{status:409});
   const next={...course,...body,revision:course.revision+1};delete next.expectedRevision;if(hold)await new Promise(resolve=>hold.resolve=resolve);courses.set(course.id,next);return structuredClone(next);
  }
  if(method==='POST'&&match[2]==='lessons'){
   assert.equal(body.expectedRevision,course.revision);course={...course,revision:course.revision+1,lessons:[...course.lessons,{id:'lesson-new',title:body.title,body:body.body,position:course.lessons.length+1,module_id:null}]};courses.set(course.id,course);return structuredClone(course);
  }
  return structuredClone(course);
 },openDialog(title,html){modal=html;},toast:message=>messages.push(message),onChange:async()=>{changes++;},onViewChange:()=>{views++;}});
 const button=()=>({disabled:false,isConnected:true,setAttribute(){},removeAttribute(){}});
 const emit=async(type,target,extra={})=>{for(const listener of listeners[type]||[])listener({target,preventDefault(){},...extra});await tick();};
 async function action(name,dataset={}){const element={...button(),dataset:{academyAction:name,...dataset},closest(selector){return selector==='[data-academy-action]'?this:null;}};await emit('click',element);}
 async function videoAction(name,dataset={}){const element={...button(),dataset:{videoAction:name,...dataset},closest(selector){return selector==='[data-video-action]'?this:null;}};await emit('click',element);}
 function form(type,values,dataset={}){const error={innerHTML:'',replaceChildren(){this.innerHTML='';},focus(){}},submit=button();return {dataset:{academyForm:type,...dataset},values,error,submit,matches:()=>true,querySelector:selector=>selector==='.form-error'?error:submit};}
 function metadata(values={}){const course=courses.get('course-one'),base={title:course.title,area:course.area,summary:course.summary};return form('metadata',{...base,...values},{course:course.id,revision:String(course.revision),base:JSON.stringify(base)});}
 async function edit(form,values){Object.assign(form.values,values);await emit('input',{closest:selector=>selector==='[data-academy-form="metadata"]'?form:null});}
 async function submit(form){await emit('submit',form,{submitter:form.submit});}
 await module.load();await action('open',{course:'course-one'});
 return {module,courses,calls,messages,action,videoAction,form,metadata,edit,submit,get modal(){return modal;},get views(){return views;},get changes(){return changes;},holdSave(){hold={};return {release:()=>hold.resolve()};}};
}
const activeView=(html,view)=>new RegExp('data-academy-action="authoring-view" data-view="'+view+'" aria-pressed="true"').test(html);

test('course authoring opens a selected lesson instead of unrelated administration panels',async()=>{
 const h=await harness(),html=h.module.render();assert(activeView(html,'lessons'));assert(html.includes('Course outline'));assert(html.includes('First lesson working body.'));assert(!html.includes('Second lesson working body.'));
 assert(html.includes('First lesson video'));assert(!html.includes('Second lesson video'));assert(html.includes('Camera checklist'));assert(!html.includes('Light checklist'));assert(html.includes('Shared standard'));
 assert(!html.includes('data-academy-form="metadata"'));assert(!html.includes('Original artist response.'));assert(!html.includes('Assign learner'));assert(!html.includes('Completion history ('));
 for(const [view,label] of [['lessons','Lessons'],['details','Course details'],['practical','Practical work'],['publish','Publish & people']])assert(html.includes('data-view="'+view+'"'),label+' remains available');
});

test('selecting another lesson switches its text, video and resources locally without any server reads',async()=>{
 const h=await harness(),requests=h.calls.length,changes=h.changes;await h.action('select-lesson',{lesson:'lesson-two'});const html=h.module.render();
 assert.equal(h.calls.length,requests);assert.equal(h.changes,changes);assert.equal(h.views,1);assert(html.includes('Second lesson working body.'));assert(!html.includes('First lesson working body.'));
 assert(html.includes('Second lesson video'));assert(!html.includes('First lesson video'));assert(html.includes('Light checklist'));assert(!html.includes('Camera checklist'));assert(html.includes('Shared standard'));
 assert(html.includes('data-video-action="new" data-lesson="lesson-two"'));assert(html.includes('data-academy-action="new-resource" data-lesson="lesson-two"'));
});

test('lesson-specific video and resource creation default to the selected lesson',async()=>{
 const h=await harness();await h.action('select-lesson',{lesson:'lesson-two'});await h.videoAction('new',{lesson:'lesson-two'});
 assert(h.modal.includes('<option value="lesson-two" selected>'));assert(!h.modal.includes('<option value="lesson-one" selected>'));
 await h.action('new-resource',{lesson:'lesson-two'});assert(h.modal.includes('<option value="lesson-two" selected>'));assert(h.modal.includes('name="lesson_id"'));
});

test('details, practical work and publishing expose their intended actions without a long combined editor',async()=>{
 const h=await harness(),requests=h.calls.length;
 await h.action('authoring-view',{view:'details'});let html=h.module.render();assert(activeView(html,'details'));assert(html.includes('data-academy-form="metadata"'));assert(html.includes('Archive course'));assert(!html.includes('First lesson working body.'));assert(!html.includes('Original artist response.'));
 await h.action('authoring-view',{view:'practical'});html=h.module.render();assert(activeView(html,'practical'));assert(html.includes('Original artist response.'));assert(html.includes('Review response'));assert(!html.includes('data-academy-form="metadata"'));assert(!html.includes('Assign learner'));
 await h.action('authoring-view',{view:'publish'});html=h.module.render();assert(activeView(html,'publish'));assert(html.includes('Review and publish'));assert(html.includes('Assign learner'));assert(html.includes('Completion history (1)'));assert(html.includes('Publication history (1)'));assert(!html.includes('First lesson working body.'));assert(!html.includes('Original artist response.'));assert.equal(h.calls.length,requests);
});

test('unsaved details survive local views and block publication without adopting a newer server revision',async()=>{
 const h=await harness();await h.action('authoring-view',{view:'details'});const form=h.metadata();await h.edit(form,{title:'Unsaved lesson series'});
 await h.action('authoring-view',{view:'lessons'});assert(h.module.render().includes('Your course details have unsaved changes.'));assert(h.module.hasUnsavedChanges());
 await h.action('authoring-view',{view:'publish'});let html=h.module.render();assert(/data-academy-action="publish" disabled/.test(html));assert(html.includes('Review and save the details you changed.'));
 h.courses.set('course-one',{...h.courses.get('course-one'),revision:10,title:'Another editor’s title'});await h.module.load();await h.action('authoring-view',{view:'details'});html=h.module.render();assert(html.includes('value="Unsaved lesson series"'));assert(html.includes('data-revision="7"'));assert(html.includes('saved course changed'));
 await h.submit(form);assert(form.error.innerHTML.includes('changed elsewhere'));assert(h.module.hasUnsavedChanges());
});

test('publication readiness blocks pending video, missing module assignments and empty courses',async()=>{
 const h=await harness();h.courses.set('course-one',{...h.courses.get('course-one'),videos:[{id:'pending',title:'Pending upload',status:'pending',lesson_id:'lesson-one',size:10}]});await h.module.load();await h.action('authoring-view',{view:'publish'});let html=h.module.render();assert(/data-academy-action="publish" disabled/.test(html));assert(html.includes('Verify or remove pending uploads'));
 let course=h.courses.get('course-one');h.courses.set(course.id,{...course,videos:[],lessons:course.lessons.map(lesson=>({...lesson,module_id:null}))});await h.module.load();html=h.module.render();assert(/data-academy-action="publish" disabled/.test(html));assert(html.includes('Choose a module for each lesson.'));
 course=h.courses.get('course-one');h.courses.set(course.id,{...course,lessons:[]});await h.module.load();html=h.module.render();assert(/data-academy-action="publish" disabled/.test(html));assert(html.includes('Add the first lesson in Lessons.'));
});

test('opening editor views never mutates published versions, assignments, enrollment or completion records',async()=>{
 const h=await harness(),before=structuredClone(h.courses.get('course-one'));for(const view of ['details','publish','practical','lessons'])await h.action('authoring-view',{view});await h.action('select-lesson',{lesson:'lesson-two'});assert.deepEqual(h.courses.get('course-one'),before);assert(h.calls.every(call=>call.method==='GET'));
});

test('saving a new lesson selects it in the outline and keeps published records intact',async()=>{
 const h=await harness(),before=structuredClone(h.courses.get('course-one')),form=h.form('lesson',{title:'A new review step',body:'New lesson working body.'},{lesson:'',revision:String(before.revision)});await h.submit(form);await tick();const html=h.module.render();assert(html.includes('New lesson working body.'));assert(!html.includes('First lesson working body.'));assert(html.includes('data-lesson="lesson-new" class="active" aria-current="true"'));
 const saved=h.courses.get('course-one');assert.deepEqual(saved.publications,before.publications);assert.deepEqual(saved.enrollments,before.enrollments);assert.deepEqual(saved.completion_records,before.completion_records);
});

test('in-flight saves prevent navigation that could replace the active course while retaining its draft',async()=>{
 const h=await harness();await h.action('authoring-view',{view:'details'});const form=h.metadata();await h.edit(form,{summary:'Saved deliberately'});const held=h.holdSave();await h.submit(form);
 await h.action('authoring-view',{view:'lessons'});await h.action('back');await h.action('open',{course:'course-two'});assert(activeView(h.module.render(),'details'));assert(h.module.render().includes('Studio lighting course-one'));assert.equal(h.messages.filter(message=>message.includes('Wait for the current save')).length,3);
 held.release();await tick();await tick();assert.equal(h.courses.get('course-one').summary,'Saved deliberately');assert(!h.module.hasUnsavedChanges());
});

test('invalid local navigation is rejected and reset removes the prior editor selection',async()=>{
 const h=await harness(),requests=h.calls.length;await h.action('authoring-view',{view:'untrusted-view'});await h.action('select-lesson',{lesson:'foreign-lesson'});assert.equal(h.calls.length,requests);assert(activeView(h.module.render(),'lessons'));assert(h.messages.some(message=>message.includes('valid course editor view')));assert(h.messages.some(message=>message.includes('no longer available')));
 await h.action('authoring-view',{view:'practical'});h.module.reset();await h.module.load();await h.action('open',{course:'course-one'});assert(activeView(h.module.render(),'lessons'));
});
