import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

const topics=[{code:'interior',title:'Interior'},{code:'exterior',title:'Exterior'},{code:'onboarding',title:'Onboarding'}];
const course=id=>({id,title:'Course '+id,area:'3d',revision:3,topics:['interior'],publication_status:'published',publications:[{id:'publication-'+id,version:1,title:'Published '+id}]});
const assigned=()=>({id:'assigned-one',path_id:'path-one',title:'Assigned studio method',summary:'An ordered set of actual courses.',path_revision:2,topics:['onboarding'],mandatory:true,member_name:'Synthetic learner',courses:[{course_id:'one',publication_id:'publication-one',title:'Published one',position:1,version:1,access_status:'available',total:2,completed:1,completion:null},{course_id:'two',publication_id:'publication-two',title:'Published two',position:2,version:1,access_status:'enrollment_changed',total:2,completed:0,completion:null}]});
const initialPath=()=>({id:'path-one',title:'Studio method',summary:'A considered learning sequence.',revision:2,topics:['onboarding'],archived:false,courses:[{course_id:'one',publication_id:'publication-one',version:1,title:'Published one',position:1}],assignments:[assigned()],assignment_total:1,assignment_next_offset:null});

async function eventually(predicate){const end=Date.now()+2000;while(!predicate()){if(Date.now()>end)throw new Error('Controller did not finish its pending work');await new Promise(resolve=>setImmediate(resolve));}}
async function harness({founder=true}={}){
 const listeners={},calls=[],messages=[],catalog=[course('one'),course('two')],paths=new Map([['path-one',initialPath()]]),commands=new Map();let modal='',views=0,changes=0,loseNext=false,forceConflict=false,held=null,role=founder;
 const document={addEventListener(type,listener){(listeners[type]??=[]).push(listener);},querySelector(){return {close(){modal='';}};}};
 class FormData{constructor(form){this.values=Object.entries(form.values||{}).flatMap(([name,value])=>Array.isArray(value)?value.map(item=>[name,item]):[[name,value]]);}get(name){return this.values.find(([key])=>key===name)?.[1]??null;}getAll(name){return this.values.filter(([key])=>key===name).map(([,value])=>value);}}
 const context=vm.createContext({document,FormData,crypto:{randomUUID},Intl,Date,Map,Set,JSON,String,Number,encodeURIComponent,confirm:()=>true});
 const {createLearningPaths,pathProgress}=await loadBrowserModule(context,'learning-paths.js');
 const module=createLearningPaths({getContext:()=>({founder:role,members:[{id:'learner',name:'Synthetic learner',sections:['academy']},{id:'restricted',name:'Restricted member',sections:['projects']}]}),openDialog(title,html){modal=html;},toast:message=>messages.push(message),onViewChange:()=>{views++;},onChange:()=>{changes++;},request:async(url,method='GET',body)=>{
  calls.push({url,method,body:structuredClone(body)});if(held&&url===held.url){const hold=held;held=null;await hold.promise;}
  if(url==='/academy/topics')return {topics:structuredClone(topics),course_topics:{one:['interior'],two:['exterior']}};
  if(url==='/academy/paths')return {items:[assigned()],total:1,next_offset:null};
  if(url==='/academy/admin/path-courses')return {items:structuredClone(catalog),total:catalog.length,next_offset:null};
  if(url==='/academy/admin/path-courses/one/publications?page_size=20&offset=20')return {items:[{id:'publication-earlier-one',version:1,title:'Earlier one'}],total:21,next_offset:null};
  if(url==='/academy/admin/paths'&&method==='GET')return {items:[...paths.values()].map(p=>({...structuredClone(p),course_count:p.courses.length,assignment_count:p.assignments.length})),total:paths.size,next_offset:null};
  const match=/^\/academy\/admin\/paths\/([^/]+)(?:\/(assign|revoke|archive))?$/.exec(url);
  if(match&&method==='GET')return structuredClone(paths.get(match[1]));
  if(method!=='GET'){
   if(forceConflict)throw Object.assign(new Error('The saved path changed elsewhere.'),{status:409});
   if(commands.has(body.command_key))return structuredClone(commands.get(body.command_key));
   const id=match?.[1]||body.id,old=paths.get(id);let result;
   if(url.startsWith('/academy/admin/course-topics/')){result={id:url.split('/').at(-1),revision:4};}
   else if(match?.[2]==='assign'){result={id,assignment_id:'assigned-new',revision:old.revision};}
   else if(match?.[2]==='archive'){old.archived=body.archived;old.revision++;result={id,revision:old.revision};}
   else{const p={...initialPath(),...body,id,revision:old?old.revision+1:1,courses:body.courses.map((item,index)=>({...item,title:catalog.find(c=>c.id===item.course_id)?.title||'Course',position:index+1,version:1}))};delete p.command_key;paths.set(id,p);result={id,revision:p.revision};}
   commands.set(body.command_key,result);if(loseNext){loseNext=false;throw Object.assign(new Error('Connection interrupted after saving.'),{status:503});}return structuredClone(result);
  }
  throw new Error('Unexpected controller request '+url);
 }});
 function form(kind,values={},dataset={}){const error={innerHTML:'',focus(){}},submit={disabled:false,isConnected:true},form={dataset:{pathForm:kind,...dataset},values,error,submit,setAttribute(){},removeAttribute(){},querySelector:selector=>selector==='.form-error'?error:submit,querySelectorAll:()=>[]};return form;}
 async function click(action,dataset={},form=null){const element={dataset:{pathAction:action,...dataset},disabled:false,isConnected:true,closest:selector=>selector==='[data-path-action]'?element:selector==='form[data-path-form]'?form:null};for(const listener of listeners.click||[])listener({target:element,preventDefault(){}});await eventually(()=>!module.isSaving());}
 async function submit(form){for(const listener of listeners.submit||[])listener({target:form,submitter:form.submit,preventDefault(){}});await eventually(()=>!module.isSaving());}
 function input(form){for(const listener of listeners.input||[])listener({target:{closest:()=>form}});}
 function hold(url){let release;const promise=new Promise(resolve=>release=resolve);held={url,promise};return {release};}
 await module.load();return {module,pathProgress,calls,messages,paths,catalog,form,click,submit,input,hold,setRole(value){role=value;},loseReply(){loseNext=true;},conflict(value=true){forceConflict=value;},get modal(){return modal;},get views(){return views;},get changes(){return changes;},context};
}

test('assigned path rows display real version/access states and never turn missing completion records into course credit',async()=>{
 const h=await harness({founder:false}),html=h.module.render();assert(html.includes('Assigned studio method'));assert(html.includes('Revision 2'));assert(html.includes('0 / 2 courses · 1 / 4 lessons'));assert(html.includes('Different publication assigned'));assert(!html.includes('data-path-action="new"'));assert(!html.includes('data-id="two"'));assert(html.includes('data-id="one" data-publication="publication-one"'));
 const p=assigned();p.courses[0].completed=2;assert.equal(h.pathProgress(p).complete,0);p.courses[0].completion={basis:'self_reported'};assert.equal(h.pathProgress(p).complete,1);p.courses[0].access_status='enrollment_missing';assert.equal(h.pathProgress(p).complete,0);assert.equal(h.pathProgress({...p,courses:[]}).finished,false);
});

test('path editor preserves typed metadata while adding/reordering exact publication choices',async()=>{
 const h=await harness();await h.click('open',{id:'path-one'});await h.click('edit');const form=h.form('editor',{title:'A typed title',summary:'A retained learning outcome',topics:['interior'],publication_0:'publication-one',course_choice:'two'});h.input(form);assert.equal(h.module.hasUnsavedChanges(),true);
 await h.click('add-course',{},form);assert(h.modal.includes('value="A typed title"'));assert(h.modal.includes('A retained learning outcome'));assert(h.modal.includes('value="publication-two" selected'));assert(h.modal.includes('data-index="1" data-step="-1"'));
 const reordered=h.form('editor',{title:'A typed title',summary:'A retained learning outcome',topics:['interior'],publication_0:'publication-one',publication_1:'publication-two'});await h.click('move',{index:'1',step:'-1'},reordered);
 await h.submit(h.form('editor',{title:'A typed title',summary:'A retained learning outcome',topics:['interior'],publication_0:'publication-two',publication_1:'publication-one'}));
 const write=h.calls.find(c=>c.method==='PATCH'&&c.url==='/academy/admin/paths/path-one');assert.deepEqual(write.body.courses,[{course_id:'two',publication_id:'publication-two'},{course_id:'one',publication_id:'publication-one'}]);assert.equal(write.body.expectedRevision,2);assert.equal(h.module.hasUnsavedChanges(),false);
});

test('lost-response retry reuses its command key and applies one path edit',async()=>{
 const h=await harness();await h.click('open',{id:'path-one'});await h.click('edit');const form=h.form('editor',{title:'Saved through retry',summary:'Still my draft',topics:['onboarding'],publication_0:'publication-one'});h.loseReply();await h.submit(form);assert(form.error.innerHTML.includes('Connection interrupted'));assert.equal(h.module.hasUnsavedChanges(),true);assert.equal(h.paths.get('path-one').revision,3);
 await h.submit(form);const writes=h.calls.filter(c=>c.method==='PATCH');assert.equal(writes.length,2);assert.equal(writes[0].body.command_key,writes[1].body.command_key);assert.equal(h.paths.get('path-one').revision,3);assert.equal(h.module.hasUnsavedChanges(),false);
});

test('conflicting saves keep the local draft and require an explicit saved-record reload',async()=>{
 const h=await harness();await h.click('open',{id:'path-one'});await h.click('edit');const before=h.calls.length,form=h.form('editor',{title:'My retained draft',summary:'Do not discard',topics:['onboarding'],publication_0:'publication-one'});h.conflict();await h.submit(form);assert(form.error.innerHTML.includes('Reload saved records'));assert.equal(h.module.hasUnsavedChanges(),true);assert.equal(h.calls.length,before+1);assert.equal(h.paths.get('path-one').title,'Studio method');
 h.conflict(false);await h.click('reload-saved',{},form);assert.equal(h.module.hasUnsavedChanges(),false);assert(h.module.render().includes('Studio method'));
});

test('assignment choices follow current grants and use exact saved path revision',async()=>{
 const h=await harness();await h.click('open',{id:'path-one'});await h.click('assign');assert(h.modal.includes('Synthetic learner'));assert(!h.modal.includes('Restricted member'));assert(h.modal.includes('revision 2'));
 await h.submit(h.form('assign',{member_id:'learner',mandatory:'on'}));const write=h.calls.find(c=>c.url.endsWith('/assign'));assert.equal(write.body.expectedRevision,2);assert.equal(write.body.member_id,'learner');assert.equal(write.body.mandatory,true);assert.equal(h.changes,1);
});

test('course subject editing makes an explicit working-copy change and keeps the native course publisher',async()=>{
 const h=await harness();await h.click('mode',{mode:'subjects'});await h.click('classify',{id:'one'});assert(h.modal.includes('Publish the course'));await h.submit(h.form('classify',{topics:['exterior','onboarding']}));const write=h.calls.find(c=>c.url==='/academy/admin/course-topics/one');assert.equal(write.method,'PATCH');assert.equal(write.body.expectedRevision,3);assert.deepEqual(write.body.topics,['exterior','onboarding']);assert(!h.calls.some(c=>c.url.endsWith('/publish')));
});

test('library subjects filter assigned publications independently of legacy learning areas',async()=>{
 const h=await harness({founder:false});const {renderLearning}=await loadBrowserModule(h.context,'learning.js');await h.click('filter-topic',{topic:'exterior'});const html=renderLearning({courses:[{id:'one',title:'Interior course',summary:'',area:'3d',completed:0,total:1},{id:'two',title:'Exterior course',summary:'',area:'3d',completed:0,total:1}],area:'3d',areas:{sales:'Sales','3d':'3D',post_production:'Post-production'},...h.module.libraryState()});
 const cards=html.slice(html.indexOf('class="cards learning-cards"'));assert(cards.includes('Exterior course'));assert(!cards.includes('Interior course'));assert(html.includes('data-topic="exterior" aria-pressed="true"'));assert(html.includes('data-action="area" data-value="3d"'));
});

test('account reset rejects stale path replies and removes Founder authoring views',async()=>{
 const h=await harness(),held=h.hold('/academy/paths'),loading=h.module.load();h.module.reset();h.setRole(false);held.release();await assert.rejects(loading,/account changed/);const html=h.module.render();assert(html.includes('Loading learning paths'));assert(!html.includes('Studio method'));assert.equal(h.module.hasUnsavedChanges(),false);
});

test('loading earlier publication choices retains unsaved path metadata and the exact current selection',async()=>{
 const h=await harness();h.catalog[0].older_publications=true;h.catalog[0].publication_next_offset=20;h.catalog[0].publications[0].version=21;await h.module.load();await h.click('open',{id:'path-one'});await h.click('edit');assert(h.modal.includes('Load earlier publications'));
 const form=h.form('editor',{title:'Keep this draft',summary:'A typed outcome',topics:['interior'],publication_0:'publication-one'});await h.click('more-publications',{id:'one'},form);assert(h.modal.includes('value="Keep this draft"'));assert(h.modal.includes('value="publication-one" selected'));assert(h.modal.includes('value="publication-earlier-one"'));assert(!h.modal.includes('Load earlier publications'));assert.equal(h.module.hasUnsavedChanges(),true);
});

test('pending path writes disable editable controls and prevent changing the active authoring view',async()=>{
 const h=await harness();await h.click('open',{id:'path-one'});await h.click('edit');const form=h.form('editor',{title:'Saving now',summary:'A stable submitted draft',topics:[],publication_0:'publication-one'}),control={disabled:false,isConnected:true};form.querySelectorAll=()=>[control];const held=h.hold('/academy/admin/paths/path-one'),saving=h.submit(form);assert.equal(control.disabled,true);const switching=h.click('mode',{mode:'subjects'});assert(h.messages.includes('This Academy view is still loading or saving.'));held.release();await Promise.all([saving,switching]);assert.equal(control.disabled,false);assert(h.module.render().includes('Saving now'));assert(!h.module.render().includes('<h2>Course subjects</h2>'));
});
