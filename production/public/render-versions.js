import {icon} from './icons.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=value=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(Number(value)/1048576)+' MiB';
const date=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(value));
const image=(id,variant='preview')=>'/api/renders/'+encodeURIComponent(id)+'/content?variant='+variant;
const options=(items,current)=>items.map(item=>`<option value="${esc(item.id)}" ${item.id===current?'selected':''}>Version ${item.number} · ${esc(item.file_name)}</option>`).join('');

export function createRenderVersions({request,openDialog,getRecord,getData,getProject,getContext,isCurrent,onBusy,canLeave,onChanged,toast}){
 let epoch=0,intent=0,pending=null,xhr=null,review=null;
 const state={recordId:'',items:[],pending:[],total:0,nextBefore:null,can_upload:false,error:''};
 const capture=()=>({epoch,record:getRecord()?.id,actor:getData()?.actor?.id,parent:getContext()});
 const current=c=>c.epoch===epoch&&c.record===getRecord()?.id&&c.actor===getData()?.actor?.id&&isCurrent(c.parent);
 const isBusy=()=>!!pending&&current(pending);
 const frozen=new Map();
 function syncBusy(){
  const busy=isBusy(),dialog=document.querySelector('#dialog');
  if(busy){
   for(const control of dialog?.querySelectorAll?.('button,input,select,textarea')||[]){
    if(control.dataset?.renderAction==='stop')continue;
    if(!frozen.has(control))frozen.set(control,control.disabled);
    control.disabled=true;
   }
  }else{
   for(const [control,disabled]of frozen)if(control.isConnected!==false)control.disabled=disabled;
   frozen.clear();
  }
  dialog?.querySelector?.('[data-render-canvas]')?.setAttribute?.('aria-disabled',String(busy));
  onBusy();
 }
 function reset(){epoch++;intent++;xhr?.abort();xhr=null;pending=null;review=null;syncBusy();Object.assign(state,{recordId:'',items:[],pending:[],total:0,nextBefore:null,can_upload:false,error:''});}
 async function load(record,append=false){
  if(getData()?.capabilities?.renders!=='versions')return;
  const c=capture(),version=++intent;state.recordId=record.id;state.error='';if(!append){state.items=[];state.pending=[];}
  try{const result=await request('/deliverables/'+encodeURIComponent(record.id)+'/renders'+(append&&state.nextBefore?'?before='+state.nextBefore:''));if(!current(c)||version!==intent)return;
   Object.assign(state,{...result,items:append?Array.from(new Map([...state.items,...result.items].map(item=>[item.id,item])).values()):result.items,recordId:record.id,error:''});
  }catch(error){if(current(c)&&version===intent){state.items=[];state.pending=[];state.error=error.message;}throw error;}
 }
 function summary(record){
  if(getData()?.capabilities?.renders!=='versions')return '';
  if(state.recordId!==record.id)return '<section class="detail-section"><h3>Render versions</h3><p>Loading private render history…</p></section>';
  const latest=state.items[0],pendingRows=state.pending.map(item=>`<div class="render-pending"><div><b>${esc(item.file_name)}</b><small>${item.status==='deleting'?'Cleanup pending':'Upload not verified'} · ${esc(size(item.byte_size))}</small></div><div class="filters">${item.status==='pending'&&item.can_retry?`<button type="button" class="button small" data-render-action="retry" data-id="${esc(item.id)}">Retry upload</button><button type="button" class="button text small" data-render-action="verify" data-id="${esc(item.id)}">Verify stored file</button>`:''}<button type="button" class="button text small" data-render-action="discard" data-id="${esc(item.id)}">Discard pending upload</button></div></div>`).join('');
  return `<section class="detail-section render-summary"><div class="spread"><h3>Render versions${state.total?' · '+state.total:''}</h3>${state.can_upload?'<button id="render-upload-trigger" type="button" class="button small" data-render-action="upload">'+icon('plus')+' Upload render</button>':''}</div>${state.error?`<p class="notice error" role="alert">${esc(state.error)}</p><button type="button" class="button" data-render-action="refresh">Retry render history</button>`:latest?`<button type="button" id="render-review-latest" class="render-preview" data-render-action="review" data-id="${esc(latest.id)}" aria-label="Review render version ${latest.number}"><img src="${image(latest.id)}" alt="${esc(record.code+' · '+record.title+' · version '+latest.number)}"><span>Version ${latest.number} · ${esc(latest.file_name)}</span></button><button type="button" class="button" data-render-action="review" data-id="${esc(latest.id)}">Review &amp; compare versions ${icon('arrow')}</button>`:`<p class="muted">${record.kind==='animation'?'Animation file review is not available yet.':'No render uploaded. Add the first JPEG or PNG to begin the image history.'}</p>`}${pendingRows}<p class="render-guidance">Render versions and feedback are private. Uploading a new version retains earlier images and feedback. No client approval is implied.</p></section>`;
 }
 function uploadForm(retryId=''){
  const record=getRecord();if(!record||!state.can_upload||!canLeave())return;
  const row=state.pending.find(item=>item.id===retryId);
  openDialog(row?'Retry render upload':'Upload render',`<form data-render-form="upload" data-record="${esc(record.id)}" data-version="${record.version}" data-retry-id="${esc(retryId)}"><div class="form-error" role="alert"></div><p class="muted">${esc(record.code+' · '+record.title)}</p>${row?`<p>Select the original ${esc(row.file_name)} (${esc(size(row.byte_size))}). Its fingerprint must match the pending upload.</p>`:''}<div class="field"><label for="render-file">${row?'Original render file':'Render file'}</label><input id="render-file" name="render_file" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required><small>JPEG or PNG · up to 50 MiB and 64 megapixels. The original file is retained.</small></div>${!row?'<div class="field"><label for="render-note">Version note</label><textarea id="render-note" name="note" rows="3" maxlength="2000" placeholder="What changed in this render?"></textarea></div>':''}<div class="upload-feedback" aria-live="polite"><p data-render-status>Choose a render to upload.</p><progress data-render-progress max="100" value="0" aria-label="Render upload progress"></progress></div><div data-render-recovery hidden><div data-render-reloaded></div><p>Your selected file is kept. Reload image details to review changes before retrying.</p><button type="button" class="button" data-render-action="reload-upload">Reload image details</button></div><div class="form-actions"><button type="button" class="button text" data-render-action="stop" disabled>Stop upload</button><button type="submit" class="button primary">Upload &amp; verify</button></div></form>`);
 }
 function transfer(plan,file,onProgress,stop){return new Promise((resolve,reject)=>{
  const operation=new XMLHttpRequest();xhr=operation;operation.open('PUT',plan.uploadUrl);operation.setRequestHeader('content-type',plan.mime);operation.setRequestHeader('cache-control','max-age=0');operation.setRequestHeader('x-upsert','false');stop.disabled=false;
  const end=()=>{stop.disabled=true;if(xhr===operation)xhr=null;};
  operation.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));};
  operation.onload=()=>{const status=operation.status;end();if(status>=200&&status<300||status===409)resolve();else reject(Error('The upload was interrupted. Retry the same file to reconnect.'));};
  operation.onerror=()=>{end();reject(Error('The upload connection was interrupted. Your selected file is kept.'));};operation.onabort=()=>{end();reject(Error('Upload stopped. Your original file is kept for retrying.'));};operation.send(file);
 });}
 async function upload(form){
  if(isBusy())return;const c=capture(),token={...c},record=getRecord();if(record?.id!==form.dataset.record)return;
  const status=form.querySelector('[data-render-status]'),progress=form.querySelector('[data-render-progress]'),error=form.querySelector('.form-error'),recovery=form.querySelector('[data-render-recovery]'),submit=form.querySelector('[type=submit]'),stop=form.querySelector('[data-render-action="stop"]'),fileInput=form.elements.render_file;
  const active=()=>current(c)&&form.isConnected!==false;
  const check=()=>{if(!active())throw Error('This upload view is no longer active.');};
  pending=token;syncBusy();form.__stopRequested=false;form.dataset.pending='1';submit.disabled=true;fileInput.disabled=true;error.textContent='';recovery.hidden=true;
  try{
   let plan=form.__renderPlan;
   if(plan?.status!=='ready'){
    const file=fileInput.files[0],mime=/\.png$/i.test(file?.name||'')?'image/png':/\.jpe?g$/i.test(file?.name||'')?'image/jpeg':'';
    if(!file||!file.size||file.size>50*1048576||!mime||file.type&&file.type!==mime)throw Error('Choose a JPEG or PNG render of at most 50 MiB.');
    status.textContent='Checking the selected render…';const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());check();const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    if(form.__renderRequest&&(form.__renderRequest.sha256!==sha256||form.__renderRequest.byte_size!==file.size))throw Error('This request is reserved for the original file. Select it again, or discard the pending upload before starting another.');
    if(plan?.id||form.dataset.retryId)plan=await request('/renders/'+encodeURIComponent(plan?.id||form.dataset.retryId)+'/upload','POST',{});
    else{form.dataset.requestKey||=crypto.randomUUID();form.__renderRequest||={expectedVersion:Number(form.dataset.version),file_name:file.name,mime,byte_size:file.size,sha256,note:form.elements.note?.value||''};if(form.elements.note)form.elements.note.readOnly=true;plan=await request('/deliverables/'+encodeURIComponent(record.id)+'/renders','POST',form.__renderRequest,{'Idempotency-Key':form.dataset.requestKey});}
    check();form.__renderPlan=plan;
    if(plan.status!=='ready'){
     if(plan.sha256!==sha256||plan.size!==file.size||plan.mime!==mime)throw Error('Select the original reserved file. Its size and fingerprint must match before retrying.');
     let uploadProblem;if(!plan.uploaded){status.textContent='Uploading privately…';try{await transfer(plan,file,value=>{if(active()){progress.value=value;status.textContent='Uploading privately… '+value+'%';}},stop);}catch(problem){check();if(form.__stopRequested)throw problem;uploadProblem=problem;}check();}
     status.textContent='Verifying the stored image and creating previews…';let result;try{result=await request('/renders/'+encodeURIComponent(plan.id)+'/finish','POST',{expectedVersion:Number(form.dataset.version)});}catch(problem){if(uploadProblem)problem.message=uploadProblem.message+' '+problem.message;throw problem;}check();form.__renderPlan={...plan,status:'ready',render:result};
    }
   }
   progress.value=100;status.textContent='Render verified. Refreshing image history…';await onChanged(record.id,'Render version saved');
  }catch(problem){if(active()){if([400,413].includes(problem.status)&&!form.__renderPlan){delete form.__renderRequest;delete form.dataset.requestKey;if(form.elements.note)form.elements.note.readOnly=false;}error.textContent=problem.message;status.textContent=form.__renderPlan?.status==='ready'?'Render saved. Retry to refresh the image history.':'This upload is not verified. Your selected file is kept.';recovery.hidden=false;submit.textContent=form.__renderPlan?.status==='ready'?'Refresh image history':'Retry upload & verify';}}
  finally{if(pending===token)pending=null;syncBusy();if(form.isConnected!==false){delete form.dataset.pending;submit.disabled=false;fileInput.disabled=false;stop.disabled=true;}}
 }
 async function comments(rid,page=1){return request('/renders/'+encodeURIComponent(rid)+'/comments?page='+page);}
 async function openReview(rid,guard=true){
  if(isBusy()||guard&&!canLeave())return;const c=capture(),version=++intent,record=getRecord(),dialog=document.querySelector('#dialog'),surface=dialog?.querySelector('.deliverable-detail,.render-review'),selected=state.items.find(item=>item.id===rid);if(!selected)return;
  const feedback=await comments(rid);if(!current(c)||version!==intent||!dialog?.open||surface?.isConnected===false)return;review={record,rid,compare:'',feedback};showReview();
 }
 function showReview(){
  const record=getRecord(),selected=state.items.find(item=>item.id===review.rid),other=state.items.find(item=>item.id===review.compare);if(!selected)return;
  const pins=review.feedback.items.filter(item=>item.point_x!==null&&item.point_y!==null);
  const canvas=(item,main=false)=>`<figure class="render-figure"><div class="render-image-wrap"><img class="render-image" src="${image(item.id)}" alt="${esc(record.code+' · '+record.title+' · version '+item.number)}" ${main&&canComment?'data-render-canvas tabindex="0" role="button" aria-label="Choose a point on the render for feedback"':''}>${main?pins.map((pin,index)=>`<button type="button" id="render-pin-${esc(pin.id)}" class="render-pin" style="left:${Number(pin.point_x)*100}%;top:${Number(pin.point_y)*100}%" data-render-action="focus-comment" data-id="${esc(pin.id)}" aria-label="Read feedback marker ${pin.number}">${pin.number}</button>`).join('')+'<span class="render-pin render-draft-pin" data-render-draft-pin hidden aria-hidden="true">+</span>':''}</div><figcaption>Version ${item.number} · ${esc(item.note||item.file_name)}</figcaption></figure>`;
  const feedback=review.feedback.items.map((item,index)=>`<article class="render-comment" id="render-comment-${esc(item.id)}" tabindex="-1"><div class="spread"><b>${esc(item.author_name)}</b><small>${esc(date(item.created_at))}</small></div><p>${esc(item.body)}</p>${item.point_x!==null?`<small>Image marker ${item.number}</small>`:''}</article>`).join('');
  const canComment=!record.archived&&!getProject()?.archived;
  openDialog(record.code+' · '+record.title,`<div class="render-review"><aside class="render-version-rail" aria-label="Render version history"><h3>Render versions</h3><p>${state.items.length} of ${state.total} versions</p>${state.items.map(item=>`<button type="button" id="render-version-${esc(item.id)}" class="render-version-item ${item.id===review.rid?'active':''}" data-render-action="select-version" data-id="${esc(item.id)}" aria-pressed="${item.id===review.rid}"><img src="${image(item.id,'thumbnail')}" alt="" loading="lazy"><span><b>Version ${item.number}</b><small>${esc(item.note||item.file_name)}</small><small>${esc(date(item.verified_at))}</small></span></button>`).join('')}${state.nextBefore?'<button type="button" class="button" data-render-action="more-versions">Load older versions</button>':''}</aside><main class="render-review-main"><div class="render-review-toolbar"><div><b>Version ${selected.number}</b><small>${selected.width} × ${selected.height} · ${esc(size(selected.byte_size))}</small></div><div class="filters"><label for="render-compare" class="sr-only">Compare with version</label><select id="render-compare" data-render-compare><option value="">No comparison</option>${options(state.items.filter(item=>item.id!==selected.id),review.compare)}</select><a class="button" href="${image(selected.id,'original')}" download>Download original ${icon('arrow')}</a></div></div><div class="render-canvases ${other?'comparing':''}">${canvas(selected,true)}${other?canvas(other):''}</div><section class="render-feedback" aria-labelledby="render-feedback-title"><h3 id="render-feedback-title">Internal feedback · version ${selected.number}</h3>${feedback||'<p class="muted">No feedback on this version yet.</p>'}<small>${review.feedback.items.length} of ${review.feedback.total} comments</small>${review.feedback.hasMore?'<button type="button" class="button small" id="render-more-comments" data-render-action="more-comments">Load earlier feedback</button>':''}${canComment?`<form data-render-form="comment" data-id="${esc(selected.id)}"><div class="form-error" role="alert"></div><div class="field"><label for="render-feedback-body">Add internal feedback</label><textarea id="render-feedback-body" name="body" required maxlength="5000" rows="3" placeholder="Describe the adjustment for this render version."></textarea></div><div class="spread"><span data-render-pin-label>Click the image to add a marker, or press Enter on the image to use its centre.</span><button type="button" class="button text small" data-render-action="clear-marker">Clear marker</button></div><div class="form-actions"><button type="submit" class="button primary" id="render-post-feedback">Post feedback</button></div></form>`:''}</section></main></div>`,{drawer:false});
 }
 async function postComment(form){
  if(isBusy())return;const c=capture(),token={...c},rid=form.dataset.id,field=form.elements.body,error=form.querySelector('.form-error'),submit=form.querySelector('[type=submit]');
  pending=token;syncBusy();field.readOnly=true;submit.disabled=true;error.textContent='';form.dataset.pending='1';
  try{form.dataset.requestKey||=crypto.randomUUID();form.__request||={body:field.value,point_x:form.dataset.x===undefined?null:Number(form.dataset.x),point_y:form.dataset.y===undefined?null:Number(form.dataset.y)};
   const result=await request('/renders/'+encodeURIComponent(rid)+'/comments','POST',form.__request,{'Idempotency-Key':form.dataset.requestKey});if(!current(c)||review?.rid!==rid)return;review.feedback=result;pending=null;syncBusy();showReview();toast('Feedback saved to version '+state.items.find(item=>item.id===rid).number);
  }catch(problem){if(current(c)&&form.isConnected!==false){error.textContent=problem.message;submit.textContent='Retry feedback';if(problem.status===400){delete form.__request;delete form.dataset.requestKey;field.readOnly=false;}}}
  finally{if(pending===token)pending=null;syncBusy();if(form.isConnected!==false){delete form.dataset.pending;submit.disabled=false;}}
 }
 document.addEventListener('submit',event=>{const form=event.target;if(!form.dataset?.renderForm)return;event.preventDefault();(form.dataset.renderForm==='upload'?upload(form):postComment(form)).catch(problem=>toast(problem.message));});
 document.addEventListener('change',event=>{if(!event.target.matches?.('[data-render-compare]')||!review||isBusy())return;const field=event.target;if(!canLeave()){field.value=review.compare;return;}review.compare=field.value;showReview();});
 function placeMarker(target,x,y){const dialog=document.querySelector('#dialog'),form=dialog?.querySelector('[data-render-form="comment"]');if(!form||isBusy()||form.__request)return;form.dataset.x=String(x);form.dataset.y=String(y);const pin=dialog.querySelector('[data-render-draft-pin]');pin.style.left=x*100+'%';pin.style.top=y*100+'%';pin.hidden=false;form.querySelector('[data-render-pin-label]').textContent='Image marker selected';form.elements.body.focus();}
 document.addEventListener('click',event=>{if(event.target.matches?.('[data-render-canvas]')){const bounds=event.target.getBoundingClientRect();placeMarker(event.target,Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height)));return;}
  const target=event.target.closest?.('[data-render-action]');if(!target)return;event.preventDefault();const action=target.dataset.renderAction;
  if(action==='stop'){const form=target.closest('[data-render-form]');if(form)form.__stopRequested=true;xhr?.abort();return;}if(isBusy())return;
  const run=async()=>{
   if(action==='upload'||action==='retry'){uploadForm(action==='retry'?target.dataset.id:'');return;}
   if(action==='review'||action==='select-version'){await openReview(target.dataset.id);return;}
   if(action==='refresh'){if(canLeave())await onChanged(getRecord().id);return;}
   if(action==='clear-marker'){const form=target.closest('form');if(form.__request)return;delete form.dataset.x;delete form.dataset.y;document.querySelector('[data-render-draft-pin]').hidden=true;form.querySelector('[data-render-pin-label]').textContent='No image marker selected';return;}
   if(action==='focus-comment'){document.getElementById('render-comment-'+target.dataset.id)?.focus();return;}
   if(action==='more-versions'){if(!canLeave())return;const surface=document.querySelector('.render-review');await load(getRecord(),true);if(review&&surface?.isConnected&&document.querySelector('#dialog')?.open)showReview();return;}
   if(action==='more-comments'){if(!canLeave())return;const c=capture(),rid=review.rid,surface=document.querySelector('.render-review'),result=await comments(rid,review.feedback.page+1);if(!current(c)||review?.rid!==rid||!surface?.isConnected||!document.querySelector('#dialog')?.open)return;review.feedback={...result,items:Array.from(new Map([...review.feedback.items,...result.items].map(item=>[item.id,item])).values())};showReview();return;}
   if(action==='reload-upload'){const form=target.closest('form'),c=capture(),record=await request('/deliverables/'+encodeURIComponent(form.dataset.record));if(!current(c)||form.isConnected===false)return;if(record.archived||!record.can_edit)throw Error('This image is no longer available for uploads. Your selected file is kept.');form.dataset.version=String(record.version);form.querySelector('[data-render-reloaded]').innerHTML='<dl class="deliverable-meta"><div><dt>Latest production stage</dt><dd>'+esc(record.stage)+'</dd></div><div><dt>Assigned artist</dt><dd>'+esc(getData()?.members?.find(person=>person.id===record.artist_id)?.name||'Assigned project artist')+'</dd></div></dl><p class="brief-copy">'+esc(record.camera_notes||'No camera brief has been added.')+'</p>';form.querySelector('[data-render-status]').textContent='Image details reloaded: '+record.code+' · '+record.title+'. Your file is kept; retry when ready.';return;}
   if(!['discard','verify'].includes(action)||!canLeave())return;
   if(action==='discard'&&!confirm('Discard this unverified upload? Verified versions and feedback will be retained.'))return;
   const c=capture(),token={...c},record=getRecord();pending=token;syncBusy();target.disabled=true;
   try{await request('/renders/'+encodeURIComponent(target.dataset.id)+(action==='discard'?'/cancel':'/finish'),'POST',action==='discard'?{}:{expectedVersion:record.version});if(current(c))await onChanged(record.id,action==='discard'?'Pending upload discarded':'Render version saved');}finally{if(pending===token)pending=null;syncBusy();target.disabled=false;}
  };run().catch(problem=>toast(problem.message));
 });
 document.addEventListener('keydown',event=>{if(event.target.matches?.('[data-render-canvas]')&&['Enter',' '].includes(event.key)){event.preventDefault();placeMarker(event.target,0.5,0.5);}});
 document.addEventListener('error',event=>{const img=event.target;if(!img.matches?.('.render-image,.render-preview img'))return;const parent=img.closest('figure,.render-preview');if(parent&&!parent.querySelector('[data-render-image-error]'))parent.insertAdjacentHTML('beforeend','<p data-render-image-error role="alert">The private preview could not load. Reopen this version to retry or check your project access.</p>');},true);
 return {load,summary,reset,isBusy,syncBusy,getState:()=>state};
}
