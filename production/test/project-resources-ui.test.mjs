import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

const uuid=()=>randomUUID();
const settle=async()=>{for(let n=0;n<16;n++)await new Promise(done=>setImmediate(done));};
const uploadTransition=async ready=>{const deadline=Date.now()+2000;while(!ready()){assert(Date.now()<deadline,'The expected upload transition did not arrive.');await new Promise(done=>setTimeout(done,5));}};
async function harness(request,{cryptoProvider=webcrypto}={}){
 const listeners={},dialogs=[],messages=[],forms=new Map(),created=[];let closed=0,project={id:'project-one',title:'Courtyard',archived:false},actor={id:'founder',role:'founder'},route='files';
 const document={addEventListener(event,handler){(listeners[event]??=[]).push(handler);},querySelector(selector){if(selector==='#dialog')return {close(){closed++;}};return forms.get(selector)||null;},querySelectorAll(){return [];},createElement(){const value={innerHTML:'',className:''};created.push(value);return value;}};
 class FormData{constructor(form){this.values=form.values||{};}get(key){return this.values[key]??null;}has(key){return Object.hasOwn(this.values,key);}}
 const context=vm.createContext({Intl,Date,URL,URLSearchParams,FormData,crypto:cryptoProvider,Uint8Array,ArrayBuffer,document,globalThis:undefined});context.globalThis=context;context.confirm=()=>true;
 const module=await loadBrowserModule(context,'project-resources.js');
 const controller=module.createProjectResources({request,openDialog(title,html){dialogs.push({title,html});},getData:()=>({actor,members:[],capabilities:{projectResources:'records'}}),getProject:()=>project,render(){},toast(message){messages.push(message);},contextKey:()=>route});
 const emit=(type,target)=>{for(const listener of listeners[type]||[])listener({target,preventDefault(){}});};
 const click=(action,data={},form=null)=>{const control={dataset:{resourceAction:action,...data},disabled:false,closest(selector){return selector==='form'?form:this;}};emit('click',control);return control;};
 const change=(dataset,value)=>emit('change',{dataset,value,matches(){return false;}});
 return {controller,module,dialogs,messages,created,forms,click,change,emit,closed:()=>closed,project(value){project=value;},actor(value){actor=value;},route(value){route=value;}};
}
const row=(extra={})=>({id:uuid(),kind:'note',title:'Site notes',visibility:'project',version:1,parent_id:null,reference_url:'',status:'ready',created_at:'2026-11-25T12:00:00Z',document:{body:'Agreed direction'},...extra});
const result=items=>({items,total:items.length,page:1,hasMore:false,can_manage:true});

test('file browser uses saved records, exact columns and explicit visibility without inline styling or fabricated image assets',async()=>{
 const h=await harness(async()=>result([row({title:'Oak <script>',kind:'file',mime:'image/png',byte_size:12456,visibility:'founder'}),row({title:'A folder',kind:'folder'})]));await h.controller.load('files');const html=h.controller.render();
 for(const name of ['Name','Type','Size','Created','Visibility','Upload file','New folder','Create file','Founder only','Project team'])assert(html.includes(name));assert(html.includes('Oak &lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('style='));assert(!html.includes('unsplash'));assert(!html.includes('picsum'));
 h.actor({id:'artist',role:'artist'});const artist=h.controller.render();assert(!artist.includes('data-resource-action="upload"'));assert(!artist.includes('data-resource-action="edit"'));
});

test('a slow previous project read cannot replace the new project and denied refreshes clear stale resource names',async()=>{
 let release,deny=false;const delayed=new Promise(done=>release=done),h=await harness(url=>url.includes('project-one')?delayed:deny?Promise.reject(Error('Access revoked')):Promise.resolve(result([row({title:'Current file'})])));
 const old=h.controller.load();h.project({id:'project-two',title:'Two'});await h.controller.load();release(result([row({title:'PRIVATE OLD NOTE'})]));await old;assert(!h.controller.render().includes('PRIVATE OLD NOTE'));assert(h.controller.render().includes('Current file'));
 deny=true;await assert.rejects(h.controller.load());assert.equal(h.controller.getState().page,null);assert(!h.controller.render().includes('Current file'));assert(h.controller.render().includes('Access revoked'));
});

test('notes and references request their real bounded views; search and folder controls keep their chosen scope',async()=>{
 const calls=[],folder=uuid(),h=await harness(async url=>{calls.push(url);return result([]);});await h.controller.load('notes');assert.equal(new URL('https://example.com'+calls.at(-1)).searchParams.get('kind'),'notes');await h.controller.load('references');assert.equal(new URL('https://example.com'+calls.at(-1)).searchParams.get('kind'),'references');
 await h.controller.load('files');h.click('folder',{id:folder});await settle();assert.equal(new URL('https://example.com'+calls.at(-1)).searchParams.get('folder'),folder);
 h.emit('submit',{dataset:{resourceForm:'search'},values:{search:'oak'}});await settle();const url=new URL('https://example.com'+calls.at(-1));assert.equal(url.searchParams.get('search'),'oak');assert.equal(url.searchParams.get('page'),'1');assert.equal(url.searchParams.get('folder'),folder);
});

function metadataForm(record,values){
 const nodes={'.form-error':{textContent:''},'.resource-conflict-detail':{innerHTML:''}};
 const form={dataset:{resourceForm:'metadata',id:record.id,version:String(record.version),kind:record.kind},values,isConnected:true,querySelector(selector){return nodes[selector]||null;},querySelectorAll(){return [];}};return {form,nodes};
}
test('structured meeting notes persist date, attendees, agenda, decisions and actions through one stable request',async()=>{
 const calls=[],h=await harness(async(url,method,body,headers)=>{calls.push({url,method,body,headers});return row({kind:'meeting',document:body.changes.document});}),{form}=metadataForm({id:'',version:0,kind:'meeting'},{title:'Design review',visibility:'project',date:'2026-11-25',attendees:'Client, Nadim',agenda:'Finish schedule',decisions:'Oak approved',actions:'Send two samples',reference_url:''});
 h.emit('submit',form);await settle();assert.equal(calls[0].method,'POST');assert.equal(calls[0].body.changes.kind,'meeting');assert.deepEqual({...calls[0].body.changes.document},{date:'2026-11-25',attendees:'Client, Nadim',agenda:'Finish schedule',decisions:'Oak approved',actions:'Send two samples'});assert(calls[0].headers['Idempotency-Key']);assert(h.closed()>0);
});

test('a note conflict retains the draft and only explicit review acknowledgement adopts the current saved version',async()=>{
 const original=row(),latest={...original,version:2,document:{body:'Other editor decision'}},writes=[],h=await harness(async(url,method,body)=>{if(method==='PATCH'){writes.push(body);if(writes.length===1)throw Object.assign(Error('Changed elsewhere'),{status:409});return {...latest,document:body.changes.document};}if(url.endsWith('/'+original.id))return latest;return result([]);});
 const {form,nodes}=metadataForm(original,{title:'My retained title',visibility:'project',body:'My retained decision',reference_url:''});h.emit('submit',form);await settle();assert.equal(form.dataset.version,'1');assert.equal(form.values.body,'My retained decision');assert(nodes['.resource-conflict-detail'].innerHTML.includes('Other editor decision'));
 h.click('metadata-use-latest',{},form);assert.equal(form.dataset.version,'2');h.emit('submit',form);await settle();assert.equal(writes[1].expectedVersion,2);assert.equal(writes[1].changes.document.body,'My retained decision');
});

test('uncertain note saves retry the exact original payload and identity instead of replacing an unconfirmed write',async()=>{
 const original=row(),writes=[],h=await harness(async(url,method,body,headers)=>{if(method==='PATCH'){writes.push({body:JSON.stringify(body),key:headers['Idempotency-Key']});if(writes.length===1)throw Error('Network lost after save');return original;}return result([]);}),{form}=metadataForm(original,{title:'Original retry',visibility:'founder',body:'Original body',reference_url:''});
 h.emit('submit',form);await settle();form.values.body='Unconfirmed later edit';h.emit('submit',form);await settle();assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
});

test('pinboard sections, captions and order persist while stale-save conflicts retain the full local composition',async()=>{
 const first=uuid(),second=uuid(),a=uuid(),b=uuid(),original=row({kind:'board',title:'Direction',document:{sections:[{id:first,title:'Materials',items:[{id:a,file_id:uuid(),caption:'Oak',reference_url:''},{id:b,file_id:uuid(),caption:'Stone',reference_url:''}]},{id:second,title:'Light',items:[]}]}}),latest={...original,version:2,title:'Current saved board'},writes=[];
 const h=await harness(async(url,method,body)=>{if(method==='PATCH'){writes.push(body);if(writes.length===1)throw Object.assign(Error('Board changed'),{status:409});return {...latest,document:body.changes.document,version:3};}return url.includes('/resources/'+original.id)?latest:result([original]);});await h.controller.load('references');h.click('open',{id:original.id});await settle();h.click('board-edit');h.change({boardCaption:a},'Warm oak, retained');h.click('image-down',{section:first,id:a});h.click('section-up',{id:second});h.click('board-save');await settle();
 assert.equal(writes[0].expectedVersion,2);assert.equal(writes[0].changes.document.sections[0].id,second);assert.equal(writes[0].changes.document.sections[1].items[1].caption,'Warm oak, retained');assert(h.controller.render().includes('Warm oak, retained'));assert(h.controller.render().includes('Review saved version'));
 h.click('board-use-latest');h.click('board-save');await settle();assert.equal(writes[1].expectedVersion,2);assert.equal(writes[1].changes.document.sections[1].items[1].caption,'Warm oak, retained');assert(!h.controller.hasUnsavedChanges());assert(!h.controller.render().includes('style='));
});

test('pinboard typing marks an unsaved draft immediately before blur or navigation',async()=>{
 const section=uuid(),record=row({kind:'board',document:{sections:[{id:section,title:'Materials',items:[]}]}}),h=await harness(async url=>url.includes('/resources/'+record.id)?record:result([record]));await h.controller.load('references');h.click('open',{id:record.id});await settle();h.click('board-edit');assert.equal(h.controller.hasUnsavedChanges(),false);h.emit('input',{dataset:{boardSectionTitle:section},value:'Warm materials'});assert.equal(h.controller.hasUnsavedChanges(),true);assert(h.controller.render().includes('Warm materials'));
});

test('pinboard reordering never mutates the saved composition or loses an image at either endpoint',async()=>{
 const h=await harness(async()=>result([])),section=uuid(),a=uuid(),b=uuid(),document={sections:[{id:section,title:'One',items:[{id:a},{id:b}]}]},next=h.module.movePinboardItem(document,section,b,-1);assert.equal(next.sections[0].items[0].id,b);assert.equal(document.sections[0].items[0].id,a);assert.equal(h.module.movePinboardItem(next,section,b,-1).sections[0].items.length,2);
});

test('only public HTTPS links render as references and no remote URL becomes a server request or image source',async()=>{
 const h=await harness(async()=>result([]));for(const value of ['javascript:alert(1)','http://example.com/','https://user:pass@example.com/','https://127.0.0.1/','https://localhost/','https://example.com:444/','https://example.com/\\evil'])assert.equal(h.module.safeProjectReference(value),'');assert.equal(h.module.safeProjectReference('https://example.com/specification#oak'),'https://example.com/specification#oak');
});

test('an upload metadata conflict requires a visible sharing review and acknowledgement before retrying its finish',async()=>{
 const cryptoProvider={randomUUID,subtle:{async digest(...args){await new Promise(resolve=>setTimeout(resolve,25));return webcrypto.subtle.digest(...args);}}};
 const id=uuid(),content=Buffer.from('Studio upload fixture'),sha=createHash('sha256').update(content).digest('hex'),file={name:'Direction.txt',type:'text/plain',size:content.length,arrayBuffer:async()=>content.buffer.slice(content.byteOffset,content.byteOffset+content.length)},latest=row({id,kind:'file',title:'Shared direction',visibility:'project',version:2,file_name:file.name}),finish=[];let acknowledged=false;
 const h=await harness(async(url,method,body)=>{
  if(url.endsWith('/finish')){finish.push(body.expectedVersion);if(finish.length===1)throw Object.assign(Error('File sharing changed'),{status:409});return {...latest,status:'ready'};}
  if(url.endsWith('/upload')||method==='POST')return {id,status:'pending',uploaded:true,mime:file.type,sha256:sha,size:file.size,fileName:file.name,expectedVersion:acknowledged?2:1};
  if(url.endsWith('/'+id))return latest;return result([]);
 },{cryptoProvider});
 const nodes={'.form-error':{textContent:''},'[name="file"]':{files:[file],disabled:false},'[name="title"]':{value:'Founder direction'},'[name="visibility"]':{value:'founder'},'.resource-upload-progress':{hidden:true},'.resource-upload-recovery':{hidden:true},'[role="status"]':{textContent:''},'[data-resource-action="upload-stop"]':{disabled:true},'.form-actions':{before(){}}};
 const form={dataset:{resourceForm:'upload',id:'',version:''},isConnected:true,querySelector(selector){return selector==='.resource-upload-conflict'?h.created.at(-1)||null:nodes[selector]||null;},querySelectorAll(){return [];}};
 h.emit('submit',form);await uploadTransition(()=>!!form._resourceUpload?.latest&&!h.controller.isSaving());assert.equal(form._resourceUpload.expectedVersion,1);assert.equal(form._resourceUpload.latest.visibility,'project');assert(h.created.at(-1).innerHTML.includes('Project team'));assert(h.created.at(-1).innerHTML.includes('Shared direction'));
 h.emit('submit',form);await uploadTransition(()=>nodes['.form-error'].textContent.includes('Review the changed file metadata'));assert.deepEqual(finish,[1]);h.click('upload-use-latest',{},form);acknowledged=true;h.emit('submit',form);await uploadTransition(()=>finish.length===2&&!h.controller.isSaving());assert.deepEqual(finish,[1,2]);
});
