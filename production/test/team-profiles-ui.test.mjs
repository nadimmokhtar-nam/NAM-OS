import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const profile={id:'sales-user',name:'Sales colleague',job_title:'Account manager',department:null,revision:3,notifications:{assignment:true,due:true,overdue:true}};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function harness({role='sales',transport,confirm=true,onChange=async()=>{}}={}){
 const listeners={},requests=[],messages=[],dialogs=[],forms=[],confirmations=[];let data={actor:{id:profile.id,role}},confirmed=confirm,renders=0;
 const dialog={dataset:{},listeners:{},addEventListener(kind,fn){(this.listeners[kind]??=[]).push(fn);},close(){this.closed=true;for(const fn of this.listeners.close||[])fn();}};
 const document={querySelector(selector){if(selector==='#dialog')return dialog;if(selector==='form[data-team-form]')return forms[0];return null;},querySelectorAll(){return forms;},addEventListener(kind,fn){(listeners[kind]??=[]).push(fn);}};
 class FormDataStub{constructor(form){this.values=form.values;}get(key){const value=this.values[key];return value===undefined||value===false?null:value===true?'on':value;}has(key){return this.get(key)!==null;}*[Symbol.iterator](){for(const key of Object.keys(this.values))if(this.has(key))yield [key,this.get(key)];}}
 const ctx=vm.createContext({document,window:{addEventListener(){}},crypto:{randomUUID:()=>`team-ui-key-${requests.length}`},FormData:FormDataStub,confirm:message=>{confirmations.push(message);return confirmed;},console,Array,Object,Number,String,Set,Map,WeakSet});
 const source=(await readFile(new URL('../public/team-profiles.js',import.meta.url),'utf8')).replace(/^export /gm,'');const factory=vm.runInContext(`(()=>{${source};return createTeamProfiles;})()`,ctx);
 const request=async(path,method='GET',body,headers)=>{requests.push({path,method,body:structuredClone(body),headers});if(transport){const result=await transport({path,method,body,headers,requests});if(result!==undefined)return result;}if(path.startsWith('/team/directory'))return {items:[{...profile,role:'sales'}],total:1,page:1,pageSize:50,hasMore:false};if(path.startsWith('/team/departments'))return {items:[],total:0,page:1,pageSize:50,hasMore:false};return structuredClone(profile);};
 const ui=factory({request,getData:()=>data,contextKey:()=>data.view||'settings',openDialog:(title,body)=>dialogs.push({title,body}),toast:message=>messages.push(message),render:()=>renders++,onChange});
 const dispatch=async(kind,event)=>{for(const fn of listeners[kind]||[])await fn(event);};
 function form(kind,values){
  const region={innerHTML:'',textContent:'',focus(){this.focused=true;}},controls=Object.keys(values).map(name=>({name,type:typeof values[name]==='boolean'?'checkbox':'text',disabled:false})),submit={type:'submit',disabled:false};
  const result={dataset:{teamForm:kind},values,region,controls:[...controls,submit],matches:selector=>selector==='form[data-team-form]',querySelector:selector=>selector==='.form-error'?region:null,querySelectorAll:()=>result.controls};forms.push(result);return result;
 }
 const submit=form=>dispatch('submit',{target:form,preventDefault(){}});
 const input=form=>dispatch('input',{target:{closest:selector=>selector==='form[data-team-form]'?form:null}});
 const click=async(action,extra={})=>{const element={dataset:{teamAction:action,...extra},disabled:false};return dispatch('click',{target:{closest:selector=>selector==='[data-team-action]'?element:null},preventDefault(){}});};
 return {ui,form,submit,input,click,requests,messages,dialogs,dialog,confirmations,get renders(){return renders;},setConfirm:value=>confirmed=value,setData:value=>data=value};
}

test('settings use a dedicated navigation, named compact profile fields and only three real inbox events',async()=>{
 const h=await harness();await h.ui.loadSettings();let html=h.ui.settings('<p>Existing security controls</p>');assert(html.includes('aria-label="Settings"'));assert(html.includes('Professional profile'));assert(html.includes('autocomplete="organization-title"'));assert(!html.includes('Departments</button>'));
 await h.click('tab',{tab:'notifications'});html=h.ui.settings();for(const event of ['assignment','due','overdue'])assert.equal((html.match(new RegExp(`name="${event}"`,'g'))||[]).length,1);assert(html.includes('Save preferences'));assert(html.includes('scheduled daily reminder'));assert(!html.includes('name="email"'));assert(!html.includes('name="comment"'));assert(!/style=/.test(html));
 await h.click('tab',{tab:'account'});assert(h.ui.settings('<p>Existing security controls</p>').includes('Existing security controls'));
});

test('preference submit uses the saved revision and actual supported booleans',async()=>{
 const h=await harness({transport:({method,body})=>method==='PATCH'?{...profile,revision:4,notifications:body.changes}:undefined});await h.ui.loadSettings();await h.click('tab',{tab:'notifications'});
 const form=h.form('notifications',{assignment:true,due:false,overdue:true});await h.input(form);await h.submit(form);
 const write=h.requests.find(row=>row.method==='PATCH');assert.equal(write.path,'/team/preferences');assert.deepEqual(write.body,{expectedRevision:3,changes:{assignment:true,due:false,overdue:true}});assert(write.headers['Idempotency-Key']);assert(h.messages.includes('Notification preferences saved.'));assert.equal(h.ui.canLeave(),true);assert(!h.ui.settings().match(/name="due"[^>]*checked/));
});

test('conflicting profile saves retain the draft and offer explicit reload; discard restores saved fields',async()=>{
 const h=await harness({confirm:false,transport:({method})=>{if(method==='PATCH')throw Object.assign(new Error('Profile changed elsewhere'),{status:409});}});await h.ui.loadSettings();const form=h.form('profile',{name:'Unsaved colleague',job_title:'Lead'});await h.input(form);await h.submit(form);
 assert(form.region.innerHTML.includes('Reload saved values'));assert.equal(form.controls.at(-1).disabled,false);assert(h.ui.settings().includes('Unsaved colleague'));assert.equal(h.ui.canLeave(),false);h.setConfirm(true);assert.equal(h.ui.canLeave(),true);assert(h.ui.settings().includes('Sales colleague'));assert(!h.ui.settings().includes('Unsaved colleague'));
});

test('ambiguous saves lock editing and retain the exact key/body across retry and rerender',async()=>{
 let attempts=0;const h=await harness({transport:({method,body})=>{if(method!=='PATCH')return;if(++attempts===1)throw new Error('Connection lost after save');return {...profile,name:body.changes.name,job_title:body.changes.job_title,revision:4};}});await h.ui.loadSettings();const form=h.form('profile',{name:'Exact retry name',job_title:'Coordinator'});await h.input(form);await h.submit(form);assert(form.region.innerHTML.includes('retry exactly the same request'));assert(form.controls.filter(control=>control.type!=='submit').every(control=>control.disabled));assert.equal(form.controls.at(-1).disabled,false);
 h.ui.settings();const replacement=h.form('profile',{name:'A different visible value',job_title:'Different'});await h.submit(replacement);const writes=h.requests.filter(row=>row.method==='PATCH');assert.equal(writes.length,2);assert.deepEqual(writes[1].body,writes[0].body);assert.equal(writes[1].headers['Idempotency-Key'],writes[0].headers['Idempotency-Key']);assert(h.ui.settings().includes('Exact retry name'));
});

test('an in-flight save prevents navigation, and reset rejects stale success for another account',async()=>{
 const hold=deferred(),h=await harness({transport:({method})=>method==='PATCH'?hold.promise:undefined});await h.ui.loadSettings();const form=h.form('profile',{name:'Pending name',job_title:'Lead'}),saving=h.submit(form);await Promise.resolve();assert.equal(h.ui.isBusy(),true);assert.equal(h.ui.canLeave(),false);
 h.ui.reset();h.setData({actor:{id:'other-user',role:'sales'}});hold.resolve({...profile,name:'Pending name',revision:4});await saving;assert(!h.ui.settings().includes('Pending name'));assert(!h.messages.includes('Profile saved.'));
});

test('revoked metadata authority clears protected content and closes the active editor',async()=>{
 const h=await harness({transport:({method})=>{if(method==='PATCH')throw Object.assign(new Error('Session ended'),{status:403});}});await h.ui.loadSettings();const form=h.form('profile',{name:'Saved name',job_title:'Lead'});await h.submit(form);assert(h.dialog.closed);assert(h.messages.includes('Session ended'));assert(!h.ui.settings().includes('Saved name'));assert.equal(h.ui.isBusy(),false);
});

test('Founder directory delegates invitations and access to existing controls and escapes metadata',async()=>{
 const h=await harness({role:'founder',transport:({path})=>path.startsWith('/team/directory')?{items:[{...profile,name:'<img onerror=alert(1)>',job_title:'<b>Lead</b>',role:'sales'}],total:1,page:1,pageSize:50,hasMore:false}:undefined});await h.ui.loadDirectory();const html=h.ui.directory();assert(html.includes('data-security-action="invite"'));assert(html.includes('data-access-action="open"'));assert(html.includes('data-team-action="member-department"'));assert(html.includes('&lt;img onerror=alert(1)&gt;'));assert(!html.includes('<img onerror'));assert(html.includes('Founder Team access'));
 const ordinary=await harness();assert(!ordinary.ui.directory().includes('data-security-action="invite"'));
});

test('department dialogs guard native Escape while an unsaved draft exists',async()=>{
 const h=await harness({role:'founder',confirm:false});await h.ui.loadSettings();await h.click('new-department');const form=h.form('department',{department_name:'Production',archived:false});await h.input(form);let prevented=false;for(const listener of h.dialog.listeners.cancel||[])listener({preventDefault(){prevented=true;}});assert(prevented);assert(h.dialogs[0].body.includes('New assignments require an active department'));
});

test('a background profile response cannot replace a draft typed while it was loading',async()=>{
 const hold=deferred();let reads=0;const h=await harness({transport:({path,method})=>path==='/team/profile'&&method==='GET'&&++reads===2?hold.promise:undefined});await h.ui.loadSettings();const refreshing=h.ui.loadSettings(),form=h.form('profile',{name:'My new draft',job_title:'Lead'});await h.input(form);hold.resolve({...profile,name:'New saved value elsewhere',revision:4});await refreshing;assert(h.ui.settings().includes('My new draft'));assert(!h.ui.settings().includes('New saved value elsewhere'));
 const before=h.requests.length;await h.ui.loadSettings();assert.equal(h.requests.length,before);
});

test('malformed preference metadata fails closed instead of presenting unchecked event controls',async()=>{
 const h=await harness({transport:({path})=>path==='/team/profile'?{...profile,notifications:{assignment:true,due:'true',overdue:true}}:undefined});await assert.rejects(h.ui.loadSettings(),/could not be verified/);assert(h.ui.settings().includes('role="alert"'));assert(!h.ui.settings().includes('Save profile'));
});

test('late directory replies cannot overwrite the latest requested page',async()=>{
 const hold=deferred();let reads=0;const h=await harness({role:'founder',transport:({path})=>path.startsWith('/team/directory')&&++reads===1?hold.promise:undefined});const old=h.ui.loadDirectory();await h.ui.loadDirectory();hold.resolve({items:[{...profile,name:'Stale directory name',role:'sales'}],total:1,page:1,pageSize:50,hasMore:false});await old;assert(h.ui.directory().includes('Sales colleague'));assert(!h.ui.directory().includes('Stale directory name'));
});


test('department dialogs stay open and guarded until the saved directory refresh finishes',async()=>{
 const hold=deferred();let refreshing;
 const began=new Promise(resolve=>refreshing=resolve);
 const h=await harness({role:'founder',onChange:async()=>{refreshing();await hold.promise;},transport:({method})=>method==='POST'?{id:'new-department',name:'Production',revision:1}:undefined});
 await h.ui.loadSettings();await h.click('new-department');
 const form=h.form('department',{department_name:'Production',archived:false}),saving=h.submit(form);
 await began;assert.equal(h.ui.isBusy(),true);assert.equal(h.ui.canLeave(),false);assert.notEqual(h.dialog.closed,true);assert(form.controls.every(control=>control.disabled));
 hold.resolve();await saving;
 assert.equal(h.dialog.closed,true);assert.equal(h.ui.isBusy(),false);assert.equal(h.ui.canLeave(),true);
});
