import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

const settle=async()=>{for(let count=0;count<12;count++)await new Promise(setImmediate);};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const image=(extra={})=>({id:'image-one',code:'INT-01',title:'Living room',stage:'Draft production',artist_id:'artist-one',version:2,render_id:'render-one',number:1,file_name:'issued.png',byte_size:1024,...extra});
const choices=(items=[image(),image({id:'image-two',code:'EXT-02',title:'Courtyard',version:4,render_id:'render-two'})])=>({items,total:items.length,page:1,hasMore:false});
const page=(items=[],scope='studio')=>({items,total:items.length,page:1,hasMore:false,scope});
const round=(body={})=>({id:'round-one',project_id:'project-one',number:1,title:body.title||'Saved revision round',brief:body.brief||'Shared round brief',due_date:body.due_date||'2026-12-12',status:'open',version:1,created_at:'2026-11-25T12:00:00Z',items:(body.items||[{deliverable_id:'image-one',render_id:'render-one',instruction:'Retain the agreed light.'}]).map((item,index)=>({...item,code:index?'EXT-02':'INT-01',title:index?'Courtyard':'Living room',task_id:'task-'+(index+1),task_status:'Todo',task_version:1,owner_id:'artist-one'}))});
const delivery=(body={})=>({id:'delivery-one',project_id:'project-one',review_request_id:'review-one',number:1,title:body.title||'Final files',message:body.message||'Download the originals.',status:'issued',version:1,created_at:'2026-11-25T12:00:00Z',manifest:[{item_id:'issued-one',deliverable_id:'image-one',render_id:'render-one',code:'INT-01',title:'Living room',version:1,file_name:'issued.png',byte_size:1024}],recipients:[{user_id:'client-one',name:'Invited client',active:true}]});

async function harness(intercept){
 const listeners={},calls=[],dialogs=[],messages=[],renders=[];let actor={id:'founder-one',role:'founder'},project={id:'project-one',title:'Courtyard',archived:false},route='revisions',allowed=true,body={isConnected:true},form=null;
 const emit=(type,target)=>{for(const listener of listeners[type]||[])listener({target,preventDefault(){}});};
 const detachForm=()=>{if(form){form.isConnected=false;for(const control of form.controls)control.isConnected=false;}form=null;};
 const dialog={id:'dialog',open:false,querySelector(selector){return selector==='.dialog-body'?body:null;},querySelectorAll(){return form?.controls||[];},close(){this.open=false;emit('close',this);}};
 const document={addEventListener(type,listener){(listeners[type]??=[]).push(listener);},querySelector(selector){return selector==='#dialog'?dialog:selector==='#dialog .dialog-body'?body:null;}};
 const environment=vm.createContext({document,Intl,Date,URLSearchParams,crypto:{randomUUID},confirm:()=>true});
 const {createProjectDelivery}=await loadBrowserModule(environment,'project-delivery.js');
 const controller=createProjectDelivery({request:async(url,method,requestBody,headers)=>{
  calls.push({url,method:method||'GET',body:structuredClone(requestBody),headers:structuredClone(headers)});const result=await intercept?.(url,method,requestBody,headers);if(result!==undefined)return result;
  if(url.includes('/round-images?'))return choices();if(url.includes('/clients?'))return {items:[{user_id:'client-one',name:'Invited client',email:'client@fixture.invalid',active:true},{user_id:'inactive-client',name:'Revoked client',email:'revoked@fixture.invalid',active:false}],page:1,hasMore:false};
  if(method==='POST'&&url.endsWith('/revisions'))return round(requestBody);if(method==='POST'&&url.endsWith('/deliveries'))return delivery(requestBody);
  if(!method&&url.startsWith('/revision-rounds/'))return round();if(!method&&url.startsWith('/final-deliveries/'))return delivery();
  if(!method&&/\/(revisions|deliveries)\?/.test(url))return page([],actor.role==='founder'?'studio':'assigned');throw Error('Unexpected delivery test endpoint.');
 },openDialog(title,html){detachForm();body.isConnected=false;body={isConnected:true};dialog.open=true;dialogs.push({title,html});},getData:()=>({actor,members:[{id:'artist-one',name:'Assigned artist'}]}),getProject:()=>project,contextKey:()=>route,canLeave:()=>allowed,render(){renders.push(controller.render());},toast(message){messages.push(message);}});
 const click=(action,data={},targetForm=form)=>{const control={dataset:{deliveryAction:action,...data},disabled:false,closest(selector){return selector==='form'?targetForm:selector==='[data-delivery-action]'?this:null;}};emit('click',control);return control;};
 return {controller,calls,dialogs,messages,renders,dialog,emit,click,actor(value){actor=value;},project(value){project=value;},route(value){route=value;},allow(value){allowed=value;},
  form(values={}){const fields={title:'My revision round',brief:'Keep the agreed camera.',message:'The final originals.',due_date:'2026-12-12',image_search:'',...values},error={textContent:'',innerHTML:''},elements=Object.fromEntries(Object.entries(fields).map(([name,value])=>[name,{name,value,disabled:false,isConnected:true,type:'text'}])),controls=[...Object.values(elements),{type:'submit',disabled:false,isConnected:true},{type:'button',disabled:false,isConnected:true}];form={dataset:{deliveryForm:'issue'},elements,controls,error,isConnected:true,querySelector(selector){return selector==='.form-error'?error:null;},querySelectorAll(selector){return selector==='input,textarea,select'?controls.filter(control=>!['submit','button'].includes(control.type)):controls;}};return form;},
  choose(id,checked=true,targetForm=form){emit('change',{value:id,checked,form:targetForm,matches:selector=>selector==='[data-round-image]'});},
  recipient(id,checked=true){emit('change',{value:id,checked,matches:selector=>selector==='[data-delivery-client]'});},
  instruction(id,value,targetForm=form){const name='instruction_'+id,control=targetForm?.elements[name]||{name,disabled:false,isConnected:true,type:'textarea',dataset:{roundInstruction:id},closest:selector=>selector==='[data-delivery-form]'?targetForm:null};control.value=value;if(targetForm&&!targetForm.elements[name]){targetForm.elements[name]=control;targetForm.controls.push(control);}emit('input',control);},
  async submit(targetForm=form){emit('submit',targetForm);await settle();},
 };
}
async function begin(h,{final=false,selected=['image-one'],values={}}={}){await h.controller.load(final?'delivery':'revisions');h.click('create');await settle();let form=h.form(values);for(const id of selected){h.choose(id,true,form);form=h.form(values);}return form;}
const writes=h=>h.calls.filter(call=>call.method==='POST');

test('per-image selections and instructions reach one real controller request without losing earlier text on rerender',async()=>{
 const h=await harness(),values={title:'Round <daylight>',brief:'Keep the camera & composition'},first=await begin(h,{values});h.instruction('image-one','Warm oak <retain>',first);h.choose('image-two',true,first);const form=h.form(values);h.instruction('image-two','Soften the courtyard light.',form);
 assert(h.dialogs.at(-1).html.includes('Warm oak &lt;retain&gt;'));assert.equal(h.controller.hasUnsavedChanges(),true);await h.submit(form);assert.equal(writes(h).length,1);assert.deepEqual(writes(h)[0].body,{title:values.title,brief:values.brief,due_date:'2026-12-12',items:[{deliverable_id:'image-one',render_id:'render-one',expected_version:2,instruction:'Warm oak <retain>'},{deliverable_id:'image-two',render_id:'render-two',expected_version:4,instruction:'Soften the courtyard light.'}]});
 assert(h.dialogs.at(-1).html.includes('data-action="open-task" data-id="task-1"'));assert(!h.dialogs.at(-1).title.includes('&lt;'));assert.equal(h.controller.hasUnsavedChanges(),false);
});

test('pending writes and their list refresh freeze the captured form and suppress duplicate submissions',async()=>{
 const post=deferred(),refresh=deferred();let acknowledged=false;const h=await harness(async(url,method,body)=>{if(method==='POST'){await post.promise;acknowledged=true;return round(body);}if(acknowledged&&url.includes('/revisions?'))return refresh.promise;});
 const form=await begin(h);h.instruction('image-one','Captured instruction',form);h.emit('submit',form);await settle();assert.equal(h.controller.isSaving(),true);assert(form.controls.every(control=>control.disabled));form.elements.title.value='Later field value';h.instruction('image-one','A later unsubmitted instruction',form);h.emit('submit',form);h.click('create');h.controller.discardUnsavedChanges();await settle();assert.equal(writes(h).length,1);assert.equal(writes(h)[0].body.title,'My revision round');assert.equal(writes(h)[0].body.items[0].instruction,'Captured instruction');
 post.resolve();await settle();assert.equal(h.controller.isSaving(),true);assert(form.controls.every(control=>control.disabled));assert.equal(h.controller.hasUnsavedChanges(),false);h.emit('submit',form);await settle();assert.equal(writes(h).length,1);refresh.resolve(page());await settle();assert.equal(h.controller.isSaving(),false);assert(h.dialogs.at(-1).html.includes('Captured instruction'));
});

test('a conflict retains entered instructions until explicit image reload clears selection and adopts the new version',async()=>{
 let attempts=0,current=2;const h=await harness(async(url,method,body)=>{if(url.includes('/round-images?'))return choices([image({version:current,render_id:current===2?'render-one':'render-new'})]);if(method==='POST'&&++attempts===1)throw Object.assign(Error('Image changed elsewhere. Reload current versions.'),{status:409});if(method==='POST')return round(body);});
 const values={title:'Retained round title'},form=await begin(h,{values});h.instruction('image-one','Retained correction',form);await h.submit(form);assert(form.error.innerHTML.includes('Reload current image versions'));assert.equal(form.elements.title.value,values.title);assert.equal(h.controller.hasUnsavedChanges(),true);assert(form.controls.every(control=>!control.disabled));assert.equal(h.calls.filter(call=>call.url.includes('/round-images?')).length,1);
 current=3;h.click('refresh-images',{},form);await settle();assert(h.dialogs.at(-1).html.includes('Current versions loaded.'));assert(!h.dialogs.at(-1).html.includes('data-round-image checked'));let latest=h.form(values);h.choose('image-one',true,latest);latest=h.form(values);assert(h.dialogs.at(-1).html.includes('Retained correction'));await h.submit(latest);assert.equal(writes(h).length,2);assert.equal(writes(h)[1].body.items[0].expected_version,3);assert.equal(writes(h)[1].body.items[0].render_id,'render-new');assert.equal(writes(h)[1].body.items[0].instruction,'Retained correction');assert.notEqual(writes(h)[0].headers['Idempotency-Key'],writes(h)[1].headers['Idempotency-Key']);
});

test('an ambiguous write keeps the exact original body and request identity for retry',async()=>{
 let attempt=0;const h=await harness(async(url,method,body)=>{if(method==='POST'&&++attempt===1)throw Object.assign(Error('Acknowledgement lost'),{status:503});if(method==='POST')return round(body);}),form=await begin(h);h.instruction('image-one','The original correction',form);await h.submit(form);assert(form.error.innerHTML.includes('exact retry'));assert(form.querySelectorAll('input,textarea,select').every(control=>control.disabled));assert.equal(h.controller.hasUnsavedChanges(),true);
 form.elements.title.value='A later unconfirmed title';h.instruction('image-one','A later unconfirmed correction',form);await h.submit(form);assert.equal(writes(h).length,2);assert.deepEqual(writes(h)[1],writes(h)[0]);assert.equal(h.controller.isSaving(),false);assert.equal(h.controller.hasUnsavedChanges(),false);assert(h.dialogs.at(-1).html.includes('The original correction'));
});

for(const changed of ['actor','project','route'])test('a late image chooser cannot open under a changed '+changed+' context',async()=>{
 const gate=deferred(),h=await harness(url=>url.includes('/round-images?')?gate.promise:undefined);await h.controller.load();h.click('create');await settle();if(changed==='actor')h.actor({id:'other-founder',role:'founder'});if(changed==='project'){h.project({id:'project-two',title:'Current project'});await h.controller.load();}if(changed==='route')h.route('another-route');gate.resolve(choices([image({title:'PRIVATE old chooser'})]));await settle();assert.equal(h.dialogs.length,0);assert.equal(h.controller.hasUnsavedChanges(),false);assert(!h.controller.render().includes('PRIVATE old chooser'));
});

test('a late acknowledged write cannot display old project instructions in a later project',async()=>{
 const gate=deferred(),h=await harness((url,method)=>method==='POST'?gate.promise:undefined),form=await begin(h);h.instruction('image-one','PRIVATE earlier project correction',form);h.emit('submit',form);await settle();h.project({id:'project-two',title:'Current project'});h.route('project-two/revisions');await h.controller.load();const count=h.dialogs.length;gate.resolve(round({title:'PRIVATE earlier round',items:[{deliverable_id:'image-one',render_id:'render-one',instruction:'PRIVATE earlier project correction'}]}));await settle();assert.equal(h.dialogs.length,count);assert.equal(h.messages.length,0);assert.equal(h.controller.isSaving(),false);assert.equal(h.controller.hasUnsavedChanges(),false);assert(!h.controller.render().includes('PRIVATE earlier'));
});

test('assigned artists see readonly round instructions linked to the same central task and cannot close a round',async()=>{
 const record=round({title:'Shared round',items:[{deliverable_id:'image-one',render_id:'render-one',instruction:'Retain <approved> direction'}]}),h=await harness(url=>url.includes('/revisions?')?page([{id:record.id,title:record.title,number:1,created_at:record.created_at,items:1,resolved:0,status:'open'}],'assigned'):url==='/revision-rounds/'+record.id?record:undefined);h.actor({id:'artist-one',role:'artist'});await h.controller.load();assert(h.controller.render().includes('your assigned work'));assert(!h.controller.render().includes('data-delivery-action="create"'));h.click('open',{id:record.id});await settle();const html=h.dialogs.at(-1).html;assert(html.includes('Retain &lt;approved&gt; direction'));assert(html.includes('data-action="open-task" data-id="task-1"'));assert(!html.includes('data-delivery-action="close"'));h.click('close',{id:record.id,version:'1'});await settle();assert.equal(writes(h).length,0);
});

test('final issuance uses only selected current images and active invited recipients',async()=>{
 const h=await harness(),form=await begin(h,{final:true,values:{title:'Exact final files'}});assert(h.dialogs.at(-1).html.includes('Invited client'));assert(!h.dialogs.at(-1).html.includes('Revoked client'));h.recipient('client-one');assert.equal(h.controller.hasUnsavedChanges(),true);await h.submit(form);assert.equal(writes(h).length,1);assert.equal(writes(h)[0].url,'/projects/project-one/deliveries');assert.deepEqual(writes(h)[0].body,{title:'Exact final files',message:'The final originals.',recipients:['client-one'],items:[{deliverable_id:'image-one',render_id:'render-one',expected_version:2}]});assert(h.dialogs.at(-1).html.includes('/api/final-deliveries/delivery-one/manifest'));assert(h.dialogs.at(-1).html.includes('Download original'));assert.equal(h.controller.hasUnsavedChanges(),false);
});

test('an acknowledged creation remains reviewable when refreshing the surrounding list fails',async()=>{
 let acknowledged=false;const h=await harness((url,method,body)=>{if(method==='POST'){acknowledged=true;return round(body);}if(acknowledged&&url.includes('/revisions?'))throw Object.assign(Error('List temporarily unavailable'),{status:503});}),form=await begin(h);h.instruction('image-one','Acknowledged saved correction',form);await h.submit(form);assert.equal(writes(h).length,1);assert.equal(h.controller.isSaving(),false);assert.equal(h.controller.hasUnsavedChanges(),false);assert(h.dialogs.at(-1).html.includes('data-action="open-task" data-id="task-1"'),'The returned saved record must remain reviewable even if its list cannot refresh');assert(h.dialogs.at(-1).html.includes('Acknowledged saved correction'));
});

test('an access-denied refresh cannot reopen the acknowledged record after its project authorization changes',async()=>{
 let acknowledged=false;const h=await harness((url,method,body)=>{if(method==='POST'){acknowledged=true;return round(body);}if(acknowledged&&url.includes('/revisions?'))throw Object.assign(Error('Project access revoked'),{status:403});}),form=await begin(h);h.instruction('image-one','PRIVATE revoked instruction',form);await h.submit(form);assert.equal(writes(h).length,1);assert.equal(h.controller.isSaving(),false);assert.equal(h.controller.hasUnsavedChanges(),false);assert(!h.dialogs.some(dialog=>dialog.html.includes('project-round-detail')));assert(!h.controller.render().includes('PRIVATE revoked instruction'));
});
