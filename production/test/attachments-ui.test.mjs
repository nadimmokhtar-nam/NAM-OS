import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Actual attachment factory, simulated DOM/HTTP. No native file-picker,
// Storage-policy or live-byte verification claim follows from these tests.
const source=(await readFile(new URL('../public/attachments.js',import.meta.url),'utf8')).replace('export function','function');
function fixture({actor={id:'uploader',role:'artist'},result={id:'file-1',status:'ready',cleanupPending:false},fail,failRefresh=false}={}){
  const listeners={},toasts=[],requests=[],refreshes=[],forms=[];
  const context=vm.createContext({Uint8Array,String,Math,Number,Set,Map,Array,encodeURIComponent,btoa,confirm:()=>true,document:{addEventListener(type,listener){listeners[type]=listener;},querySelectorAll(){return forms;}}});
  const create=vm.runInContext(source+';createTaskAttachments',context);
  const ui=create({getActor:()=>actor,request:async(...args)=>{requests.push(args);if(fail)throw new Error(fail);return result;},onChange:async id=>{refreshes.push(id);if(failRefresh)throw Error('Refresh unavailable');},toast:message=>toasts.push(message)});
  return {ui,listeners,toasts,requests,refreshes,forms};
}
const task=files=>({id:'task-1',attachments:files});
const file=values=>({id:'file-1',name:'Lighting notes.txt',mime:'text/plain',size:20,status:'ready',created_by:'uploader',cleanupPending:false,...values});
function uploadForm(){const error={textContent:''},submit={disabled:false},input={value:'selected',files:[{name:'Lighting notes.txt',type:'text/plain',size:4,async arrayBuffer(){return Uint8Array.from([78,65,77,10]).buffer;}}],focus(){this.focused=true;},click(){this.clicked=true;}};const form={dataset:{fileForm:'task-1'},querySelector(selector){return selector==='.form-error'?error:selector==='[type=submit]'?submit:selector==='input[type=file]'?input:null;}};return {form,error,submit,input};}
function clickTarget(dataset){const button={dataset,disabled:false};return {button,event:{preventDefault(){},target:{closest(selector){return selector==='[data-file-remove]'&&dataset.fileRemove||selector==='[data-file-retry]'&&dataset.fileRetry||selector==='[data-file-refresh]'&&dataset.fileRefresh?button:null;}}}};}

test('only ready, cleanup-free attachments expose a download link',()=>{
  const h=fixture();const ready=h.ui.render(task([file()]));assert(ready.includes('href="/api/attachments/file-1"'));assert(ready.includes('Ready to download'));
  for(const pendingFile of [file({status:'pending',cleanupPending:true}),file({status:'deleting',cleanupPending:true}),file({cleanupPending:true}),file({status:'unknown'})]){const html=h.ui.render(task([pendingFile]));assert(!html.includes('href="/api/attachments/'));assert(html.includes('Refresh status'));}
  assert(h.ui.render(task([file({status:'pending'})])).includes('Upload incomplete'));assert(h.ui.render(task([file({status:'deleting'})])).includes('Storage cleanup pending'));
});
test('pending retry/remove controls follow uploader and founder capabilities',()=>{
  const pending=file({status:'pending',cleanupPending:true});const own=fixture().ui.render(task([pending]));assert(own.includes('data-file-retry'));assert(own.includes('Remove pending upload'));
  const founder=fixture({actor:{id:'founder',role:'founder'}}).ui.render(task([pending]));assert(!founder.includes('data-file-retry'));assert(founder.includes('Remove pending upload'));
  const other=fixture({actor:{id:'other',role:'artist'}}).ui.render(task([pending]));assert(!other.includes('data-file-remove'));assert(!other.includes('data-file-retry'));assert(other.includes('Ask the original uploader'));
});
test('nonready upload responses preserve selected file and never announce saved success',async()=>{
  for(const result of [{id:'file-1',status:'pending',cleanupPending:true},{id:'file-1',status:'deleting',cleanupPending:true},{id:'file-1',status:'ready',cleanupPending:true},{}]){const h=fixture({result}),f=uploadForm();await h.listeners.submit({target:f.form,preventDefault(){}});assert(f.error.textContent.includes('not ready'));assert.equal(f.input.value,'selected');assert(!h.toasts.some(t=>t.startsWith('Attachment saved')));assert.equal(f.submit.disabled,false);assert.equal(h.refreshes.length,1);assert(h.ui.render(task([])).includes('not ready'));}
});
test('verified ready upload alone can announce saved, with accurate refresh failure',async()=>{
  const h=fixture(),f=uploadForm();await h.listeners.submit({target:f.form,preventDefault(){}});assert.deepEqual(h.toasts,['Attachment saved']);assert.equal(f.input.value,'');assert.equal(f.error.textContent,'');
  const stale=fixture({failRefresh:true}),g=uploadForm();await stale.listeners.submit({target:g.form,preventDefault(){}});assert(g.error.textContent.includes('saved, but the task could not refresh'));assert.deepEqual(stale.toasts,['Attachment saved. Refresh the task to view it.']);
});
test('cleanup-pending removal response cannot produce an attachment-removed success',async()=>{
  for(const result of [{ok:true,cleanupPending:true},{ok:true,status:'deleting'},{ok:false},{}]){const h=fixture({result}),c=clickTarget({fileRemove:'file-1',fileTask:'task-1'});await h.listeners.click(c.event);assert(h.toasts.some(t=>t.includes('not confirmed removed')));assert(!h.toasts.some(t=>t.startsWith('Attachment removed')));assert.equal(c.button.disabled,false);assert(h.ui.render(task([file({status:'deleting'})])).includes('not confirmed removed'));}
});
test('cleanup failure stays visible and permits a later retry instead of false success',async()=>{
  const h=fixture({fail:'Private storage cleanup is pending. Retry removing the file.'}),c=clickTarget({fileRemove:'file-1',fileTask:'task-1'});await h.listeners.click(c.event);assert.equal(h.requests.length,1);assert.equal(h.refreshes.length,1);assert(!h.toasts.includes('Attachment removed'));const html=h.ui.render(task([file({status:'deleting',cleanupPending:true})]));assert(html.includes('Retry removal'));assert(html.includes('Private storage cleanup is pending'));assert(!html.includes('href="/api/attachments/'));
  const good=fixture({result:{ok:true}}),next=clickTarget({fileRemove:'file-1',fileTask:'task-1'});await good.listeners.click(next.event);assert.deepEqual(good.toasts,['Attachment removed']);
});
test('retry upload requests the original file without pretending to resume or save it',async()=>{
  const h=fixture(),f=uploadForm();h.forms.push(f.form);const c=clickTarget({fileRetry:'file-1',fileTask:'task-1',fileName:'Lighting notes.txt'});await h.listeners.click(c.event);assert(f.input.focused);assert(f.input.clicked);assert(f.error.textContent.includes('Choose the same original file: Lighting notes.txt'));assert.equal(h.requests.length,0);assert.equal(h.toasts.length,0);
});
test('deleted attachments stay absent and hostile filenames remain literal',()=>{
  const h=fixture();assert(!h.ui.render(task([file({status:'deleted'})])).includes('Lighting notes.txt'));const html=h.ui.render(task([file({name:'<img src=x onerror=alert(1)>.txt',status:'pending'})]));assert(html.includes('&lt;img'));assert(!html.includes('<img src=x'));assert(!html.includes('href="/api/attachments/'));
});
