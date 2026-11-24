import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute the production application and its actual imported UI factories.
// The document/HTTP boundary is simulated. This checks behavior, not layout,
// native focus, RLS, live providers or accessibility conformance.
function node(){return {id:'',innerHTML:'',textContent:'',open:false,disabled:false,dataset:{},attributes:{},classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},querySelector(){return null;},querySelectorAll(){return [];},contains(){return false;},closest(){return null;},matches(){return false;},focus(){},addEventListener(type,listener){(this.listeners??={})[type]=listener;},showModal(){this.open=true;},close(){this.open=false;this.listeners?.close?.();}};}
const actor={id:'founder-1',name:'Nadim',initials:'NM',role:'founder'},omar={id:'sales-1',name:'Omar',initials:'OM',role:'sales'};
function bootstrap(){return {actor,members:[actor,omar],sections:['sales','academy','projects','library','team','operations'],tasks:[],courses:[],notifications:[],today:'2026-11-24',mode:'authenticated',capabilities:{productionAuth:true,database:'postgresql',projects:'tasks_only',library:'tasks_only'},roleLabels:{founder:'Founder',sales:'Sales Representative'},csrf:'test-csrf'};}
function task(section='projects'){return {id:'task-1',number:1,title:'Review project lighting',description:'Original brief',section,status:'Todo',priority:'High',owner_id:actor.id,owner_name:actor.name,owner_initials:actor.initials,version:1,due_date:'2026-11-25',comments:[],subtasks:[],events:[]};}
async function harness({intercept,sales,defaultTimeZone}={}){
  const model=bootstrap(),nodes=new Map(['#app','#main','#dialog','#toast','#studio-navigation','#task-results'].map(id=>[id,node()])),listeners={},requests=[],redirects=[],windowEvents={};let confirmValue=true;
  const document={activeElement:node(),title:'',querySelector(selector){return nodes.get(selector)||null;},getElementById(id){return nodes.get('#'+id)||null;},querySelectorAll(){return [];},addEventListener(type,listener){(listeners[type]??=[]).push(listener);}};
  for(const [id,element] of nodes){element.id=id.slice(1);element.focus=()=>document.activeElement=element;}
  const location={hash:'#overview',origin:'https://nam.example',assign(url){redirects.push(url);},reload(){redirects.push('reload');}};
  const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
  const fixtureSales=sales||{activities:[],reports:[],targets:[],activity_total:0,activity_counts:[],activities_truncated:false};
  const runtimeIntl=defaultTimeZone?Object.create(Intl):Intl;if(defaultTimeZone)runtimeIntl.DateTimeFormat=function(locales,options={}){return new Intl.DateTimeFormat(locales,{timeZone:defaultTimeZone,...options});};
  const sandbox=vm.createContext({console,Intl:runtimeIntl,Date,URL,URLSearchParams,AbortController,WeakSet,structuredClone,setTimeout:()=>1,clearTimeout(){},confirm:()=>confirmValue,location,history:{replaceState(a,b,url){location.hash=url;}},window:{addEventListener(type,listener){windowEvents[type]=listener;},matchMedia(){return {matches:false};},scrollTo(){},location},document,FormData:class {constructor(form){this.values=form.values||{};}*[Symbol.iterator](){yield*Object.entries(this.values);}},fetch:async(url,init={})=>{
    requests.push({url,init});const overridden=await intercept?.(url,init,model,response);if(overridden)return overridden;
    if(url==='/api/bootstrap')return response(model);
    if(url.startsWith('/api/tasks?')){const section=new URL(url,'https://nam.example').searchParams.get('section');return response({items:section?[task(section)]:[],total:section?1:0,page:1,pageSize:100,hasMore:false});}
    if(url.startsWith('/api/tasks/')&&!init.method?.includes('POST'))return response(task());
    if(url==='/api/sales')return response(fixtureSales);
    if(url==='/api/sales/connected')return response({mode:'connected',connections:[],metrics:[],records:[],pipeline:[],record_total:0,limit:20,offset:0});
    if(url==='/api/auth/logout')return response({signedOut:true});
    return response({error:'Unsupported production endpoint'},404);
  }});
  const loaded=new Set();
  async function load(file){if(loaded.has(file))return;loaded.add(file);let source=await readFile(new URL('../public/'+file,import.meta.url),'utf8');for(const match of source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm))await load(match[2]);const exports=Array.from(source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),match=>match[1]);source=source.replace(/^import[^\n]*\n/gm,'').replace(/^export\s+/gm,'');Object.assign(sandbox,await vm.runInContext(`(async()=>{${source}\nreturn {${exports.join(',')}};})()`,sandbox,{filename:file}));}
  let source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');for(const match of source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm))await load(match[2]);source=source.replace(/^import[^\n]*\n/gm,'').replace(/^export\s+/gm,'');
  const ui=await vm.runInContext(`(async()=>{${source}\nreturn {state,mountWorkspace,unmountWorkspace,navigate,render,action,api,refresh,openTask,openDialog,taskDraft,taskDialog,dirtyTask,dirtyDialog,editableValues,academyAdmin};})()`,sandbox,{filename:'production-app-under-test.js'});
  await ui.mountWorkspace();
  return {ui,model,nodes,requests,redirects,location,response,document,windowEvents,setConfirm(value){confirmValue=value;},async dispatch(type,event){for(const listener of listeners[type]||[])await listener(event);}};
}

for(const section of ['projects','library'])test(`production ${section} opens a working task workspace without unsupported record APIs`,async()=>{
  const h=await harness();h.location.hash='#'+section;await h.ui.navigate();
  const html=h.nodes.get('#app').innerHTML;
  assert(html.includes(`${section==='projects'?'Projects':'Library'} work`));assert(html.includes('data-action="create-task"'));assert(html.includes('data-action="view-mode"'));assert(html.includes('data-id="task-1"'));
  assert(!h.requests.some(r=>r.url==='/api/projects'||r.url==='/api/resources'));assert(html.includes(section==='projects'?'Project briefs, deliverables and image approvals are not available yet.':'Asset browsing and downloads are not available yet.'));
  const query=new URL(h.requests.findLast(r=>r.url.startsWith('/api/tasks?')).url,'https://nam.example').searchParams;assert.equal(query.get('section'),section);
  assert(!/sample|local preview|demonstration/i.test(html));assert(!html.includes('data-action="project"'));assert(!html.includes('data-action="resource"'));
});

test('manual accountability uses full server totals rather than the 500-row activity window',async()=>{
  const sales={activities:Array.from({length:500},(_,n)=>({id:'a-'+n,type:'Outreach',owner_id:omar.id,context:'Company '+n,outcome:'Sent',occurred_on:'2026-11-24'})),reports:[],targets:[],activity_total:1234,activity_counts:[{owner_id:omar.id,type:'Outreach',period:'2026-11',n:1000},{owner_id:omar.id,type:'Meeting held',period:'2026-11',n:'210'},{owner_id:actor.id,type:'Meeting held',period:'2026-10',n:24}],activities_truncated:true};
  const h=await harness({sales});h.location.hash='#sales';await h.ui.navigate();await h.ui.action({dataset:{action:'tab',value:'summary'}});
  const html=h.nodes.get('#app').innerHTML;assert(html.includes('<h3>Activities logged</h3><div class="kpi-value">1,234</div>'));assert(html.includes('<h3>Meetings held</h3><div class="kpi-value">234</div>'));
  await h.ui.action({dataset:{action:'tab',value:'activities'}});assert(h.nodes.get('#app').innerHTML.includes('Showing the latest 500 activities.'));
});

test('monthly target progress respects the authoritative owner/type/month buckets',async()=>{
  const sales={activities:[],reports:[],targets:[{id:'target-1',owner_id:omar.id,metric:'Meetings held',period:'2026-11',target:20}],activity_total:100,activity_counts:[{owner_id:omar.id,type:'Meeting held',period:'2026-11',n:17},{owner_id:omar.id,type:'Meeting held',period:'2026-10',n:50},{owner_id:actor.id,type:'Meeting held',period:'2026-11',n:22},{owner_id:omar.id,type:'Outreach',period:'2026-11',n:11}]};
  const h=await harness({sales});h.location.hash='#sales';await h.ui.navigate();await h.ui.action({dataset:{action:'tab',value:'targets'}});const html=h.nodes.get('#app').innerHTML;assert(html.includes('<h2>17 <span class="muted">/ 20</span>'));assert(html.includes('All logged activities · target month'));
});

test('missing or invalid activity aggregates remain unavailable instead of being inferred as zero',async()=>{
  const h=await harness({sales:{activities:[{type:'Meeting held',owner_id:omar.id}],reports:[],targets:[{owner_id:omar.id,metric:'Meetings held',period:'2026-11',target:5}]}});h.location.hash='#sales';await h.ui.navigate();await h.ui.action({dataset:{action:'tab',value:'summary'}});assert(h.nodes.get('#app').innerHTML.includes('<h3>Activities logged</h3><div class="kpi-value">Unavailable</div>'));assert(h.nodes.get('#app').innerHTML.includes('<h3>Meetings held</h3><div class="kpi-value">Unavailable</div>'));
  await h.ui.action({dataset:{action:'tab',value:'targets'}});assert(h.nodes.get('#app').innerHTML.includes('Monthly activity totals could not be loaded'));
  h.ui.state.sales.activity_counts=[{owner_id:omar.id,type:'Meeting held',period:'2026-11',n:'not-a-count'}];h.ui.render();assert(h.nodes.get('#app').innerHTML.includes('<h2>Unavailable'));
  h.ui.state.sales.activity_counts[0].n=null;h.ui.render();assert(h.nodes.get('#app').innerHTML.includes('<h2>Unavailable'));
});

test('an unreadable session-expiry response clears protected content and redirects to sign-in',async()=>{
  const h=await harness({intercept:(url)=>url==='/api/expired'?{ok:false,status:401,async json(){throw Error('HTML error page');}}:null});h.ui.state.task=task();h.ui.state.course={id:'private-course'};
  await assert.rejects(()=>h.ui.api('/expired'),/session ended/i);assert.equal(h.ui.state.data,null);assert.equal(h.ui.state.task,null);assert.equal(h.ui.state.course,null);assert(h.redirects.some(url=>url.startsWith('/login')));assert(h.nodes.get('#app').innerHTML.includes('Sign in to continue.'));
});

test('a late bootstrap cannot restore the previous identity after logout',async()=>{
  let release,started;const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);let bootstrapRequests=0;
  const h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/bootstrap'&&++bootstrapRequests>1){started();await hold;return response(model);}return null;}});
  const older=h.ui.refresh();await seen;await h.ui.action({dataset:{action:'logout'}});release();await assert.rejects(()=>older,{name:'AbortError'});assert.equal(h.ui.state.data,null);assert(h.nodes.get('#app').innerHTML.includes('Sign in to continue.'));
});

test('a response body arriving after logout is discarded even when headers arrived earlier',async()=>{
  let release,started;const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);let calls=0;
  const h=await harness({intercept:(url,init,model)=>{if(url==='/api/bootstrap'&&++calls>1)return {ok:true,status:200,async json(){started();await hold;return structuredClone(model);}};return null;}});
  const older=h.ui.refresh();await seen;await h.ui.action({dataset:{action:'logout'}});release();await assert.rejects(()=>older,{name:'AbortError'});assert.equal(h.ui.state.data,null);
});

test('production rejects a non-production bootstrap instead of rendering a role selector',async()=>{
  const h=await harness({intercept:(url,init,model,response)=>url==='/api/bootstrap'?response({...model,mode:'local-preview'}):null});assert(h.nodes.get('#app').innerHTML.includes('could not verify its production data source'));assert(!h.nodes.get('#app').innerHTML.includes('preview-member'));assert.equal(h.ui.state.data,null);
});

test('task conflict preserves unsaved fields and keeps an explicit reload action available',async()=>{
  const h=await harness({intercept:(url,init,model,response)=>url==='/api/tasks/task-1'&&init.method==='PATCH'?response({error:'This task changed elsewhere. Reload it before saving.'},409):null});await h.ui.openTask('task-1');const error=node(),submit=node(),draft={title:'My retained direction',description:'Do not lose these notes',status:'Blocked',priority:'High',due_date:'2026-11-25',owner_id:actor.id,section:'projects'},form={dataset:{form:'edit-task'},values:draft,matches(){return false;},querySelector(selector){return selector==='.form-error'?error:selector==='[type=submit]'?submit:null;}};
  await h.dispatch('submit',{target:form,preventDefault(){}});assert(error.textContent.includes('changed elsewhere'));assert.equal(form.values.description,'Do not lose these notes');assert.equal(submit.disabled,false);assert(h.nodes.get('#dialog').innerHTML.includes('data-action="reload-task"'));
});

test('comment save retains unsaved task title and description without mutating those saved fields',async()=>{
  const h=await harness({intercept:(url,init,model,response)=>url==='/api/tasks/task-1/comments'?response({...task(),comments:[{author_name:'Nadim',body:'Decision recorded',created_at:'2026-11-24T12:00:00Z'}]}):null});await h.ui.openTask('task-1');
  h.nodes.get('#dialog').querySelector=selector=>selector==='form[data-form="edit-task"]'?{values:{title:'Unsaved title',description:'Unsaved notes',status:'Todo',priority:'High',section:'projects',due_date:'2026-11-25',owner_id:actor.id}}:null;
  const error=node(),submit=node(),form={dataset:{form:'comment'},values:{body:'Decision recorded'},matches(){return false;},querySelector(selector){return selector==='.form-error'?error:selector==='[type=submit]'?submit:null;}};
  await h.dispatch('submit',{target:form,preventDefault(){}});const html=h.nodes.get('#dialog').innerHTML;assert(html.includes('Unsaved title'));assert(html.includes('Unsaved notes'));assert(html.includes('Decision recorded'));assert.equal(h.ui.state.task.title,'Review project lighting');assert(!h.requests.some(r=>r.init.method==='PATCH'));
});

test('assigned course renders escaped module headings and the correct publication resources for each lesson',async()=>{
  const h=await harness();h.ui.state.view='academy';
  h.ui.state.course={id:'course-1',title:'Interior lighting',area:'3d',version:2,completed:0,total:3,completion:null,assignments:[],lessons:[
    {id:'lesson-1',module_id:'module-1',module_title:'Lighting <svg onload=alert(1)>',title:'Start with the brief',body:'Read the approved notes.'},
    {id:'lesson-2',module_id:'module-1',module_title:'Lighting <svg onload=alert(1)>',title:'Place the camera',body:'Review composition.'},
    {id:'lesson-3',module_id:'module-2',module_title:'Finish & review',title:'Final review',body:'Check the output.'}
  ],resources:[
    {id:'resource-shared',title:'Studio <script>alert(1)</script> checklist',lesson_id:null},
    {id:'resource-first',title:'Brief worksheet',lesson_id:'lesson-1'},
    {id:'resource-other',title:'Camera worksheet',lesson_id:'lesson-2'}
  ]};h.ui.state.lesson=0;h.ui.render();
  const first=h.nodes.get('#app').innerHTML;assert(first.includes('<h3 class="lesson-module">Lighting &lt;svg'));assert(first.includes('<h3 class="lesson-module">Finish &amp; review</h3>'));assert.equal((first.match(/class="lesson-module"/g)||[]).length,2);assert(!first.includes('<svg onload='));assert(!first.includes('<script>alert(1)</script>'));assert(first.includes('Studio &lt;script&gt;alert(1)&lt;/script&gt; checklist'));
  assert(first.includes('href="/api/academy/resources/resource-shared/download"'));assert(first.includes('href="/api/academy/resources/resource-first/download"'));assert(!first.includes('href="/api/academy/resources/resource-other/download"'));assert(first.includes('aria-current="step"'));
  await h.ui.action({dataset:{action:'lesson',index:'1'}});const second=h.nodes.get('#app').innerHTML;assert(second.includes('href="/api/academy/resources/resource-shared/download"'));assert(second.includes('href="/api/academy/resources/resource-other/download"'));assert(!second.includes('href="/api/academy/resources/resource-first/download"'));
});

test('target assignment uses real eligible member identifiers and includes a sales manager',async()=>{
  const h=await harness();h.ui.state.data.members.push({id:'manager-uuid',name:'Sales lead',role:'sales_manager'});h.ui.state.sales={activities:[],reports:[],targets:[],activity_total:0,activity_counts:[]};
  await h.ui.action({dataset:{action:'target'}});const html=h.nodes.get('#dialog').innerHTML;assert(html.includes('value="sales-1" selected'));assert(html.includes('value="manager-uuid"'));assert(!html.includes('value="omar"'));
});

test('unsaved course form survives rejected close and Escape while readonly/disabled values are excluded',async()=>{
  const h=await harness(),dialog=h.nodes.get('#dialog'),form={values:{title:'Lesson draft',body:'Initial text',private_link:'one',publication:'1',hidden_id:'one'},elements:[{name:'title',type:'text'},{name:'body',type:'textarea'},{name:'private_link',type:'text',readOnly:true},{name:'publication',type:'select-one',disabled:true},{name:'hidden_id',type:'hidden'}]};
  dialog.querySelectorAll=selector=>selector==='form'?[form]:[];h.ui.openDialog('Edit lesson','<form></form>');assert.equal(h.ui.dirtyDialog(),false);
  form.values.private_link='changed readonly';form.values.publication='2';form.values.hidden_id='changed hidden';assert.equal(h.ui.dirtyDialog(),false);
  form.values.body='My unsaved long lesson';h.setConfirm(false);await h.ui.action({dataset:{action:'close-dialog'}});assert.equal(dialog.open,true);assert.equal(form.values.body,'My unsaved long lesson');let prevented=false;dialog.listeners.cancel({preventDefault(){prevented=true;}});assert(prevented);assert.equal(dialog.open,true);
  h.setConfirm(true);await h.ui.action({dataset:{action:'close-dialog'}});assert.equal(dialog.open,false);
});

test('successful programmatic close stays unblocked and password snapshots never retain password text',async()=>{
  const h=await harness(),dialog=h.nodes.get('#dialog'),form={values:{current_password:'',new_password:''},elements:[{name:'current_password',type:'password'},{name:'new_password',type:'password'}]};dialog.querySelectorAll=selector=>selector==='form'?[form]:[];
  h.ui.openDialog('Change password','<form></form>');form.values.current_password='A private current password';form.values.new_password='A private replacement password';const snapshot=h.ui.editableValues(form);assert(!snapshot.includes('private'));assert.deepEqual(JSON.parse(snapshot).map(([,value])=>value),[true,true]);assert(h.ui.dirtyDialog());
  h.setConfirm(false);dialog.close();assert.equal(dialog.open,false);
});

async function editInlineMetadata(h){
  const form={dataset:{academyForm:'metadata',course:'course-draft',revision:'4',base:JSON.stringify({title:'Saved course',area:'sales',summary:''})},values:{title:'An unsaved NAM course title',area:'sales',summary:'Keep these notes while navigating'}};
  await h.dispatch('input',{target:{id:'academy-title',closest(selector){return selector==='[data-academy-form="metadata"]'?form:null;}}});assert(h.ui.academyAdmin.hasUnsavedChanges());
}

const salesActivity=(overrides={})=>({id:'activity-1',owner_id:omar.id,type:'Reply',context:'Approved company',outcome:'Reply received',note:'Original note',occurred_on:'2026-11-24',version:3,...overrides});
const manualData=(overrides={})=>({activities:[salesActivity()],reports:[],targets:[],activity_total:1,activity_counts:[],...overrides});
function correctionForm(kind,values,dataset={}){const error=node(),submit=node(),form={dataset:{form:kind,...dataset},values,matches(){return false;},querySelector(selector){return selector==='.form-error'?error:selector==='[type=submit]'?submit:null;}};return {form,error,submit};}

test('manual activity corrections and deletions use the captured revision and refresh totals',async()=>{
  const sales=manualData();const h=await harness({sales,intercept:(url,init,model,response)=>url==='/api/sales/activities/activity-1'&&['PATCH','DELETE'].includes(init.method)?response(manualData({activities:[],activity_total:0})):null});h.ui.state.sales=structuredClone(sales);h.ui.state.view='sales';h.ui.state.tab='activities';h.ui.render();assert(h.nodes.get('#app').innerHTML.includes('data-action="edit-activity"'));
  await h.ui.action({dataset:{action:'edit-activity',id:'activity-1'}});assert(h.nodes.get('#dialog').innerHTML.includes('data-version="3"'));const f=correctionForm('activity-edit',{type:'Meeting held',context:'Corrected company',outcome:'Meeting booked',note:'Updated note',occurred_on:'2026-11-25'},{id:'activity-1',version:'3'});await h.dispatch('submit',{target:f.form,preventDefault(){}});
  const edit=h.requests.find(r=>r.init.method==='PATCH');assert.equal(JSON.parse(edit.init.body).expectedVersion,3);assert.equal(JSON.parse(edit.init.body).changes.note,'Updated note');assert.equal(h.ui.state.sales.activity_total,0);
  h.ui.state.sales=structuredClone(sales);h.setConfirm(false);await h.ui.action({dataset:{action:'delete-activity',id:'activity-1',version:'3'}});assert(!h.requests.some(r=>r.init.method==='DELETE'));
  h.setConfirm(true);await h.ui.action({dataset:{action:'delete-activity',id:'activity-1',version:'3'}});assert.equal(JSON.parse(h.requests.find(r=>r.init.method==='DELETE').init.body).expectedVersion,3);assert.equal(h.ui.state.sales.activity_total,0);
});

test('activity conflict preserves input and offers explicit reload instead of silently retrying',async()=>{
  const h=await harness({intercept:(url,init,model,response)=>init.method==='PATCH'?response({error:'Record changed elsewhere'},409):null});h.ui.state.sales=manualData();await h.ui.action({dataset:{action:'edit-activity',id:'activity-1'}});const f=correctionForm('activity-edit',{type:'Reply',context:'Unsaved correction',outcome:'Retain this',note:'Keep me',occurred_on:'2026-11-24'},{id:'activity-1',version:'3'});await h.dispatch('submit',{target:f.form,preventDefault(){}});assert.equal(f.form.values.note,'Keep me');assert(f.error.innerHTML.includes('Record changed elsewhere'));assert(f.error.innerHTML.includes('data-action="reload-sales"'));assert.equal(h.requests.filter(r=>r.init.method==='PATCH').length,1);assert.equal(f.submit.disabled,false);
});

test('sales representatives cannot open correction controls for another owner',async()=>{
  const h=await harness();h.ui.state.data.actor=omar;h.ui.state.view='sales';h.ui.state.tab='activities';h.ui.state.sales=manualData({activities:[salesActivity({owner_id:actor.id})]});h.ui.render();assert(!h.nodes.get('#app').innerHTML.includes('data-action="edit-activity"'));await assert.rejects(()=>h.ui.action({dataset:{action:'edit-activity',id:'activity-1'}}),/not available/);assert(!h.requests.some(r=>r.init.method==='PATCH'||r.init.method==='DELETE'));
});

test('editing an existing founder target sends the captured revision and immutable target key',async()=>{
  const target={id:'target-1',owner_id:omar.id,metric:'Meetings held',period:'2026-11',target:5,version:7};const h=await harness({intercept:(url,init,model,response)=>url==='/api/sales/targets'&&init.method==='POST'?response(manualData({targets:[{...target,target:8,version:8}]})):null});h.ui.state.sales=manualData({targets:[target]});await h.ui.action({dataset:{action:'edit-target',id:'target-1'}});assert(h.nodes.get('#dialog').innerHTML.includes('data-version="7"'));const f=correctionForm('target',{owner_id:omar.id,metric:'Meetings held',period:'2026-11',target:'8'},{id:'target-1',version:'7'});await h.dispatch('submit',{target:f.form,preventDefault(){}});assert.deepEqual(JSON.parse(h.requests.find(r=>r.url==='/api/sales/targets').init.body),{owner_id:omar.id,metric:'Meetings held',period:'2026-11',target:8,expectedVersion:7});assert.equal(h.ui.state.sales.targets[0].version,8);
});

test('stale target correction remains editable and duplicate create never overwrites an existing target',async()=>{
  const target={id:'target-1',owner_id:omar.id,metric:'Meetings held',period:'2026-11',target:5,version:7};const h=await harness({intercept:(url,init,model,response)=>url==='/api/sales/targets'?response({error:'Target changed elsewhere'},409):null});h.ui.state.sales=manualData({targets:[target]});const values={owner_id:omar.id,metric:target.metric,period:target.period,target:'9'},f=correctionForm('target',{...values},{id:target.id,version:'7'});await h.dispatch('submit',{target:f.form,preventDefault(){}});assert(f.error.innerHTML.includes('Reload sales records'));assert.equal(f.form.values.target,'9');const count=h.requests.filter(r=>r.url==='/api/sales/targets').length;const fresh=correctionForm('target',{...values});await h.dispatch('submit',{target:fresh.form,preventDefault(){}});assert(fresh.error.innerHTML.includes('use Edit target'));assert.equal(h.requests.filter(r=>r.url==='/api/sales/targets').length,count);
});

test('cancelled user logout sends no mutation and preserves actual Academy metadata drafts',async()=>{
  const h=await harness();await editInlineMetadata(h);h.setConfirm(false);await h.ui.action({dataset:{action:'logout'}});assert(!h.requests.some(r=>r.url==='/api/auth/logout'));assert(h.ui.state.data);assert(h.ui.academyAdmin.hasUnsavedChanges());
  h.setConfirm(true);await h.ui.action({dataset:{action:'logout'}});assert.equal(h.requests.filter(r=>r.url==='/api/auth/logout').length,1);assert.equal(h.ui.state.data,null);assert.equal(h.ui.academyAdmin.hasUnsavedChanges(),false);
});

test('beforeunload is prevented only for active unsaved work and not after discard or unmount',async()=>{
  const h=await harness();let prevented=0;const event=()=>({preventDefault(){prevented++;}});h.windowEvents.beforeunload(event());assert.equal(prevented,0);
  await editInlineMetadata(h);const dirty=event();h.windowEvents.beforeunload(dirty);assert.equal(prevented,1);assert.equal(dirty.returnValue,'');
  h.ui.academyAdmin.discardUnsavedChanges();h.windowEvents.beforeunload(event());assert.equal(prevented,1);
  await editInlineMetadata(h);h.ui.unmountWorkspace();assert.equal(h.ui.academyAdmin.hasUnsavedChanges(),false);h.windowEvents.beforeunload(event());assert.equal(prevented,1);
});

test('unexpected session expiry clears private drafts without asking to discard them',async()=>{
  const h=await harness({intercept:(url,init,model,response)=>url==='/api/expired'?response({error:'Session expired'},401):null});await editInlineMetadata(h);h.setConfirm(false);await assert.rejects(()=>h.ui.api('/expired'),/Session expired/);assert.equal(h.ui.state.data,null);assert.equal(h.ui.academyAdmin.hasUnsavedChanges(),false);assert(h.redirects.some(url=>url.startsWith('/login')));
});

test('date-only task deadlines preserve the calendar date in UTC+14 browsers',async()=>{
  const h=await harness({defaultTimeZone:'Pacific/Kiritimati',intercept:(url,init,model,response)=>url.startsWith('/api/tasks?')?response({items:[{...task(),due_date:'2026-11-23'}],total:1,page:1,pageSize:100,hasMore:false}):null});h.location.hash='#tasks';await h.ui.navigate();const html=h.nodes.get('#app').innerHTML;assert(html.includes('<span class="due overdue">23 Nov</span>'));assert(!html.includes('<span class="due overdue">24 Nov</span>'));
});

test('Sales activity and target correction drafts use the shared close and unload protection',async()=>{
  for(const kind of ['activity-edit','target']){
    const h=await harness();h.ui.state.sales=manualData({targets:[{id:'target-1',owner_id:omar.id,metric:'Meetings held',period:'2026-11',target:5,version:1}]});
    const dialog=h.nodes.get('#dialog'),form={values:kind==='activity-edit'?{note:'Saved note'}:{target:'5'},elements:[{name:kind==='activity-edit'?'note':'target',type:kind==='activity-edit'?'textarea':'number'}]};dialog.querySelectorAll=selector=>selector==='form'?[form]:[];
    await h.ui.action({dataset:{action:kind==='activity-edit'?'edit-activity':'edit-target',id:kind==='activity-edit'?'activity-1':'target-1'}});assert.equal(h.ui.dirtyDialog(),false);form.values[kind==='activity-edit'?'note':'target']=kind==='activity-edit'?'Unsaved correction':'8';
    h.setConfirm(false);await h.ui.action({dataset:{action:'close-dialog'}});assert(dialog.open);let blocked=false;h.windowEvents.beforeunload({preventDefault(){blocked=true;}});assert(blocked);
    h.setConfirm(true);await h.ui.action({dataset:{action:'close-dialog'}});assert.equal(dialog.open,false);assert(!h.requests.some(r=>['PATCH','POST','DELETE'].includes(r.init.method)));
  }
});

test('activity create retry conflict retains input and offers guarded reload without sending a new create',async()=>{
  const h=await harness({intercept:(url,init,model,response)=>url==='/api/sales/activities'&&init.method==='POST'?response({error:'This retry key belongs to different activity content.'},409):url==='/api/sales'?response({error:'Sales could not refresh'},503):null});h.ui.state.sales=manualData();await h.ui.action({dataset:{action:'activity'}});
  const f=correctionForm('activity',{type:'Reply',context:'Edited after uncertain response',outcome:'Keep the latest outcome',note:'Keep these details',occurred_on:'2026-11-24'});h.nodes.get('#dialog').querySelectorAll=selector=>selector==='form'?[{values:f.form.values,elements:Object.keys(f.form.values).map(name=>({name,type:'text'}))}]:[];
  // Capture the actual current form before its subsequent user edit.
  const current=h.nodes.get('#dialog').querySelectorAll('form')[0];h.nodes.get('#dialog').querySelectorAll=selector=>selector==='form'?[current]:[];h.ui.openDialog('Log activity','<form></form>');current.values.note='An unsaved revised note';
  await h.dispatch('submit',{target:f.form,preventDefault(){}});assert.equal(f.form.values.note,'An unsaved revised note');assert(f.error.innerHTML.includes('data-action="reload-sales"'));assert(f.form.dataset.requestKey);assert.equal(h.requests.filter(r=>r.init.method==='POST').length,1);
  h.setConfirm(false);await h.ui.action({dataset:{action:'reload-sales'}});assert(!h.requests.some(r=>r.url==='/api/sales'));assert(h.nodes.get('#dialog').open);
  h.setConfirm(true);await assert.rejects(()=>h.ui.action({dataset:{action:'reload-sales'}}),/Sales could not refresh/);assert(h.nodes.get('#dialog').open);assert.equal(f.form.values.note,'An unsaved revised note');assert.equal(h.requests.filter(r=>r.init.method==='POST').length,1);
});

test('accepted conflict reload refreshes authoritative records for finding and editing the original activity',async()=>{
  const h=await harness({sales:manualData({activities:[salesActivity({context:'Original committed activity'})]})});h.ui.state.sales=manualData({activities:[]});h.ui.state.view='sales';h.ui.state.tab='activities';h.ui.openDialog('Conflict','<p>Reload the saved records.</p>');
  await h.ui.action({dataset:{action:'reload-sales'}});assert.equal(h.nodes.get('#dialog').open,false);const html=h.nodes.get('#app').innerHTML;assert(html.includes('Original committed activity'));assert(html.includes('data-action="edit-activity"'));assert(!h.requests.some(r=>['POST','PATCH','DELETE'].includes(r.init.method)));
});
