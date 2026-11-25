import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {loadBrowserModule} from './support/browser-module.mjs';

const bytes=Buffer.from('Synthetic transport bytes; actual image decoding is tested at the server boundary.'),digest=createHash('sha256').update(bytes).digest('hex');
const render=(extra={})=>({id:'render-one',number:1,file_name:'living-room.png',width:100,height:60,byte_size:bytes.length,note:'Initial material direction',verified_at:'2030-01-01T12:00:00Z',...extra});
const versionPage={items:[render()],total:1,pending:[],nextBefore:null,can_upload:true};
const commentPage={items:[],total:0,page:1,hasMore:false};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function settle(){for(let n=0;n<25;n++)await new Promise(setImmediate);}
async function harness(intercept){
 let route=1,allowed=true,failRefresh=false,surface={isConnected:true},form=null,autoTransfer=true,transferStatus=200;const calls=[],listeners={},dialogs=[],messages=[],changed=[],transfers=[];
 const data={actor:{id:'artist'},capabilities:{renders:'versions'}},record={id:'camera-one',code:'INT-01',title:'Living room hero',kind:'still',version:1,archived:false};
 const dialog={open:true,querySelector(selector){return selector==='.deliverable-detail,.render-review'?surface:form;}};
 const document={querySelector(selector){return selector==='#dialog'?dialog:selector==='.render-review'?surface:null;},getElementById(){return null;},addEventListener(type,listener){(listeners[type]??=[]).push(listener);}};
 const sandbox=vm.createContext({document,Intl,Date,URLSearchParams,crypto:globalThis.crypto,confirm:()=>true,XMLHttpRequest:class{constructor(){this.upload={};this.status=transferStatus;transfers.push(this);}open(){}setRequestHeader(){}send(){if(autoTransfer)queueMicrotask(()=>this.onload());}abort(){this.onabort?.();}}});
 const {createRenderVersions}=await loadBrowserModule(sandbox,'render-versions.js');
 const ui=createRenderVersions({request:async(...args)=>{calls.push(structuredClone(args));const result=await intercept?.(...args);if(result!==undefined)return result;
  if(args[0].startsWith('/deliverables/'))return args[1]==='POST'?{id:'render-one',status:'pending',uploadUrl:'https://storage.invalid/upload',sha256:digest,size:bytes.length,mime:'image/png'}:structuredClone(versionPage);
  if(args[0].endsWith('/upload'))return {id:'render-one',status:'pending',uploadUrl:'https://storage.invalid/upload',sha256:digest,size:bytes.length,mime:'image/png'};
  if(args[0].endsWith('/finish'))return {...render(),status:'ready'};
  return structuredClone(commentPage);
 },openDialog(title,html,options){surface.isConnected=false;surface={isConnected:true};dialogs.push({title,html,options});dialog.open=true;},getRecord:()=>record,getData:()=>data,getProject:()=>({id:'project',archived:false}),getContext:()=>({route}),isCurrent:c=>c.route===route,onBusy(){},canLeave:()=>allowed,onChanged:async(id,message)=>{changed.push({id,message});if(failRefresh)throw Error('The image view could not refresh.');},toast:message=>messages.push(message)});
 return {ui,record,data,calls,dialogs,messages,changed,dialog,transfers,setRoute(value){route=value;},allow(value){allowed=value;},autoTransfer(value){autoTransfer=value;},transferStatus(value){transferStatus=value;},failRefresh(value){failRefresh=value;},
  async click(action,id){for(const listener of listeners.click||[])listener({preventDefault(){},target:{matches:()=>false,closest:()=>({dataset:{renderAction:action,id},disabled:false,closest:()=>form})}});await settle();},
  file(name='living-room.png',content=bytes){return {name,type:'image/png',size:content.length,arrayBuffer:async()=>Uint8Array.from(content).buffer};},
  form(file){const error={textContent:''},status={textContent:''},progress={value:0},recovery={hidden:true},submit={disabled:false},stop={disabled:true};form={dataset:{renderForm:'upload',record:record.id,version:'1',retryId:''},isConnected:true,elements:{render_file:{files:[file],disabled:false},note:{value:'Initial pass',readOnly:false}},querySelector:selector=>({'.form-error':error,'[data-render-status]':status,'[data-render-progress]':progress,'[data-render-recovery]':recovery,'[type=submit]':submit,'[data-render-action="stop"]':stop})[selector]};return {form,error,status,progress,recovery,submit,stop};},
  async submit(form){for(const listener of listeners.submit||[])listener({preventDefault(){},target:form});await settle();}
 };
}

test('the render summary displays real private preview identity and escapes version metadata',async()=>{
 const h=await harness();await h.ui.load(h.record);const html=h.ui.summary(h.record);assert(html.includes('/api/renders/render-one/content?variant=preview'));assert(html.includes('Version 1'));assert(!html.includes('Approved'));assert(html.includes('Upload render'));
 h.record.title='<script>image</script>';assert(!h.ui.summary(h.record).includes('<script>'));h.data.capabilities.renders=undefined;assert.equal(h.ui.summary(h.record),'');
});

test('a closed review cannot be reopened by an older feedback lookup',async()=>{
 const held=deferred(),h=await harness(path=>path.includes('/comments')?held.promise:undefined);await h.ui.load(h.record);await h.click('review','render-one');h.dialog.open=false;held.resolve(commentPage);await settle();assert.equal(h.dialogs.length,0);
});

test('old identity and route responses cannot populate a later render history',async()=>{
 const held=deferred(),h=await harness(()=>held.promise),reading=h.ui.load(h.record);h.setRoute(2);h.data.actor.id='different-user';held.resolve(versionPage);await reading;assert.equal(h.ui.getState().items.length,0);
});

test('opening a different version respects the existing feedback draft guard',async()=>{
 const h=await harness();await h.ui.load(h.record);h.allow(false);await h.click('review','render-one');assert.equal(h.dialogs.length,0);assert.equal(h.calls.length,1);
});

test('a lost reservation response replays the original key and payload while retaining the selected file',async()=>{
 let reservations=0;const h=await harness((path,method)=>{if(path.startsWith('/deliverables/')&&method==='POST'&&++reservations===1)throw Object.assign(Error('Reservation response lost'),{status:503});});await h.ui.load(h.record);const f=h.form(h.file());await h.submit(f.form);assert.equal(f.form.elements.render_file.files[0].name,'living-room.png');assert.equal(f.recovery.hidden,false);const initial=h.calls.find(([,method])=>method==='POST');
 f.form.elements.note.value='An edit after the unacknowledged request';await h.submit(f.form);const replay=h.calls.filter(([path,method])=>path.startsWith('/deliverables/')&&method==='POST');assert.equal(replay.length,2);assert.deepEqual(replay[0],replay[1]);assert.equal(h.changed.length,1);assert.equal(h.transfers.length,1);assert(initial[3]['Idempotency-Key']);
});

test('pending transfers prevent duplicate saves and an explicit Stop retains a retryable reservation',async()=>{
 const h=await harness();await h.ui.load(h.record);h.autoTransfer(false);const f=h.form(h.file());await h.submit(f.form);assert.equal(h.ui.isBusy(),true);assert.equal(f.form.elements.render_file.disabled,true);await h.submit(f.form);assert.equal(h.transfers.length,1);await h.click('stop');assert.equal(h.ui.isBusy(),false);assert.equal(f.form.elements.render_file.disabled,false);assert.match(f.error.textContent,/stopped/);assert.equal(f.form.__renderPlan.id,'render-one');
});

test('conflict retries reuse stored bytes and require an explicit updated image version',async()=>{
 let finishes=0;const h=await harness((path,method,body)=>{if(path.endsWith('/finish')&&++finishes===1)throw Object.assign(Error('Image changed elsewhere'),{status:409});if(path==='/deliverables/camera-one'&&method===undefined)return {...h.record,version:2,can_edit:true};});await h.ui.load(h.record);const f=h.form(h.file());await h.submit(f.form);assert.equal(h.changed.length,0);assert.equal(f.form.dataset.version,'1');assert.equal(f.form.elements.render_file.files[0].name,'living-room.png');
 // A reload changes only the captured version. The original reservation body
 // and nonce stay stable and the same selected file remains available.
 f.form.dataset.version='2';await h.submit(f.form);const calls=h.calls.filter(([path])=>path.endsWith('/finish'));assert.equal(calls[0][2].expectedVersion,1);assert.equal(calls[1][2].expectedVersion,2);assert.equal(h.calls.filter(([path,method])=>path.startsWith('/deliverables/')&&method==='POST').length,1);assert.equal(h.changed.length,1);
});

test('a saved render whose view could not refresh is refreshed without another upload or version',async()=>{
 const h=await harness();await h.ui.load(h.record);h.failRefresh(true);const f=h.form(h.file());await h.submit(f.form);assert.equal(h.transfers.length,1);assert.equal(f.form.__renderPlan.status,'ready');assert.match(f.error.textContent,/could not refresh/);h.failRefresh(false);await h.submit(f.form);assert.equal(h.transfers.length,1);assert.equal(h.calls.filter(([path])=>path.endsWith('/finish')).length,1);assert.equal(h.changed.length,2);
});

test('a duplicate or lost upload acknowledgement still checks the actual stored file before publishing',async()=>{
 const h=await harness();await h.ui.load(h.record);h.transferStatus(400);const f=h.form(h.file());await h.submit(f.form);assert.equal(h.changed.length,1);assert.equal(h.calls.filter(([path])=>path.endsWith('/finish')).length,1);assert.equal(f.form.__renderPlan.status,'ready');
});
