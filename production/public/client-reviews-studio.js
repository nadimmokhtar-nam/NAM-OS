import {icon} from './icons.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(value));
const path=id=>encodeURIComponent(id);

export function createStudioClientReviews({request,openDialog,getData,getProject,render,toast,canLeave=()=>true,onBusy=()=>{},contextKey=()=>''}){
 const state={projectId:'',tab:'requests',clients:[],clientPage:1,clientTotal:0,moreClients:false,requests:[],requestPage:1,requestTotal:0,moreRequests:false,error:'',loading:false};
 let generation=0,clientRead=0,reviewRead=0,opening=0,pending=null;
 const frozen=new Map();
 const capture=()=>({generation,actor:getData()?.actor?.id,project:getProject()?.id,key:contextKey()});
 const current=c=>c.generation===generation&&c.actor===getData()?.actor?.id&&c.project===getProject()?.id&&c.key===contextKey();
 const founder=()=>getData()?.actor?.role==='founder';
 const isSaving=()=>!!pending&&current(pending);
 function syncBusy(){const dialog=document.querySelector('#dialog');if(isSaving()){for(const control of dialog?.querySelectorAll?.('button,input,textarea,select')||[]){if(!frozen.has(control))frozen.set(control,control.disabled);control.disabled=true;}}else{for(const [control,disabled]of frozen)if(control.isConnected!==false)control.disabled=disabled;frozen.clear();}onBusy();}
 function reset(){generation++;clientRead++;reviewRead++;opening++;pending=null;syncBusy();Object.assign(state,{projectId:'',tab:'requests',clients:[],clientPage:1,clientTotal:0,moreClients:false,requests:[],requestPage:1,requestTotal:0,moreRequests:false,error:'',loading:false});}
 async function loadClients(append=false){const c=capture(),read=++clientRead,page=append?state.clientPage+1:1,result=await request('/projects/'+path(c.project)+'/clients?page='+page);if(!current(c)||read!==clientRead)return;state.clients=append?Array.from(new Map([...state.clients,...result.items].map(row=>[row.user_id,row])).values()):result.items;state.clientPage=result.page;state.clientTotal=result.total;state.moreClients=result.hasMore;}
 async function loadRequests(append=false){const c=capture(),read=++reviewRead,page=append?state.requestPage+1:1,result=await request('/projects/'+path(c.project)+'/reviews?page='+page);if(!current(c)||read!==reviewRead)return;state.requests=append?Array.from(new Map([...state.requests,...result.items].map(row=>[row.id,row])).values()):result.items;state.requestPage=result.page;state.requestTotal=result.total;state.moreRequests=result.hasMore;}
 async function load(){
  if(!founder()||getData()?.capabilities?.clientReviews!=='records')return;
  if(state.projectId!==getProject()?.id){reset();state.projectId=getProject()?.id||'';}
  const c=capture();state.loading=true;state.error='';
  try{await Promise.all([loadClients(),loadRequests()]);}catch(error){if(current(c))state.error=error.message;throw error;}finally{if(current(c))state.loading=false;}
 }
 function view(){
  if(!founder())return '<div class="empty">Client review requests are managed by the studio owner.</div>';
  const project=getProject(),actions=!project?.archived?`<button type="button" class="button primary" id="review-issue-trigger" data-review-action="issue">Issue review request</button>`:'';
  const heading=`<div class="page-head"><div><h1>Client reviews</h1><p>${esc(project?.title)}</p></div>${actions}</div><div class="tabs" aria-label="Client review views"><button class="tab ${state.tab==='requests'?'active':''}" type="button" data-review-action="tab" data-value="requests" aria-pressed="${state.tab==='requests'}">Requests</button><button class="tab ${state.tab==='clients'?'active':''}" type="button" data-review-action="tab" data-value="clients" aria-pressed="${state.tab==='clients'}">Clients</button></div>`;
  if(state.loading)return heading+'<div class="empty" role="status">Loading client reviews…</div>';
  if(state.error)return heading+`<div class="notice error" role="alert">${esc(state.error)}</div><button class="button" type="button" data-review-action="reload">Retry</button>`;
  if(state.tab==='clients')return heading+`<div class="toolbar"><p class="muted">Only issued images are shared with clients.</p>${!project?.archived?'<button type="button" class="button" data-review-action="new-client">Share with a client</button>':''}</div><div class="client-access-list">${state.clients.map(person=>`<button type="button" class="client-access-row" data-review-action="client" data-id="${esc(person.user_id)}"><span><b>${esc(person.name)}</b><small>${esc(person.email)}</small></span><span class="badge">${!person.active?'Access revoked':person.can_approve?'Can accept / reject':'View only'}</span>${icon('arrow')}</button>`).join('')||'<div class="empty"><b>No clients shared yet.</b><p>Add a client before issuing their first review request.</p></div>'}</div><div class="spread"><small>${state.clients.length} of ${state.clientTotal} clients</small>${state.moreClients?'<button type="button" class="button small" data-review-action="more-clients">Load more clients</button>':''}</div>`;
  return heading+`<p class="review-intro">Each request retains the images and responses from that round. New renders can be issued in a new request.</p><div class="studio-review-list">${state.requests.map(row=>{const expected=Number(row.image_count)*Number(row.approver_count),answered=Number(row.accepted_count)+Number(row.rejected_count);return `<button type="button" class="studio-review-row" data-review-action="request" data-id="${esc(row.id)}"><span><b>${esc(row.title)}</b><small>Request ${row.number} · ${row.image_count} ${Number(row.image_count)===1?'image':'images'} · ${esc(date(row.issued_at))}</small></span><span><small>${row.accepted_count} accepted · ${row.rejected_count} rejected</small><small>${expected?Math.max(0,expected-answered)+' responses pending':'View-only request'}</small></span><span class="badge">${esc(row.status==='issued'?'Issued':row.status==='closed'?'Closed':'Cancelled')}</span>${icon('arrow')}</button>`;}).join('')||'<div class="empty"><b>No review requests yet.</b><p>Upload verified renders, share with a client, then issue the selected images.</p></div>'}</div><div class="spread"><small>${state.requests.length} of ${state.requestTotal} review requests</small>${state.moreRequests?'<button type="button" class="button small" data-review-action="more-requests">Load older requests</button>':''}</div>`;
 }
 function clientForm(person=null,message='',guard=true){
  if(!founder()||isSaving()||guard&&!canLeave())return;opening++;
  const edit=!!person,archived=getProject()?.archived;
  openDialog(edit?person.name:'Share with a client',`<form data-review-form="client" data-user="${esc(person?.user_id||'')}" data-version="${person?.version||''}"><div class="form-error" role="alert"></div>${message?'<p class="notice" role="status">'+esc(message)+'</p>':''}<p class="muted">${esc(getProject()?.title)}</p><div class="field"><label for="review-client-name">Client name</label><input id="review-client-name" name="name" required maxlength="100" value="${esc(person?.name||'')}" ${edit?'readonly':''}></div><div class="field"><label for="review-client-email">Email address</label><input id="review-client-email" name="email" type="email" autocomplete="email" required maxlength="254" value="${esc(person?.email||'')}" ${edit?'readonly':''}></div><label class="review-check"><input type="checkbox" name="active" ${person?.active!==false?'checked':''} ${archived?'disabled':''}><span>Client can access issued reviews</span></label><label class="review-check"><input type="checkbox" name="can_approve" ${person?.can_approve?'checked':''} ${archived?'disabled':''}><span>Allow this client to accept or reject images</span></label><p class="muted">This permission applies only when the client is selected as a reviewer on an issued request.</p>${!edit?'<label class="review-check"><input type="checkbox" name="email_client" checked><span>Email a sign-in link after sharing</span></label>':''}<div class="form-actions">${edit&&person.active&&!archived?`<button type="button" class="button" data-review-action="email" data-id="${esc(person.user_id)}">Send sign-in link</button>`:''}${!archived?'<button type="submit" class="button primary">'+(edit?'Save access':'Share with client')+'</button>':''}</div>${edit?'<button type="button" class="button text small" data-review-action="reload-client" data-id="'+esc(person.user_id)+'">Reload saved access</button>':''}</form>`);
 }
 function dialogCapture(){const dialog=document.querySelector('#dialog');return {dialog,body:dialog?.querySelector('.dialog-body'),open:!!dialog?.open};}
 const sameDialog=c=>c.dialog?.querySelector('.dialog-body')===c.body&&(!c.open||c.dialog.open);
 async function openRequest(id){
  if(!canLeave()||isSaving())return;const c=capture(),version=++opening,surface=dialogCapture(),record=await request('/reviews/'+path(id));
  if(!current(c)||version!==opening||!sameDialog(surface))return;showRequest(record);
 }
 function showRequest(record){
  openDialog('Request '+record.number+' · '+record.title,`<div class="studio-review-detail" data-review-record="${esc(record.id)}"><div class="spread"><span class="badge">${esc(record.status)}</span><small>Issued ${esc(date(record.issued_at))}</small></div><p class="brief-copy">${esc(record.message||'No message added.')}</p><section class="detail-section"><h3>Shared with</h3>${record.recipients.map(person=>`<div class="data-row"><div><b>${esc(person.name)}</b><small>${esc(person.email)}</small></div><small>${!person.active?'Access revoked':person.can_decide&&person.can_approve?'Can accept / reject':'View only'}</small></div>`).join('')}</section><section class="detail-section"><h3>Issued images</h3>${record.items.map(image=>`<article class="studio-issued-image"><img src="/api/renders/${path(image.render_id)}/content?variant=thumbnail" alt="" loading="lazy"><div><b>${esc(image.code+' · '+image.title)}</b><small>Issued version ${image.number}${!image.is_latest?' · A newer version has not been issued in this request.':''}</small>${image.responses.map(response=>`<div class="client-feedback-response"><b>${esc(response.client_name)}</b><span> · ${response.decision==='accepted'?'Accepted':'Rejected'}</span><small>${esc(date(response.created_at))}</small>${response.message?`<p>${esc(response.message)}</p>`:''}</div>`).join('')||'<p class="muted">No client response recorded for this image.</p>'}</div></article>`).join('')}</section><small>${record.allow_download?'Original downloads are enabled for this request.':'Clients receive previews for this request.'}</small>${record.status==='issued'?`<div class="form-actions"><button type="button" class="button" data-review-action="close" data-id="${esc(record.id)}" data-version="${record.version}">Close review</button><button type="button" class="button text" data-review-action="cancel" data-id="${esc(record.id)}" data-version="${record.version}">Cancel request</button></div>`:'<p class="muted">Responses are retained for this '+esc(record.status)+' request.</p>'}</div>`,{drawer:true});syncBusy();
 }
 function imageOptions(form){
  const draft=form.__issueDraft;
  return draft.page.items.map(image=>`<label class="review-selection-row"><input type="checkbox" name="review_image" value="${esc(image.id)}" data-review-image="${esc(image.id)}" ${draft.items.has(image.id)?'checked':''}><img src="/api/renders/${path(image.render_id)}/content?variant=thumbnail" alt="" loading="lazy"><span><b>${esc(image.code+' · '+image.title)}</b><small>Version ${image.number}</small></span></label>`).join('')||'<p class="muted">No verified renders match this search.</p>';
 }
 function recipientOptions(form){return state.clients.filter(person=>person.active).map(person=>{const choice=form.__issueDraft.recipients.get(person.user_id);return `<div class="review-recipient-row"><label class="review-check"><input type="checkbox" name="review_recipient" value="${esc(person.user_id)}" data-review-recipient="${esc(person.user_id)}" ${choice?'checked':''}><span><b>${esc(person.name)}</b><small>${esc(person.email)}</small></span></label><label class="review-check"><input type="checkbox" name="review_decision" value="${esc(person.user_id)}" data-review-decision="${esc(person.user_id)}" ${choice?.can_decide?'checked':''} ${!person.can_approve?'disabled':''}><span>Can accept / reject</span></label></div>`;}).join('')||'<p class="muted">No active clients. Share this project with a client first.</p>';}
 async function issueForm(){
  if(!founder()||getProject()?.archived||isSaving()||!canLeave())return;
  const c=capture(),version=++opening,surface=dialogCapture(),images=await request('/projects/'+path(getProject().id)+'/review-images?page=1');
  if(!current(c)||version!==opening||!sameDialog(surface))return;
  openDialog('Issue review request',`<form data-review-form="issue"><div class="form-error" role="alert"></div><div class="field"><label for="review-request-title">Request title</label><input id="review-request-title" name="title" required maxlength="200" placeholder="e.g. Materials and lighting · Round 1"></div><div class="field"><label for="review-request-message">Message to clients</label><textarea id="review-request-message" name="message" maxlength="5000" rows="3"></textarea></div><section class="detail-section"><div class="spread"><h3>Images</h3><small data-review-image-count>0 selected</small></div><div class="filters"><label class="sr-only" for="review-image-search">Search verified images</label><input id="review-image-search" type="search" data-review-image-search maxlength="200" placeholder="Search camera code or name"><button type="button" class="button small" data-review-action="search-images">Search</button></div><div data-review-image-options></div><div class="spread"><small data-review-image-total></small><button type="button" class="button small" data-review-action="more-images">Load more images</button></div></section><section class="detail-section"><h3>Recipients</h3><div data-review-recipient-options></div><div class="spread"><small data-review-client-total></small><button type="button" class="button small" data-review-action="more-form-clients">Load more clients</button></div></section><label class="review-check"><input type="checkbox" name="allow_download"><span>Allow original image downloads</span></label><p class="review-guidance">The selected versions become visible to these clients. Issuing a request does not send an email; you can send a sign-in link from Clients.</p><div data-review-conflict hidden><p class="notice">An image changed. Reload the image options and select the latest versions. Your title, message and recipient choices will be kept.</p><button type="button" class="button" data-review-action="rebase-images">Reload image options</button></div><div class="form-actions"><button type="submit" class="button primary">Issue review request</button></div></form>`);
  const form=document.querySelector('#dialog').querySelector('[data-review-form="issue"]');
  form.__issueDraft={items:new Map(),recipients:new Map(),page:images,search:'',read:0};paintOptions(form);
 }
 function paintOptions(form){
  const draft=form.__issueDraft;form.querySelector('[data-review-image-options]').innerHTML=imageOptions(form);form.querySelector('[data-review-recipient-options]').innerHTML=recipientOptions(form);
  form.querySelector('[data-review-image-count]').textContent=draft.items.size+' selected';form.querySelector('[data-review-image-total]').textContent=draft.page.items.length+' of '+draft.page.total+' matching images';
  form.querySelector('[data-review-action="more-images"]').hidden=!draft.page.hasMore;
  form.querySelector('[data-review-client-total]').textContent=state.clients.length+' of '+state.clientTotal+' clients';form.querySelector('[data-review-action="more-form-clients"]').hidden=!state.moreClients;if(form.__payload)for(const control of form.querySelectorAll('input,textarea'))control.disabled=true;
 }
 async function searchImages(form,append=false,rebase=false){
  const c=capture(),draft=form.__issueDraft,read=++draft.read,search=form.querySelector('[data-review-image-search]').value,page=append?draft.page.page+1:1;
  const result=await request('/projects/'+path(c.project)+'/review-images?'+new URLSearchParams({page:String(page),search}));
  if(!current(c)||form.isConnected===false||read!==draft.read)return;
  if(rebase){draft.items.clear();delete form.__payload;delete form.dataset.requestKey;form.__conflict=false;for(const field of form.querySelectorAll('input,textarea'))field.disabled=false;form.querySelector('[data-review-conflict]').hidden=true;form.querySelector('.form-error').textContent='Select the latest image versions. Your other choices are kept.';}
  draft.page={...result,items:append?[...draft.page.items,...result.items]:result.items};draft.search=search;paintOptions(form);
 }
 async function mutate(form,operation){
  if(isSaving())return;const c=capture(),token={...c},dialog=document.querySelector('#dialog');pending=token;syncBusy();if(form)form.dataset.pending='1';
  try{await operation(c);}
  catch(error){if(current(c)){const field=form?.isConnected!==false?form?.querySelector('.form-error'):null;if(field)field.textContent=error.message;else toast(error.message);}}
  finally{if(pending===token)pending=null;syncBusy();if(form?.isConnected!==false&&form){delete form.dataset.pending;if(form.__payload){for(const control of form.querySelectorAll('input,textarea'))control.disabled=true;}}if(dialog?.querySelector('[data-review-form="issue"]'))paintOptions(dialog.querySelector('[data-review-form="issue"]'));}
 }
 async function saveClient(form){
  await mutate(form,async c=>{
   form.dataset.requestKey||=crypto.randomUUID();form.__emailWanted??=!!form.elements.email_client?.checked;
   form.__payload||={name:form.elements.name.value,email:form.elements.email.value,active:form.elements.active.checked,can_approve:form.elements.can_approve.checked,...(form.dataset.user?{user_id:form.dataset.user,expectedVersion:Number(form.dataset.version)}:{})};
   const result=form.__savedGrant||await request('/projects/'+path(c.project)+'/clients','POST',form.__payload,{'Idempotency-Key':form.dataset.requestKey});if(!current(c))return;form.__savedGrant=result;
   let message='Client access saved.';
   if(form.__emailWanted&&!form.__emailRequested&&result.active){form.__emailRequested=true;try{await request('/projects/'+path(c.project)+'/clients/'+path(result.user_id)+'/invite','POST',{});message='Client access saved. Sign-in email requested.';}catch{message='Client access saved. Email delivery could not be confirmed; ask the client to check their inbox before resending.';}}
   await loadClients();if(!current(c))return;render();const person=state.clients.find(row=>row.user_id===result.user_id)||{...form.__payload,...result};
   // The completed form is replaced only after its actual acknowledgement.
   pending=null;syncBusy();form.__payload=null;clientForm(person,message,false);toast(message);
  });
 }
 async function saveIssue(form){
  await mutate(form,async c=>{
   const draft=form.__issueDraft;form.dataset.requestKey||=crypto.randomUUID();
   form.__payload||={title:form.elements.title.value,message:form.elements.message.value,allow_download:form.elements.allow_download.checked,items:Array.from(draft.items.values()),recipients:Array.from(draft.recipients.values())};
   let result;
   try{result=form.__issued||await request('/projects/'+path(c.project)+'/reviews','POST',form.__payload,{'Idempotency-Key':form.dataset.requestKey});}
   catch(error){if([400,409].includes(error.status)){form.__conflict=error.status===409;if(!form.__conflict){delete form.__payload;delete form.dataset.requestKey;}else form.querySelector('[data-review-conflict]').hidden=false;}throw error;}
   if(!current(c))return;form.__issued=result;await loadRequests();if(!current(c))return;render();showRequest(result);toast('Request '+result.number+' issued. Selected image versions are now shared.');
  });
 }
 document.addEventListener('submit',event=>{const form=event.target;if(!form.dataset?.reviewForm)return;event.preventDefault();(form.dataset.reviewForm==='client'?saveClient(form):saveIssue(form)).catch(error=>toast(error.message));});
 document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches?.('[data-review-image-search]')){event.preventDefault();const form=event.target.closest('[data-review-form="issue"]');if(form&&!isSaving())searchImages(form).catch(error=>toast(error.message));}});
 document.addEventListener('change',event=>{
  const field=event.target,form=field.closest?.('[data-review-form="issue"]');if(!form||isSaving())return;const draft=form.__issueDraft;
  if(field.dataset.reviewImage){const image=draft.page.items.find(row=>row.id===field.dataset.reviewImage);if(field.checked&&image)draft.items.set(image.id,{deliverable_id:image.id,render_id:image.render_id,expected_version:image.version});else draft.items.delete(field.dataset.reviewImage);form.querySelector('[data-review-image-count]').textContent=draft.items.size+' selected';}
  if(field.dataset.reviewRecipient||field.dataset.reviewDecision){const id=field.dataset.reviewRecipient||field.dataset.reviewDecision,selected=form.querySelector('[data-review-recipient="'+id+'"]'),decision=form.querySelector('[data-review-decision="'+id+'"]');if(selected.checked)draft.recipients.set(id,{user_id:id,can_decide:decision.checked});else{draft.recipients.delete(id);decision.checked=false;}}
 });
 document.addEventListener('click',event=>{
  const target=event.target.closest?.('[data-review-action]');if(!target)return;event.preventDefault();if(isSaving())return;
  const action=target.dataset.reviewAction,form=target.closest('[data-review-form="issue"]');
  const run=async()=>{
   if(action==='tab'){if(!canLeave())return;state.tab=target.dataset.value;render();return;}
   if(action==='reload'){await load();render();return;}
   if(action==='new-client'){clientForm();return;}
   if(action==='client'){clientForm(state.clients.find(row=>row.user_id===target.dataset.id));return;}
   if(action==='reload-client'){if(!canLeave())return;await loadClients();clientForm(state.clients.find(row=>row.user_id===target.dataset.id),'',false);return;}
   if(action==='request'){await openRequest(target.dataset.id);return;}
   if(action==='issue'){await issueForm();return;}
   if(action==='more-clients'){await loadClients(true);render();return;}
   if(action==='more-requests'){await loadRequests(true);render();return;}
   if(action==='more-form-clients'){await loadClients(true);if(form?.isConnected)paintOptions(form);return;}
   if(action==='search-images'||action==='more-images'||action==='rebase-images'){await searchImages(form,action==='more-images',action==='rebase-images');return;}
   if(action==='email'){
    if(!canLeave())return;await mutate(target.closest('form'),async c=>{await request('/projects/'+path(c.project)+'/clients/'+path(target.dataset.id)+'/invite','POST',{});if(current(c))toast('Sign-in email requested.');});return;
   }
   if(action==='close'||action==='cancel'){
    if(!canLeave())return;const next=action==='close'?'closed':'cancelled';if(!confirm(action==='close'?'Close this review? Clients can read it, but cannot change their responses.':'Cancel this request? Clients will lose access to this issued request. Its response history is retained.'))return;
    await mutate(null,async c=>{await request('/reviews/'+path(target.dataset.id),'PATCH',{expectedVersion:Number(target.dataset.version),status:next});await loadRequests();if(!current(c))return;render();const detail=await request('/reviews/'+path(target.dataset.id));if(current(c))showRequest(detail);});
   }
  };run().catch(error=>toast(error.message));
 });
 return {load,render:view,reset,isSaving,syncBusy,getState:()=>state};
}
