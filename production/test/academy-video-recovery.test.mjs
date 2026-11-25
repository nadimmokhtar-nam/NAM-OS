import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {loadBrowserModule} from './support/browser-module.mjs';

// Execute the actual upload controller. Only the DOM, Storage transport and
// permission-checked API boundary are simulated; native playback/RLS have their
// separate provider tests. A committed-but-unread reservation is retained here.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const failure=(message,status)=>Object.assign(new Error(message),{status});
const videoFile=(name='lighting.mp4',text='original synthetic media')=>new File([text],name,{type:'video/mp4'});

async function harness(){
 const listeners={},requests=[],transfers=[],messages=[],reservations=new Map(),transferResults=[];
 const server={id:'course-one',title:'Interior lighting',revision:1,archived:false,lessons:[{id:'lesson-one',title:'Balance daylight'}],videos:[]};
 let current=structuredClone(server),serial=0,reserveLost=0,finishLost=0,finishConflict=0,refreshFailure=0,refreshHold=null,refreshCalls=0;
 const forms=new Set(),closeListeners=new Set();
 const dialog={open:true,addEventListener(type,fn){if(type==='close')closeListeners.add(fn);},removeEventListener(type,fn){if(type==='close')closeListeners.delete(fn);},contains:form=>forms.has(form),close(){this.open=false;for(const form of forms)form.isConnected=false;for(const listener of [...closeListeners])listener();closeListeners.clear();}};
 const document={addEventListener(type,listener){(listeners[type]??=[]).push(listener);},querySelector(selector){return selector==='#dialog'?dialog:null;}};
 class XMLHttpRequest{
  constructor(){this.upload={};this.headers={};}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(key,value){this.headers[key]=value;}
  send(file){this.file=file;transfers.push(this);const outcome=transferResults.shift()??201;this.outcome=outcome;if(outcome!=='hold')queueMicrotask(()=>this.complete(outcome));}
  complete(status=201){if(this.ended)return;this.ended=true;if(status==='network'){this.onerror();return;}this.status=status;this.upload.onprogress?.({lengthComputable:true,loaded:this.file.size,total:this.file.size});this.onload();}
  abort(){if(this.ended)return;this.ended=true;this.onabort?.();}
 }
 const plan=reservation=>({id:reservation.id,status:reservation.status,courseRevision:server.revision,...(reservation.status==='pending'?{uploadUrl:'https://private-storage.invalid/upload/'+(++serial),fileName:reservation.payload.file_name,mime:reservation.payload.mime,size:reservation.payload.byte_size,sha256:reservation.payload.sha256}:{})});
 const request=async(path,method='GET',body,headers={})=>{
  requests.push({path,method,body:structuredClone(body),headers:structuredClone(headers)});
  if(path==='/academy/videos'&&method==='POST'){
   const key=headers['Idempotency-Key'];let reservation=reservations.get(key);
   if(!reservation){if(body.expectedRevision!==server.revision)throw failure('The course changed. Reload before uploading.',409);reservation={id:'video-'+(reservations.size+1),status:'pending',payload:structuredClone(body)};reservations.set(key,reservation);server.revision++;}
   else{const exact=value=>{const result={...value};delete result.expectedRevision;return result;};assert.deepEqual(exact(body),exact(reservation.payload),'retry must preserve the original payload');}
   const response=plan(reservation);if(reserveLost-->0)throw failure('The reservation response was interrupted.',503);return response;
  }
  const match=/^\/academy\/videos\/(video-\d+)\/(upload|finish)$/.exec(path);
  if(match){const reservation=[...reservations.values()].find(row=>row.id===match[1]);assert(reservation,'request must refer to a reserved row');
   if(match[2]==='upload')return plan(reservation);
   if(finishConflict-->0)server.revision++;
   if(body.expectedRevision!==server.revision)throw failure('The course changed while uploading. Review the latest draft.',409);
   if(reservation.status!=='ready'){reservation.status='ready';server.revision++;}
   const response={id:reservation.id,status:'ready',courseRevision:server.revision};if(finishLost-->0)throw failure('The verification response was interrupted.',503);return response;
  }
  if(path==='/academy/admin/courses/'+server.id)return structuredClone(server);
  throw new Error('Unexpected request '+path);
 };
 const context=vm.createContext({document,XMLHttpRequest,crypto:{subtle:webcrypto.subtle,randomUUID},DOMException,Intl,Date,Map,Set,JSON,String,Number,Uint8Array,encodeURIComponent,confirm:()=>true});
 const {createAcademyVideo}=await loadBrowserModule(context,'academy-video.js');
 let openedHTML='';
 const module=createAcademyVideo({request,openDialog(title,html){openedHTML=html;},toast:message=>messages.push(message),getCourse:()=>current,onChange:async()=>{refreshCalls++;if(refreshHold)await refreshHold;if(refreshFailure-->0)throw failure('Course refresh unavailable.',503);current=structuredClone(server);dialog.close();}});
 function form(file=videoFile(),retryId=''){
  const nodes={'.form-error':{textContent:''},'[data-upload-status]':{textContent:''},'[data-upload-progress]':{value:0},'[data-upload-recovery]':{hidden:true},'[type=submit]':{disabled:false,textContent:'Upload & verify'}};
  const elements={video_file:{files:[file],required:true},caption_file:{files:[],disabled:false},title:{value:'Daylight study',readOnly:false},lesson_id:{value:'lesson-one',disabled:false}};
  if(retryId){delete elements.caption_file;delete elements.title;delete elements.lesson_id;}
  const result={dataset:{videoForm:'upload',course:server.id,revision:String(current.revision),retryId},isConnected:true,elements,querySelector:selector=>nodes[selector]??null,nodes};forms.add(result);return result;
 }
 async function emit(type,target){for(const listener of listeners[type]||[])await listener({target,preventDefault(){}});await tick();}
 async function settle(form){for(let i=0;i<1000&&form.dataset.pending;i++)await tick();assert(!form.dataset.pending,'upload must settle');}
 async function submit(form){await emit('submit',form);await settle(form);}
 async function select(form,file){form.elements.video_file.files=file?[file]:[];await emit('change',{id:'video-file',files:form.elements.video_file.files,closest:()=>form});}
 async function reload(form){const button={dataset:{videoAction:'reload-upload'},disabled:false,closest:selector=>selector==='[data-video-action]'?button:selector==='[data-video-form]'?form:null};await emit('click',button);return button;}
 return {module,server,requests,transfers,messages,reservations,transferResults,dialog,closeListeners,form,submit,emit,select,reload,settle,get refreshCalls(){return refreshCalls;},get current(){return current;},get openedHTML(){return openedHTML;},loseReserve(count=1){reserveLost=count;},loseFinish(count=1){finishLost=count;},conflictFinish(count=1){finishConflict=count;},failRefresh(count=1){refreshFailure=count;},holdRefresh(promise){refreshHold=promise;}};
}

test('expired private upload connections renew on every retry without reserving another row',async()=>{
 const h=await harness(),form=h.form();h.transferResults.push(403,403,201);
 await h.submit(form);assert.match(form.nodes['.form-error'].textContent,/renew/);assert.equal(form.elements.video_file.files.length,1);assert(!h.module.isUploading());
 await h.submit(form);await h.submit(form);
 assert.equal(h.reservations.size,1);assert.equal(h.requests.filter(r=>r.path==='/academy/videos').length,1);
 assert.equal(h.requests.filter(r=>r.path.endsWith('/upload')).length,2);assert.equal(new Set(h.transfers.map(t=>t.url)).size,3);assert.equal(h.refreshCalls,1);assert.equal(h.closeListeners.size,0);
});

test('lost reservation responses replay the exact request and key after reselecting the original file',async()=>{
 const h=await harness(),file=videoFile(),form=h.form(file);h.loseReserve();await h.submit(form);
 const key=form.dataset.requestKey,request=form.__uploadRequest;assert.equal(h.reservations.size,1);assert.equal(form.elements.title.readOnly,true);assert.equal(form.elements.lesson_id.disabled,true);
 await h.select(form,file);assert.equal(form.dataset.requestKey,key);assert.equal(form.__uploadRequest,request);await h.submit(form);
 const reserved=h.requests.filter(r=>r.path==='/academy/videos');assert.equal(reserved.length,2);assert.deepEqual(reserved[0].headers,reserved[1].headers);assert.deepEqual(reserved[0].body,reserved[1].body);assert.equal(h.reservations.size,1);assert.equal(h.transfers.length,1);assert.equal(h.refreshCalls,1);
});

test('choosing another file preserves the original reservation and refuses duplicate or mismatched uploads',async()=>{
 const h=await harness(),original=videoFile(),form=h.form(original);h.transferResults.push('network');await h.submit(form);
 const key=form.dataset.requestKey;await h.select(form,videoFile('different.mp4','different bytes'));await h.submit(form);
 assert.match(form.nodes['.form-error'].textContent,/reserved for lighting\.mp4/);assert.equal(form.dataset.requestKey,key);assert.equal(h.reservations.size,1);assert.equal(h.transfers.length,1);
 await h.select(form,original);await h.submit(form);assert.equal(h.reservations.size,1);assert.equal(h.transfers.length,2);assert.equal(h.refreshCalls,1);
});

test('a stale verification keeps the selected file and reloads course details before retrying its same reservation',async()=>{
 const h=await harness(),file=videoFile(),form=h.form(file);h.conflictFinish();await h.submit(form);
 assert.match(form.nodes['.form-error'].textContent,/changed while uploading/);assert.equal(form.nodes['[data-upload-recovery]'].hidden,false);
 h.server.title='Updated course title';const button=await h.reload(form);
 assert(!button.disabled);assert.equal(form.elements.video_file.files[0],file);assert.equal(form.dataset.revision,String(h.server.revision));assert.match(form.nodes['[data-upload-status]'].textContent,/Updated course title/);
 h.transferResults.push(409);await h.submit(form);assert.equal(h.reservations.size,1);assert.equal(h.refreshCalls,1);assert.equal(h.requests.filter(r=>r.path.endsWith('/finish')).length,2);
});

test('a reservation rejected for a changed course rebases only after an explicit reload and retains its draft',async()=>{
 const h=await harness(),file=videoFile(),form=h.form(file);h.server.revision=4;await h.submit(form);
 assert.equal(h.reservations.size,0);assert.match(form.nodes['.form-error'].textContent,/changed/);const key=form.dataset.requestKey;
 await h.reload(form);assert.equal(form.__uploadRequest.expectedRevision,4);assert.equal(form.elements.video_file.files[0],file);assert.equal(form.elements.title.value,'Daylight study');assert.equal(form.dataset.requestKey,key);
 await h.submit(form);assert.equal(h.reservations.size,1);assert.equal(h.refreshCalls,1);
});

test('reload refuses a removed lesson or archived course without discarding the selected file',async()=>{
 const h=await harness(),file=videoFile(),form=h.form(file);h.loseReserve();await h.submit(form);const originalRevision=form.__uploadRequest.expectedRevision;
 h.server.lessons=[];await h.reload(form);assert.match(form.nodes['.form-error'].textContent,/lesson was removed/);assert.equal(form.__uploadRequest.expectedRevision,originalRevision);assert.equal(form.elements.video_file.files[0],file);
 h.server.archived=true;await h.reload(form);assert.match(form.nodes['.form-error'].textContent,/no longer available/);assert.equal(form.elements.video_file.files[0],file);assert.equal(h.reservations.size,1);
});

test('a verified video whose course refresh fails retries only the refresh and reports the saved state honestly',async()=>{
 const h=await harness(),form=h.form();h.failRefresh();await h.submit(form);
 assert.equal(form.__uploadPlan.status,'ready');assert.equal(form.elements.video_file.required,false);assert.match(form.nodes['[data-upload-status]'].textContent,/Video verified, but/);assert.equal(form.nodes['[type=submit]'].textContent,'Refresh course');
 const requests=h.requests.length;await h.select(form,null);await h.submit(form);
 assert.equal(h.requests.length,requests);assert.equal(h.transfers.length,1);assert.equal(h.refreshCalls,2);assert.equal(h.reservations.size,1);
});

test('a lost verification response discovers the ready video without transferring or verifying it again',async()=>{
 const h=await harness(),form=h.form();h.loseFinish();await h.submit(form);assert.equal(h.reservations.size,1);assert.equal([...h.reservations.values()][0].status,'ready');
 await h.submit(form);assert.equal(h.transfers.length,1);assert.equal(h.requests.filter(r=>r.path.endsWith('/finish')).length,1);assert.equal(h.requests.filter(r=>r.path.endsWith('/upload')).length,1);assert.equal(h.refreshCalls,1);
});

test('repeated submissions stay guarded during transfer and the subsequent course refresh',async()=>{
 const h=await harness(),form=h.form();h.transferResults.push('hold');let release;h.holdRefresh(new Promise(resolve=>release=resolve));
 await h.emit('submit',form);for(let i=0;i<100&&!h.transfers.length;i++)await tick();assert.equal(h.transfers.length,1);
 await h.emit('submit',form);assert.equal(h.transfers.length,1);h.transfers[0].complete();for(let i=0;i<100&&!h.refreshCalls;i++)await tick();assert(h.module.isUploading());
 await h.emit('submit',form);assert.equal(h.refreshCalls,1);assert.equal(h.reservations.size,1);release();await h.settle(form);assert(!h.module.isUploading());
});

test('closing an in-flight upload aborts its transport and cannot report or refresh a later success',async()=>{
 const h=await harness(),form=h.form();h.transferResults.push('hold');await h.emit('submit',form);for(let i=0;i<100&&!h.transfers.length;i++)await tick();assert.equal(h.transfers.length,1);
 h.dialog.close();await h.settle(form);assert(!h.module.isUploading());assert.equal(h.refreshCalls,0);assert.equal(h.requests.filter(r=>r.path.endsWith('/finish')).length,0);assert.equal(h.closeListeners.size,0);assert.equal(form.nodes['.form-error'].textContent,'');
});

test('invalid local files fail before reservation and leave authoring fields editable',async()=>{
 const h=await harness(),form=h.form(videoFile('not-video.txt'));await h.submit(form);assert.equal(h.requests.length,0);assert.equal(form.elements.title.readOnly,false);assert.equal(form.elements.lesson_id.disabled,false);assert.match(form.nodes['.form-error'].textContent,/MP4 or WebM/);
});
