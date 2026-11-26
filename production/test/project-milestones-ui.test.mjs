import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

const initial=()=>({id:'checkpoint-one',project_id:'project-one',title:'An agreed checkpoint',target_date:'2027-01-15',note:'A shared project note',status:'pending',version:1});
async function until(predicate){const end=Date.now()+2000;while(!predicate()){if(Date.now()>end)throw new Error('Milestone controller did not settle');await new Promise(resolve=>setImmediate(resolve));}}
async function harness({founder=true,pageSize=50}={}){
 const listeners={},calls=[],messages=[],rows=new Map([['checkpoint-one',initial()]]),commands=new Map();let modal='',renders=0,busy=0,loss=false,conflict=false,denied=false,historyMore=false,hold=null,view='milestones',project={id:'project-one',archived:false},actor={id:'actor-one',role:founder?'founder':'artist'},leavable=true,dialogBody={};
 const dialog={id:'dialog',open:false,close(){this.open=false;modal='';for(const listener of listeners.close||[])listener({target:this});},querySelector(selector){return selector==='.dialog-body'?dialogBody:null;},setAttribute(){}};
 const document={addEventListener(type,listener){(listeners[type]??=[]).push(listener);},querySelector(){return dialog;}};
 class FormData{constructor(form){this.values=Object.entries(form.values||{});}get(name){return this.values.find(([key])=>key===name)?.[1]??null;}}
 const context=vm.createContext({document,FormData,crypto:{randomUUID},URLSearchParams,Intl,Date,Map,Set,JSON,String,Number,encodeURIComponent});
 const {createProjectMilestones}=await loadBrowserModule(context,'project-milestones.js');
 const module=createProjectMilestones({getProject:()=>project,getData:()=>({actor}),contextKey:()=>view,onBusy:()=>busy++,openDialog(title,html){dialog.open=true;dialogBody={};modal=html;},render:()=>renders++,toast:message=>messages.push(message),canLeave:()=>leavable,request:async(url,method='GET',body,headers={})=>{
  calls.push({url,method,body:structuredClone(body),headers:{...headers}});if(hold&&hold.url===url&&hold.method===method){const held=hold;hold=null;await held.promise;}
  const parsed=new URL(url,'https://nam.invalid'),match=/^\/projects\/([^/]+)\/milestones(?:\/([^/]+))?$/.exec(parsed.pathname);assert(match,'Unexpected request '+url);
  if(method==='GET'&&denied)throw Object.assign(new Error('Project access was removed.'),{status:404});
  if(method==='GET'&&match[2]){const row=rows.get(match[2]);return {...structuredClone(row),can_manage:actor.role==='founder'&&!project.archived,events:[{id:parsed.searchParams.has('offset')?0:1,version:1,before_state:null,after_state:structuredClone(row),created_at:'2026-11-25T12:00:00Z'}],event_total:historyMore?51:1,event_next_offset:historyMore&&!parsed.searchParams.has('offset')?50:null};}
  if(method==='GET'){
   let items=[...rows.values()].filter(row=>row.project_id===match[1]),status=parsed.searchParams.get('status'),search=parsed.searchParams.get('search'),from=parsed.searchParams.get('from'),to=parsed.searchParams.get('to');if(status)items=items.filter(row=>row.status===status);if(search)items=items.filter(row=>(row.title+' '+row.note).toLowerCase().includes(search.toLowerCase()));if(from)items=items.filter(row=>row.target_date>=from);if(to)items=items.filter(row=>row.target_date<=to);items.sort((a,b)=>a.target_date.localeCompare(b.target_date)||a.title.localeCompare(b.title));const total=items.length,offset=Number(parsed.searchParams.get('offset')||0);return {project_id:match[1],project_archived:project.archived,items:structuredClone(items.slice(offset,offset+pageSize)),total,next_offset:offset+pageSize<total?offset+pageSize:null,can_manage:actor.role==='founder'&&!project.archived,today:'2027-01-16'};
  }
  if(conflict)throw Object.assign(new Error('The checkpoint changed elsewhere.'),{status:409});const key=headers['Idempotency-Key'];assert(key);if(commands.has(key))return structuredClone(commands.get(key));const old=rows.get(match[2]),row={...(old||initial()),id:old?.id||'checkpoint-new',project_id:match[1],...body.changes,version:old?old.version+1:1};rows.set(row.id,row);commands.set(key,structuredClone(row));if(loss){loss=false;throw Object.assign(new Error('Connection interrupted after saving.'),{status:503});}return structuredClone(row);
 }});
 function form(kind,values={},dataset={}){const error={innerHTML:'',focus(){}},controls=[{disabled:false,isConnected:true}];return {dataset:{milestoneForm:kind,...dataset},values,error,controls,isConnected:true,setAttribute(){},removeAttribute(){},querySelector:selector=>selector==='.form-error'?error:controls[0],querySelectorAll:()=>controls};}
 async function click(action,dataset={}){const start=calls.length,control={dataset:{milestoneAction:action,...dataset},closest:selector=>selector==='[data-milestone-action]'?control:null};for(const listener of listeners.click||[])listener({target:control,preventDefault(){}});await until(()=>!module.isSaving()&&calls.length>=start);await new Promise(resolve=>setImmediate(resolve));}
 async function submit(form){for(const listener of listeners.submit||[])listener({target:form,preventDefault(){}});await until(()=>!module.isSaving());await new Promise(resolve=>setImmediate(resolve));}
 function input(form){for(const listener of listeners.input||[])listener({target:{closest:()=>form}});}
 function holdRequest(url,method='GET'){let release;const promise=new Promise(resolve=>release=resolve);hold={url,method,promise};return {release};}
 await module.load();return {module,rows,calls,messages,form,click,submit,input,holdRequest,closeDialog:()=>dialog.close(),replaceDialog(){dialog.open=true;dialogBody={};modal='Another dialog';},setView(value){view=value;},setProject(value){project=value;},setActor(value){actor=value;},setCanLeave(value){leavable=value;},loseResponse(){loss=true;},forceConflict(value=true){conflict=value;},denyReads(){denied=true;},historyContinuation(){historyMore=true;},get modal(){return modal;},get renders(){return renders;},get busy(){return busy;}};
}

test('participants read real checkpoint dates and shared notes without Founder controls or invented rows',async()=>{
 const h=await harness({founder:false}),html=h.module.render();assert(html.includes('An agreed checkpoint'));assert(html.includes('datetime="2027-01-15"'));assert(html.includes('A shared project note'));assert(html.includes('Overdue'));assert(!html.includes('Add milestone'));assert.equal(h.module.markers().items.length,1);
 await h.click('open',{id:'checkpoint-one'});assert(h.modal.includes('A shared project note'));assert(!h.modal.includes('Edit milestone'));assert(!h.modal.includes('History'));
});

test('a new milestone requires an explicit date and records exactly the typed fields',async()=>{
 const h=await harness();await h.click('new');assert(h.modal.includes('name="target_date" type="date" value=""'));assert(h.modal.includes('max="9999-12-31" required'));const form=h.form('editor',{title:'Client coordination checkpoint',target_date:'2027-02-03',note:'An agreed project note',status:'pending'});h.input(form);assert.equal(h.module.hasUnsavedChanges(),true);await h.submit(form);
 const write=h.calls.find(call=>call.method==='POST');assert.deepEqual(write.body,{changes:{title:'Client coordination checkpoint',target_date:'2027-02-03',note:'An agreed project note',status:'pending'}});assert.match(write.headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);assert.equal(h.module.hasUnsavedChanges(),false);assert(h.module.render().includes('Client coordination checkpoint'));
});

test('lost save responses retain the editor and retry the identical mutation key once',async()=>{
 const h=await harness();await h.click('open',{id:'checkpoint-one'});await h.click('edit');const form=h.form('editor',{title:'Retained checkpoint draft',target_date:'2027-03-01',note:'Keep this text',status:'pending'});h.loseResponse();await h.submit(form);assert(form.error.innerHTML.includes('Connection interrupted'));assert.equal(h.module.hasUnsavedChanges(),true);assert.equal(h.rows.get('checkpoint-one').version,2);await h.submit(form);
 const writes=h.calls.filter(call=>call.method==='PATCH');assert.equal(writes.length,2);assert.equal(writes[0].headers['Idempotency-Key'],writes[1].headers['Idempotency-Key']);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(h.rows.get('checkpoint-one').version,2);assert.equal(h.module.hasUnsavedChanges(),false);
});

test('CAS errors retain the submitted draft and reload only after an explicit permitted action',async()=>{
 const h=await harness();await h.click('open',{id:'checkpoint-one'});await h.click('edit');const form=h.form('editor',{title:'Do not discard',target_date:'2027-04-01',note:'Retained correction',status:'pending'});h.forceConflict();const count=h.calls.length;await h.submit(form);assert(form.error.innerHTML.includes('Reload saved milestone'));assert.equal(h.calls.length,count+1);assert.equal(h.module.hasUnsavedChanges(),true);assert.equal(h.rows.get('checkpoint-one').version,1);
 h.setCanLeave(false);await h.click('reload-dialog');assert.equal(h.calls.length,count+1);assert.equal(h.module.hasUnsavedChanges(),true);h.setCanLeave(true);h.forceConflict(false);await h.click('reload-dialog');assert(h.modal.includes('A shared project note'));assert.equal(h.module.hasUnsavedChanges(),false);
});

test('checkpoint completion/cancellation/reopening are explicit versioned actions and never mutate tasks or image decisions',async()=>{
 const h=await harness();await h.click('open',{id:'checkpoint-one'});const count=h.calls.length;await h.click('status',{status:'complete'});assert(h.modal.includes('Mark checkpoint complete'));assert.equal(h.calls.length,count);await h.submit(h.form('status',{}, {id:'checkpoint-one',version:'1',status:'complete'}));assert.equal(h.rows.get('checkpoint-one').status,'complete');
 await h.click('open',{id:'checkpoint-one'});assert(h.modal.includes('Reopen checkpoint'));await h.click('status',{status:'pending'});await h.submit(h.form('status',{}, {id:'checkpoint-one',version:'2',status:'pending'}));assert.equal(h.rows.get('checkpoint-one').status,'pending');assert(h.calls.every(call=>call.url.includes('/milestones')));assert.deepEqual(h.calls.filter(call=>call.method==='PATCH').map(call=>call.body.changes),[{status:'complete'},{status:'pending'}]);
});

test('bounded filtering and continuation preserve actual marker coverage and project identity',async()=>{
 const h=await harness({pageSize:1});h.rows.set('checkpoint-two',{...initial(),id:'checkpoint-two',title:'A later checkpoint',target_date:'2027-02-15'});await h.module.load();assert.equal(h.module.markers().complete,false);assert.equal(h.module.markers().total,2);assert.equal(h.module.markers().items.length,1);await h.click('more');assert.equal(h.module.markers().items.length,2);assert.equal(h.module.markers().complete,true);assert(h.calls.at(-1).url.includes('offset=1'));
 await h.submit(h.form('filters',{status:'pending',search:'later',from:'2027-02-01',to:'2027-02-28'}));assert.equal(h.module.markers().items[0].id,'checkpoint-two');assert.equal(h.module.markers().filters.from,'2027-02-01');assert.equal(h.module.markers().project_id,'project-one');
});

test('slow detail replies cannot reopen the previous project view after navigation',async()=>{
 const h=await harness(),held=h.holdRequest('/projects/project-one/milestones/checkpoint-one'),opening=h.click('open',{id:'checkpoint-one'});h.setView('tasks');held.release();await opening;assert.equal(h.modal,'');h.setProject({id:'project-two',archived:false});assert(!h.module.render().includes('A shared project note'));assert.equal(h.module.markers().items.length,0);
});

test('pending writes disable their fields and block another milestone action until the acknowledged refresh finishes',async()=>{
 const h=await harness();await h.click('new');const form=h.form('editor',{title:'Saving checkpoint',target_date:'2027-05-01',note:'A stable submitted note',status:'pending'}),held=h.holdRequest('/projects/project-one/milestones','POST'),saving=h.submit(form);assert.equal(h.module.isSaving(),true);assert.equal(form.controls[0].disabled,true);const other=h.click('new');assert(h.messages.includes('This checkpoint is still saving.'));held.release();await Promise.all([saving,other]);assert.equal(h.module.isSaving(),false);assert.equal(form.controls[0].disabled,false);assert(h.busy>=2);
});

test('closing a milestone while its delayed detail refresh is reading cannot reopen the closed dialog',async()=>{
 const h=await harness();await h.click('open',{id:'checkpoint-one'});assert(h.modal.includes('A shared project note'));const held=h.holdRequest('/projects/project-one/milestones/checkpoint-one'),loading=h.click('open',{id:'checkpoint-one'});h.closeDialog();held.release();await loading;assert.equal(h.modal,'');assert.equal(h.module.isSaving(),false);
});

test('closing a milestone during a delayed history page keeps the dialog closed',async()=>{
 const h=await harness();h.historyContinuation();await h.click('open',{id:'checkpoint-one'});assert(h.modal.includes('Load earlier history'));const held=h.holdRequest('/projects/project-one/milestones/checkpoint-one?offset=50'),loading=h.click('more-history');h.closeDialog();held.release();await loading;assert.equal(h.modal,'');
});

test('a different dialog body takes precedence over a delayed milestone open without a close event',async()=>{
 const h=await harness(),held=h.holdRequest('/projects/project-one/milestones/checkpoint-one'),loading=h.click('open',{id:'checkpoint-one'});h.replaceDialog();held.release();await loading;assert.equal(h.modal,'Another dialog');
});

test('denied current reads clear previous checkpoint rows and marker coverage',async()=>{
 const h=await harness();assert(h.module.render().includes('An agreed checkpoint'));h.denyReads();await assert.rejects(h.module.load(),/access was removed/);assert(!h.module.render().includes('An agreed checkpoint'));assert.equal(h.module.markers().items.length,0);assert.equal(h.module.markers().complete,false);assert(h.module.render().includes('Project access was removed'));
});
