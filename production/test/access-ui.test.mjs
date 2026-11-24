import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Actual access-editor actions against bounded DOM/request stubs. Visual,
// native dialog and keyboard behaviour remain real-browser acceptance gates.
async function harness({conflict=false,denied=false}={}){
 const listeners={},messages=[],requests=[],dialogs=[],inputs=[{dataset:{accessSection:'sales'},checked:true},{dataset:{accessSection:'academy'},checked:true},{dataset:{accessSection:'operations'},checked:true}],creates=new Map(inputs.map(input=>[input.dataset.accessSection,{checked:true,disabled:false}]));
 const region={innerHTML:'',textContent:'',focus(){this.focused=true;}},options={innerHTML:''},submit={disabled:false,isConnected:true,setAttribute(){},removeAttribute(){}},dialog={dataset:{},open:true,addEventListener(type,fn){(this.listeners??={})[type]=fn;},close(){this.open=false;this.listeners?.close?.();}};let activeForm=true;
 const form={elements:{role:{value:'sales'}},matches:s=>s==='form[data-access-form]',querySelectorAll:()=>inputs,querySelector(selector){if(selector==='.form-error')return region;if(selector==='[type=submit]')return submit;if(selector==='#access-section-options')return options;const section=selector.match(/data-access-create="([^"]+)"/)?.[1];return section?creates.get(section):null;}};
 const document={querySelector(selector){return selector==='form[data-access-form]'?(activeForm?form:null):selector==='#dialog'?dialog:null;},addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
 const record={id:'sales-id',name:'Sales member',role:'sales',revision:3,editable:true,grants:inputs.map(input=>({section:input.dataset.accessSection,can_create:true,scope:'assigned_only'}))};
 const context=vm.createContext({document,window:{addEventListener(){}},confirm:()=>true,console,Array,Object,Set,Map});const source=(await readFile(new URL('../public/access-admin.js',import.meta.url),'utf8')).replace(/^export /gm,'');const factory=vm.runInContext(`(()=>{${source};return createAccessAdmin;})()`,context);
 const editor=factory({request:async(path,method='GET',body)=>{requests.push({path,method,body});if(method==='PATCH'){if(conflict)throw Object.assign(new Error('Access changed elsewhere'),{status:409});if(denied)throw Object.assign(new Error('Access revoked'),{status:403});return {...record,revision:4};}return structuredClone(record);},openDialog:(title,body)=>dialogs.push({title,body}),toast:message=>messages.push(message),onChange:async()=>{activeForm=false;}});
 const dispatch=async(type,event)=>{for(const fn of listeners[type]||[])await fn(event);};await editor.open(record.id);return {editor,dispatch,form,inputs,creates,region,options,submit,dialogs,requests,messages,record,dialog};
}
test('changing role keeps only explicitly retained compatible grants and never selects newly eligible sections',async()=>{
 const h=await harness();h.form.elements.role.value='artist';await h.dispatch('change',{target:{id:'access-role',value:'artist',closest:()=>h.form}});const html=h.options.innerHTML;assert(html.includes('data-access-section="projects"'));assert(!html.match(/data-access-section="projects"[^>]*checked/));assert(!html.match(/data-access-section="library"[^>]*checked/));assert(html.match(/data-access-section="academy"[^>]*checked/));assert(!html.includes('data-access-section="sales"'));assert(h.dialogs[0].body.includes('Managed teams require a separate scope'));
});
test('removing section access also unchecks and disables task creation',async()=>{
 const h=await harness(),section=h.inputs[0];section.checked=false;await h.dispatch('change',{target:{dataset:section.dataset,checked:false,closest:()=>h.form}});assert.equal(h.creates.get('sales').checked,false);assert.equal(h.creates.get('sales').disabled,true);
});
test('stale access save retains the editable draft, current revision and explicit reload action',async()=>{
 const h=await harness({conflict:true});await h.dispatch('submit',{target:h.form,preventDefault(){}});const request=h.requests.find(r=>r.method==='PATCH');assert.equal(request.body.expectedRevision,3);assert.equal(request.body.role,'sales');assert(h.region.innerHTML.includes('Access changed elsewhere'));assert(h.region.innerHTML.includes('Reload current access'));assert.equal(h.submit.disabled,false);assert.equal(h.form.elements.role.value,'sales');
});
test('revoked administration closes protected editor instead of retrying the mutation',async()=>{
 const h=await harness({denied:true});await h.dispatch('submit',{target:h.form,preventDefault(){}});assert.equal(h.dialog.open,false);assert.equal(h.requests.filter(r=>r.method==='PATCH').length,1);assert(h.messages.includes('Access revoked'));
});
