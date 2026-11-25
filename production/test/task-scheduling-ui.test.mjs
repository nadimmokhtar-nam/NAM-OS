import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

async function harness(request){
 const listeners=new Map(),region={innerHTML:''},formControls=[{disabled:false},{disabled:false}],error={textContent:''};let actor='sales',key='tasks',task={id:'current',version:1},filters={scope:'mine'},form=null,changed=0;
 const document={addEventListener(name,listener){const rows=listeners.get(name)||[];rows.push(listener);listeners.set(name,rows);},querySelector(selector){if(selector==='[data-schedule-form]')return form;return selector.startsWith('[data-task-schedule=')?region:null;}};
 const environment=vm.createContext({Intl,Date,URLSearchParams,crypto:{randomUUID},document,FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}}});
 const module=await loadBrowserModule(environment,'task-scheduling.js'),controller=module.createTaskScheduling({request,getData:()=>({actor:{id:actor},today:'2027-04-15'}),getTask:()=>task,getFilters:()=>filters,contextKey:()=>key,onTaskChanged:async()=>{changed++;}});
 return {controller,module,region,controls:formControls,error,changed:()=>changed,actor(value){actor=value;},key(value){key=value;},task(value){task=value;},filters(value){filters=value;},form(values={frequency:'weekly',interval:'1',until:''}){form={dataset:{scheduleForm:task.id},values,isConnected:true,querySelector:()=>error,querySelectorAll:()=>formControls};return form;},async event(name,target){for(const listener of listeners.get(name)||[])await listener({target,preventDefault(){}});}};
}
const detail=(id='current',changes={})=>({id,version:1,due_date:'2027-04-15',status:'Todo',archived:false,recurrence:null,prerequisites:[],unavailable_prerequisites:0,can_complete:true,can_repeat:true,...changes});
const page=(items=[],changes={})=>({from:'2027-04-01',to:'2027-04-30',items,total:items.length,unscheduled_total:0,days:items.length?[{due_date:'2027-04-15',total:items.length}]:[],page:1,pageSize:100,hasMore:false,scope:'assigned',access_revision:1,...changes});

test('calendar has exact month/week windows, leap days, Monday starts and bounded early/late dates',async()=>{
 const {module}=await harness(async()=>page()),{taskCalendarWindow:window,moveTaskCalendar:move}=module;
 const leap=window({today:'2028-02-29'});assert.equal(leap.from,'2028-02-01');assert.equal(leap.to,'2028-02-29');assert(leap.cells.includes('2028-02-29'));assert.equal(leap.cells.length%7,0);
 const week=window({today:'2027-04-15',range:'week'});assert.equal(week.from,'2027-04-12');assert.equal(week.to,'2027-04-18');assert.equal(week.cells.length,7);
 const early=window({today:'0001-01-01',range:'week'});assert.equal(early.from,'0001-01-01');assert.equal(early.to,'0001-01-07');const late=window({today:'9999-12-31'});assert.equal(late.to,'9999-12-31');assert.equal(move('0001-01-01',-1),'0001-01-01');assert.equal(move('9999-12-31',1),'9999-12-31');assert.equal(move('2028-01-31',1),'2028-02-01');
});

test('calendar loads its actual window and server filters, preserves true day totals and pages without using bootstrap tasks',async()=>{
 const queries=[];const h=await harness(async url=>{const query=new URL('https://test.invalid'+url).searchParams;queries.push(query);const p=Number(query.get('page'));return page(Array.from({length:100},(_,n)=>({id:'task-'+((p-1)*100+n),number:n,title:n===0?'<Private & exact>':'Task '+n,due_date:'2027-04-15',status:'Todo',owner_name:'Sales'})),{total:230,days:[{due_date:'2027-04-15',total:230}],page:p,hasMore:p<3,unscheduled_total:7});});
 h.filters({scope:'all',owner:'owner-id',section:'sales',status:'Todo',priority:'High',search:'Courtyard',focus:'open',archived:false});await h.controller.load();assert.equal(queries[0].get('from'),'2027-04-01');assert.equal(queries[0].get('to'),'2027-04-30');assert.equal(queries[0].get('scope'),'studio');assert.equal(queries[0].get('focus'),'open');assert.equal(queries[0].get('page_size'),'100');
 let html=h.controller.render();assert(html.includes('100 of 230'));assert(html.includes('230 matching tasks'));assert(html.includes('227 more · partly loaded'));assert(html.includes('7 matching tasks have no due date'));assert(html.includes('&lt;Private &amp; exact&gt;'));assert(!html.includes('style='));
 await h.controller.load({append:true});assert.equal(h.controller.getState().items.length,200);assert.equal(queries[1].get('page'),'2');assert(h.controller.render().includes('200 of 230'));
});

test('late calendar responses cannot replace newer filters, another route or a new identity',async()=>{
 let release;const delayed=new Promise(done=>release=done);let first=true;const h=await harness(async()=>{if(first){first=false;return delayed;}return page([{id:'new',title:'Current result',number:2,due_date:'2027-04-15',status:'Todo'}]);});
 const old=h.controller.load();h.filters({search:'current'});await h.controller.load();release(page([{id:'old',title:'NEVER SHOW OLD TITLE',number:1,due_date:'2027-04-15',status:'Todo'}]));await old;assert.equal(h.controller.getState().items[0].id,'new');assert(!h.controller.render().includes('NEVER SHOW OLD TITLE'));
 let finish;const inFlight=h.controller.load();h.actor('different');h.key('projects');await inFlight;assert(!h.controller.getState().items.some(row=>row.id==='old'));
});

test('a denied page clears previously rendered calendar records and a changed access revision restarts paging',async()=>{
 let reject=false,revision=1;const queries=[];const h=await harness(async url=>{queries.push(new URL('https://test.invalid'+url).searchParams.get('page'));if(reject)throw Object.assign(Error('Calendar access revoked'),{status:403});return page([{id:'private-'+revision,title:revision===1?'OLD PRIVATE TITLE':'New permitted task',number:1,status:'Todo',due_date:'2027-04-15'}],{access_revision:revision,total:2,hasMore:true,page:Number(queries.at(-1))});});
 await h.controller.load();revision=2;await h.controller.load({append:true});assert.deepEqual(queries,['1','2','1']);assert(!h.controller.render().includes('OLD PRIVATE TITLE'));
 reject=true;await assert.rejects(h.controller.load({append:true}));assert.equal(h.controller.getState().items.length,0);assert(!h.controller.render().includes('New permitted task'));assert(h.controller.render().includes('Calendar access revoked'));
});

test('detail loads protect task identity and clear saved prerequisite titles when access is denied',async()=>{
 let release,deny=false;const pending=new Promise(done=>release=done),h=await harness(url=>{if(deny)throw Object.assign(Error('Task access revoked'),{status:404});return url.includes('/old/')?pending:Promise.resolve(detail('new',{prerequisites:[{id:'visible',title:'Visible prerequisite',status:'Done'}],unavailable_prerequisites:1}));});
 h.task({id:'old'});const old=h.controller.loadDetail('old');h.task({id:'new'});await h.controller.loadDetail('new');release(detail('old',{prerequisites:[{id:'hidden',title:'NEVER DISPLAY OLD TASK'}]}));await old;assert.equal(h.controller.getState().detail.id,'new');assert(!h.region.innerHTML.includes('NEVER DISPLAY'));assert(h.region.innerHTML.includes('1 prerequisite is no longer available'));
 deny=true;await assert.rejects(h.controller.loadDetail('new'));assert.equal(h.controller.getState().selected.length,0);assert(!h.region.innerHTML.includes('Visible prerequisite'));assert(h.region.innerHTML.includes('Task access revoked'));
});

test('an uncertain save retries its original body/key exactly and preserves parent task edits through a focused callback',async()=>{
 let fail=true;const writes=[];const h=await harness(async(url,method,body,headers)=>{if(method!=='PATCH')return detail();writes.push({body:structuredClone(body),key:headers['Idempotency-Key']});if(fail){fail=false;throw Object.assign(Error('Connection lost after write'),{status:503});}return detail('current',{version:2,recurrence:{until:null,interval:1,frequency:'weekly'}});});
 await h.controller.loadDetail('current');const form=h.form();await h.controller.save(form);assert.equal(h.changed(),0);assert(h.controls.every(control=>control.disabled));assert(h.error.textContent.includes('original change is retained'));
 form.values.frequency='daily';await h.controller.save(form);assert.deepEqual(writes[0],writes[1]);assert.equal(h.changed(),1);assert.equal(h.controller.getState().detail.version,2);assert.equal(h.controller.hasUnsavedChanges(),false);
});

test('prerequisite edits preserve an unchanged repeat rule and unavailable links require explicit removal',async()=>{
 const writes=[],rule={until:null,interval:1,frequency:'weekly'},h=await harness(async(url,method,body)=>{if(method==='PATCH'){writes.push(structuredClone(body));return detail('current',{version:2,recurrence:rule,unavailable_prerequisites:0,prerequisites:[]});}return detail('current',{status:'Done',recurrence:rule,unavailable_prerequisites:1,prerequisites:[{id:'prior',title:'Visible task',status:'Done'}]});});
 await h.controller.loadDetail('current');const state=h.controller.getState(),form=h.form();state.selected=[];state.dependenciesChanged=true;await h.controller.save(form);assert.equal(writes.length,0);assert(h.error.textContent.includes('Remove unavailable links explicitly'));
 state.removeUnavailable=true;await h.controller.save(form);assert.equal(writes.length,1);assert.deepEqual(writes[0].changes,{prerequisite_ids:[]});
});

test('repeat drafts survive prerequisite search rerenders and hidden prerequisites are not silently replaced by repeat-only saves',async()=>{
 const writes=[],h=await harness(async(url,method,body)=>{if(method==='PATCH'){writes.push(body);return detail('current',{version:2,recurrence:body.changes.recurrence,unavailable_prerequisites:1});}if(url.startsWith('/tasks?'))return {items:[{id:'choice',number:1,title:'Choice',status:'Todo'}],page:1,total:1,hasMore:false};return detail('current',{unavailable_prerequisites:1});});
 await h.controller.loadDetail('current');await h.event('change',{id:'task-repeat-frequency',name:'frequency',value:'monthly'});await h.event('input',{id:'task-repeat-interval',name:'interval',value:'3'});assert.equal(h.controller.hasUnsavedChanges(),true);await h.controller.searchPrerequisites();assert(h.region.innerHTML.includes('value="monthly" selected'));assert(h.region.innerHTML.includes('value="3"'));
 await h.controller.save(h.form({frequency:'monthly',interval:'3',until:''}));assert.equal(writes.length,1);assert(!Object.hasOwn(writes[0].changes,'prerequisite_ids'));assert.equal(writes[0].changes.recurrence.interval,3);
});

test('an accepted detail close invalidates pending detail responses and clears drafts while retaining the calendar period',async()=>{
 let release;const pending=new Promise(done=>release=done),h=await harness(url=>url.includes('/scheduling')?pending:Promise.resolve(page()));
 h.controller.getState().cursor='2028-02-29';h.controller.getState().range='week';const read=h.controller.loadDetail('current');assert.equal(h.controller.closeDetail(),true);release(detail('current',{prerequisites:[{id:'old',title:'Closed task private title'}]}));await read;assert.equal(h.controller.getState().detail,null);assert.equal(h.controller.getState().detailId,'');assert.equal(h.controller.hasUnsavedChanges(),false);assert.equal(h.controller.getState().cursor,'2028-02-29');assert.equal(h.controller.getState().range,'week');assert(!h.region.innerHTML.includes('Closed task private title'));
});
