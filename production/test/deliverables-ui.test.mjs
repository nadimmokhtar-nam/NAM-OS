import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

const item=(extra={})=>({id:'image-one',project_id:'project-one',code:'INT-01',title:'Living room hero',kind:'still',stage:'Camera approval',artist_id:'artist',due_date:'2030-01-01',camera_notes:'Keep the agreed eye level.',version:1,archived:false,can_manage:true,can_edit:true,tasks:[],task_total:0,history:[],...extra});
const page=items=>({items,total:items.length,page:1,hasMore:false});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function settle(){for(let i=0;i<15;i++)await new Promise(setImmediate);}
async function fixture(request=async path=>path.startsWith('/deliverables/')?item():page([item()])){
 const calls=[],listeners={},dialogs=[],messages=[],changes=[];let route='images',allowed=true,form=null;
 const data={actor:{id:'founder',role:'founder'},members:[{id:'artist',name:'Assigned artist'}],capabilities:{createTaskSections:['projects']}},project={id:'project-one',title:'Shared project',archived:false};
 const dialog={open:false,close(){this.open=false;},querySelector(){return form;}};
 const document={querySelector:()=>dialog,addEventListener(type,listener){(listeners[type]??=[]).push(listener);}};
 const context=vm.createContext({document,URLSearchParams,Intl,Date,crypto:globalThis.crypto,FormData:class{constructor(node){this.values=node.values;}*[Symbol.iterator](){yield*Object.entries(this.values);}get(key){return this.values[key];}}});
 const {createProjectDeliverables}=await loadBrowserModule(context,'deliverables.js');
 const ui=createProjectDeliverables({request:async(...args)=>{calls.push(args);return request(...args);},openDialog(title,html,options){dialogs.push({title,html,options});dialog.open=true;},getData:()=>data,getProject:()=>project,render(){changes.push('render');},toast:message=>messages.push(message),ownerChoices:async()=>[['artist','Assigned artist']],canLeave:()=>allowed,onBusy(){changes.push('busy');},contextKey:()=>route,onCreateTask:record=>changes.push(record),onOpenTask:id=>changes.push(id)});
 const h={ui,data,project,calls,dialogs,messages,changes,dialog,route:value=>route=value,allow:value=>allowed=value,
  async click(action,id){for(const listener of listeners.click||[])listener({preventDefault(){},target:{closest:()=>({dataset:{deliverableAction:action,id}})}});await settle();},
  makeForm(values,mode='edit'){
   const error={textContent:'',innerHTML:''},submit={disabled:false},field={disabled:false},attributes={};
   form={values,dataset:{deliverableForm:mode,id:'image-one',version:'1',project:'project-one'},elements:[field,submit],isConnected:true,matches:selector=>selector==='[data-deliverable-form]',querySelector:selector=>selector==='.form-error'?error:submit,setAttribute(k,v){attributes[k]=v;},removeAttribute(k){delete attributes[k];}};
   return {form,error,submit,field,attributes};
  },async submit(form){for(const listener of listeners.submit||[])listener({target:form,preventDefault(){}});await settle();}
 };return h;
}

test('the inventory renders actual camera identities, escaped metadata and complete server totals',async()=>{
 const h=await fixture(async()=>({...page([item({title:'<script>Private direction</script>'})]),total:150,hasMore:true}));await h.ui.load();
 const html=h.ui.render();assert(html.includes('data-id="image-one"'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('1 of 150 matching deliverables'));assert(html.includes('Load more'));assert(html.includes('Camera approval'));assert(!html.includes('<img'));
});

test('stale inventory and detail requests cannot overwrite a later route or identity',async()=>{
 const held=deferred(),h=await fixture(()=>held.promise),reading=h.ui.load();h.route('work');held.resolve(page([item()]));await reading;assert.equal(h.ui.getState().items.length,0);
 const detail=deferred(),other=await fixture(()=>detail.promise),opening=other.ui.open('image-one');other.data.actor.id='different-user';detail.resolve(item());await opening;assert.equal(other.dialogs.length,0);
});

test('a reset invalidates an earlier project read and clears filters and content',async()=>{
 const held=deferred(),h=await fixture(()=>held.promise),reading=h.ui.load();h.ui.reset();h.project.id='project-two';held.resolve(page([item()]));await reading;assert.equal(h.ui.getState().projectId,'');assert.equal(h.ui.getState().items.length,0);
});

test('read-only collaborators cannot see edit or archive controls and only receive their linked task metadata',async()=>{
 const h=await fixture(async()=>item({can_edit:false,can_manage:false,tasks:[{id:'own-task',title:'Assigned image work',status:'Todo',due_date:null}],task_total:1}));h.data.actor.role='artist';await h.ui.open('image-one');
 const html=h.dialogs[0].html;assert(!html.includes('data-deliverable-form'));assert(!html.includes('data-deliverable-action="archive"'));assert(html.includes('1 of 1 tasks shared with you'));assert(html.includes('Assigned image work'));assert(html.includes('Camera approval'));
});

test('save freezes fields and blocks duplicate submissions until the actual acknowledgement',async()=>{
 const held=deferred(),h=await fixture(async(path,method)=>method==='PATCH'?held.promise:path.startsWith('/deliverables/')?item():page([item()]));await h.ui.load();await h.ui.open('image-one');const f=h.makeForm({camera_notes:'New artist direction'});
 await h.submit(f.form);assert.equal(h.ui.isSaving(),true);assert.equal(f.field.disabled,true);assert.equal(f.attributes['aria-busy'],'true');await h.submit(f.form);assert.equal(h.calls.filter(([,method])=>method==='PATCH').length,1);
 held.resolve(item({version:2}));await settle();assert.equal(h.ui.isSaving(),false);assert.equal(f.field.disabled,false);assert.equal(h.dialog.open,false);assert(h.messages.includes('Deliverable saved'));
});

test('a conflict keeps the draft and offers explicit reload without changing its captured version',async()=>{
 const h=await fixture(async(path,method)=>{if(method==='PATCH')throw Object.assign(Error('Changed elsewhere'),{status:409});return item();});await h.ui.open('image-one');const f=h.makeForm({camera_notes:'My unsaved direction'});await h.submit(f.form);
 assert.equal(f.form.values.camera_notes,'My unsaved direction');assert.equal(f.form.dataset.version,'1');assert.equal(h.dialog.open,true);assert(f.error.innerHTML.includes('Reload latest'));assert.equal(f.field.disabled,false);h.allow(false);await h.click('reload');assert.equal(h.calls.length,2);
});

test('archive freezes the current draft while pending and preserves it when the server refuses the change',async()=>{
 const held=deferred(),h=await fixture(async(path,method)=>method==='PATCH'?held.promise:item());await h.ui.open('image-one');const f=h.makeForm({camera_notes:'Captured direction'});h.allow(false);await h.click('archive');assert.equal(h.calls.length,1);
 h.allow(true);await h.click('archive');assert.equal(h.ui.isSaving(),true);assert.equal(f.field.disabled,true);held.resolve(Promise.reject(Object.assign(Error('Archive changed elsewhere'),{status:409})));await settle();assert.equal(f.field.disabled,false);assert.equal(f.form.values.camera_notes,'Captured direction');assert.equal(h.dialog.open,true);assert(h.messages.includes('Archive changed elsewhere'));
});

test('task creation requires the draft guard and passes the actual linked deliverable identity',async()=>{
 const h=await fixture();await h.ui.open('image-one');const created=()=>h.changes.filter(change=>change&&typeof change==='object');h.allow(false);await h.click('create-task');assert.equal(created().length,0);h.allow(true);await h.click('create-task');assert.equal(created().length,1);assert.equal(created()[0].id,'image-one');assert.equal(created()[0].project_id,'project-one');
});
