import {icon} from './icons.js';
import {formatFileSize} from './file-size.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(value));
const label=value=>value==='accepted'?'Accepted':value==='rejected'?'Rejected':'Awaiting your response';
const route=(request,item='')=>'#reviews/'+encodeURIComponent(request)+(item?'/'+encodeURIComponent(item):'');
const media=(request,item,variant='preview')=>'/api/client/reviews/'+encodeURIComponent(request)+'/items/'+encodeURIComponent(item)+'/content?variant='+variant;

export function createClientReviewPortal({root,fetcher=fetch,confirmLeave=message=>confirm(message),notify=()=>{}}){
 let epoch=0,reading=0,identity=null,csrf='',reviews=[],review=null,selected='',pending=false,mounted=false,attached=false,activeHash='',draft=null,unavailable='';
 const capture=()=>({epoch,user:identity?.id,request:review?.id,item:selected});
 const current=c=>mounted&&c.epoch===epoch&&c.user===identity?.id&&c.request===review?.id&&c.item===selected;
 const item=()=>review?.items.find(row=>row.id===selected);
 const dirty=()=>!!draft&&(!!draft.payload||draft.message!==(item()?.response?.message||''));
 function canLeave(){return !pending&&(!dirty()||confirmLeave('Discard your unsaved review comment?'));}
 async function api(path,method='GET',body,headers={}){
  const response=await fetcher('/api/client'+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let result;try{result=await response.json();}catch{throw Object.assign(Error('The server could not respond. Your response may have saved; reload to check before retrying.'),{status:response.status});}
  if(!response.ok)throw Object.assign(Error(result.error||'This review could not be opened.'),{status:response.status,code:result.code});return result;
 }
 function authentication(message='',mfa=false){
  review=null;selected='';draft=null;unavailable='';
  root.innerHTML=`<main id="main" class="auth-shell client-auth" tabindex="-1"><aside class="auth-rail" aria-label="NAM Studio"><img class="auth-rail-logo" src="/assets/nam-logo.png" alt="NAM" width="96" height="29"><div class="auth-rail-copy"><span>NAM Studio</span><p>Project review.</p></div></aside><div class="auth-content"><section class="auth-form" aria-labelledby="client-auth-title"><div class="auth-mobile-brand"><img src="/assets/nam-logo.png" alt="NAM" width="80" height="24"></div><h1 id="client-auth-title" class="auth-title">${mfa?'Verify it’s you.':'Welcome to your project.'}</h1><p class="auth-intro">${mfa?'Enter the code from your authenticator.':'Use the email address invited by NAM Studio.'}</p><form data-client-form="${mfa?'mfa':'signin'}"><div class="form-error" role="alert">${esc(message)}</div><div class="field"><label for="client-signin-field">${mfa?'Authenticator code':'Email address'}</label><input id="client-signin-field" name="${mfa?'code':'email'}" type="${mfa?'text':'email'}" ${mfa?'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"':'autocomplete="email" maxlength="254"'} required></div><button class="button primary auth-submit" type="submit">${mfa?'Verify sign-in':'Email sign-in link'}</button></form><p class="auth-note">Your invitation gives access to the images NAM Studio has issued for review.</p><button class="button text auth-help-link" type="button" data-client-action="logout">Sign out of this browser session</button></section></div></main>`;
 }
 function lostAccess(message){reading++;identity=null;csrf='';reviews=[];review=null;selected='';draft=null;authentication(message);}
 function busy(value){pending=value;for(const control of root.querySelectorAll('button,input,textarea,select')){if(value){control.dataset.reviewWasDisabled=control.disabled?'1':'0';control.disabled=true;}else if(control.dataset.reviewWasDisabled!==undefined){control.disabled=control.dataset.reviewWasDisabled==='1';delete control.dataset.reviewWasDisabled;}}root.setAttribute('aria-busy',String(value));}
 function shell(body,footer=''){
  const images=review?`<button type="button" class="button text small client-back" data-client-action="all">${icon('arrow')} All review requests</button><div class="client-rail-caption">${esc(review.project)}</div><h2 class="client-rail-title">${esc(review.title)}</h2><nav class="client-issued-images" aria-label="Issued images">${review.items.map(row=>`<button type="button" id="client-item-${esc(row.id)}" class="render-version-item ${row.id===selected?'active':''}" data-client-action="image" data-id="${esc(row.id)}" aria-pressed="${row.id===selected}"><img src="${media(review.id,row.id,'thumbnail')}" alt="" loading="lazy"><span><b>${esc(row.code)}</b><small>${esc(row.title)}</small><small>Version ${row.number} · ${row.response?label(row.response.decision):review.can_decide?'Awaiting response':'View only'}</small></span></button>`).join('')}</nav>`:'<nav aria-label="Client navigation"><span class="nav-link active" aria-current="page">'+icon('image')+' Review requests</span></nav>';
  root.innerHTML=`<div class="client-portal"><aside class="client-portal-rail" aria-label="NAM project navigation"><div class="client-portal-brand"><img src="/assets/nam-logo.png" alt="NAM Studio" width="68" height="21"><span>Project review</span></div>${images}<div class="client-portal-account"><span>${esc(identity?.name||'Client')}</span><button type="button" class="button text small" data-client-action="logout">Sign out</button></div></aside><section class="client-portal-main"><header class="client-portal-header"><span>${review?(review.purpose==='delivery'?'Final delivery':'Review request '+review.number):'Review requests'}</span>${review?'<span class="client-review-status">'+esc(review.status==='closed'?'Closed':review.can_decide?'Your response requested':'View only')+'</span>':''}</header>${body}${footer}</section></div>`;
  document.title=(review?review.title:'Project review')+' — NAM Studio';
 }
 function showList(){
  shell(`<main id="main" class="client-portal-scroll" tabindex="-1"><div class="page-head"><div><h1>Your review requests</h1><p>Images issued by NAM Studio for your projects.</p></div><button class="button small" type="button" data-client-action="reload-list">${icon('refresh')} Refresh</button></div>${unavailable?`<div class="notice error" role="alert">${esc(unavailable)}</div>`:''}<div class="client-request-list">${reviews.map(row=>`<button type="button" class="client-request-row" data-client-action="request" data-id="${esc(row.id)}"><span><b>${esc(row.title)}</b><small>${esc(row.project)} · ${row.purpose==='delivery'?'Final delivery':'Request '+row.number}</small></span><span><small>${row.items} ${Number(row.items)===1?'image':'images'}</small><small>${esc(date(row.issued_at))}</small></span><span class="badge">${row.status==='closed'?'Closed':row.purpose==='delivery'?'Final delivery':'Issued'}</span>${icon('arrow')}</button>`).join('')||'<div class="empty"><b>No review requests yet.</b><p>NAM Studio will issue images here when they are ready for your review.</p></div>'}</div>${reviews.length===100?'<p class="muted">Showing your 100 most recent review requests.</p>':''}</main>`);
 }
 function showReview(message=''){
  const selectedItem=item();if(!selectedItem){review=null;showList();return;}
  draft??={message:selectedItem.response?.message||'',key:'',payload:null};
  const response=selectedItem.response;
  const body=`<main id="main" class="client-portal-scroll" tabindex="-1"><div class="page-head"><div><h1>${esc(selectedItem.code+' · '+selectedItem.title)}</h1><p>${review.purpose==='delivery'?'Final file · ':''}Version ${selectedItem.number} · ${selectedItem.width} × ${selectedItem.height} · ${esc(formatFileSize(selectedItem.byte_size))}</p></div>${review.purpose==='delivery'?`<a class="button small" href="/api/client/reviews/${encodeURIComponent(review.id)}/manifest" download>Download file manifest</a>`:''}${review.allow_download?`<a class="button small" href="${media(review.id,selected,'original')}" download>Download original ${icon('arrow')}</a>`:''}</div>${review.message?`<p class="client-request-message">${esc(review.message)}</p>`:''}<figure class="client-review-figure"><img class="client-issued-image" src="${media(review.id,selected)}" alt="${esc(selectedItem.code+' · '+selectedItem.title+' · version '+selectedItem.number)}"><figcaption>Issued ${esc(date(review.issued_at))}</figcaption></figure>${response?`<div class="client-response-record"><b>${label(response.decision)}</b><span> · ${esc(date(response.created_at))}</span>${!review.can_decide&&response.message?`<p>${esc(response.message)}</p>`:''}</div>`:''}${review.can_decide?`<form id="client-response-form" data-client-form="response"><div class="form-error" role="alert">${esc(message)}</div><div class="field"><label for="client-response-comment">Comment <span class="muted">(optional)</span></label><textarea id="client-response-comment" name="message" maxlength="5000" rows="3" ${draft.payload?'readonly':''} placeholder="Share feedback on this issued image.">${esc(draft.message)}</textarea></div>${draft.payload?'<p class="muted">Your original response is kept for retrying. Reload to check the saved response before changing it.</p>':''}<button type="button" class="button text small" data-client-action="reload-review">Reload saved review</button></form>`:`<p class="muted">${review.status==='closed'?'This review is closed. Your recorded response is retained.':review.purpose==='delivery'?'These are the final files issued by NAM Studio. Download each original above; the file manifest records its exact version and checksum.':'You can view these images. NAM Studio has not enabled decisions for this review.'}</p>`}</main>`;
  const footer=review.can_decide?`<footer class="client-decision-footer"><span data-client-save-status role="status">${response?label(response.decision)+' · version '+selectedItem.number:'Your response applies to version '+selectedItem.number+'.'}</span><div><button type="submit" form="client-response-form" name="decision" value="rejected" class="button" ${draft.payload&&draft.payload.decision!=='rejected'?'disabled':''}>${draft.payload?.decision==='rejected'?'Retry Reject':'Reject'}</button><button type="submit" form="client-response-form" name="decision" value="accepted" class="button primary" ${draft.payload&&draft.payload.decision!=='accepted'?'disabled':''}>${draft.payload?.decision==='accepted'?'Retry Accept':'Accept'}</button></div></footer>`:'';
  shell(body,footer);
 }
 async function loadList(){const version=++reading,generation=epoch,user=identity?.id,result=await api('/reviews');if(!mounted||version!==reading||generation!==epoch||user!==identity?.id)return;reviews=result.items;unavailable='';}
 async function openReview(qid,iid=''){
  const version=++reading,generation=epoch,user=identity?.id,result=await api('/reviews/'+encodeURIComponent(qid));if(!mounted||version!==reading||generation!==epoch||user!==identity?.id)return;
  review=result;selected=result.items.some(row=>row.id===iid)?iid:result.items[0]?.id||'';draft=null;unavailable='';showReview();root.querySelector('#main')?.focus({preventScroll:true});
 }
 async function navigate(){
  if(!identity||identity.mfaRequired)return;
  if(!canLeave()){history.replaceState(null,'',activeHash||'/review');return;}
  const generation=epoch,user=identity.id;
  const parts=location.hash.replace(/^#/,'').split('/');activeHash=location.hash;
  review=null;selected='';draft=null;
  root.innerHTML='<main id="main" class="loading-state" role="status">Opening your review…</main>';
  try{if(parts[0]==='reviews'&&parts[1])await openReview(parts[1],parts[2]);else{await loadList();if(mounted&&generation===epoch&&user===identity?.id)showList();}}
  catch(error){if(!mounted||generation!==epoch||user!==identity?.id)return;review=null;selected='';draft=null;reviews=[];if([401,403].includes(error.status))lostAccess(error.message);else{unavailable=error.message;showList();}}
 }
 async function mount(){
  if(mounted)return;attach();mounted=true;const generation=++epoch;
  root.innerHTML='<main id="main" class="loading-state" role="status">Opening your project review…</main>';
  try{
   const hash=new URLSearchParams(location.hash.slice(1)),query=new URLSearchParams(location.search);
   let signIn;
   if(hash.has('access_token')||hash.has('refresh_token')||query.has('code')||hash.has('error')){
    const access_token=hash.get('access_token'),refresh_token=hash.get('refresh_token'),code=query.get('code'),failed=hash.has('error');
    // Remove provider credentials before sending any application request.
    history.replaceState(null,'','/review');
    if(failed)throw Error('This sign-in link is invalid or expired. Request a new link.');
    signIn=await api('/auth/session','POST',code?{code}:{access_token,refresh_token});
   }else signIn=await api('/auth');
   if(!mounted||generation!==epoch)return;
   if(!signIn.authenticated){authentication();return;}
   identity=signIn;csrf=signIn.csrf;
   if(identity.mfaRequired){authentication('',true);return;}
   await loadList();await navigate();
  }catch(error){if(mounted&&generation===epoch)authentication(error.message);}
 }
 function unmount(){detach();mounted=false;epoch++;reading++;identity=null;csrf='';reviews=[];review=null;draft=null;pending=false;}
 async function submit(event){
  const form=event.target;if(!mounted||!form.dataset?.clientForm)return;event.preventDefault();if(pending)return;
  const mode=form.dataset.clientForm;
  if(mode==='response'){
   const decision=event.submitter?.value;if(!review?.can_decide||!['accepted','rejected'].includes(decision))return;
   const c=capture(),selectedItem=item();draft.message=form.elements.message.value;
   draft.key||=crypto.randomUUID();draft.payload||={expectedVersion:selectedItem.response?.version||0,decision,message:draft.message};
   if(draft.payload.decision!==decision)return;
   const originalDraft=draft;busy(true);form.querySelector('.form-error').textContent='';
   try{
    const response=await api('/reviews/'+encodeURIComponent(review.id)+'/items/'+encodeURIComponent(selected)+'/response','POST',draft.payload,{'Idempotency-Key':draft.key});
    if(!current(c))return;selectedItem.response=response;draft=null;showReview();notify('Response saved to version '+selectedItem.number+'.');
   }catch(error){
    if(!current(c))return;
    if([401,403].includes(error.status))lostAccess(error.message);
    else if(error.status===404){review=null;selected='';draft=null;unavailable=error.message;reviews=[];showList();}
    else{draft=originalDraft;if(error.status===400){draft.payload=null;draft.key='';}showReview(error.message);}
   }finally{if(mounted&&c.epoch===epoch)busy(false);}
   return;
  }
  const error=form.querySelector('.form-error'),generation=epoch;busy(true);error.textContent='';
  try{
   if(mode==='signin'){const result=await api('/auth/link','POST',{email:form.elements.email.value});if(!mounted||generation!==epoch)return;error.insertAdjacentHTML('afterend','<p class="notice" role="status">'+esc(result.message)+'</p>');}
   if(mode==='mfa'){const result=await api('/auth/mfa','POST',{factor_id:identity.factorId,code:form.elements.code.value});if(!mounted||generation!==epoch)return;identity=result;csrf=result.csrf;busy(false);await navigate();}
  }catch(problem){if(mounted&&generation===epoch&&form.isConnected)error.textContent=problem.message;}
  finally{if(mounted&&generation===epoch)busy(false);}
 }
 async function click(event){
  const target=event.target.closest?.('[data-client-action]');if(!target||!root.contains(target)||!mounted)return;event.preventDefault();if(pending)return;
  const action=target.dataset.clientAction;
  if(action==='logout'){
   if(!canLeave())return;const generation=++epoch;reading++;busy(true);try{await api('/auth/logout','POST',{});if(!mounted||generation!==epoch)return;identity=null;csrf='';reviews=[];review=null;draft=null;history.replaceState(null,'','/review');authentication();}catch(error){if(mounted&&generation===epoch)notify(error.message);}finally{if(mounted&&generation===epoch)busy(false);}return;
  }
  if(action==='request'||action==='image'||action==='all'){
   if(!canLeave())return;draft=null;const hash=action==='all'?'':route(action==='request'?target.dataset.id:review.id,action==='image'?target.dataset.id:'');
   if(location.hash===hash){await navigate();return;}location.hash=hash;return;
  }
  if(action==='reload-review'){
   if(!canLeave())return;draft=null;await navigate();return;
  }
  if(action==='reload-list'){
   if(!canLeave())return;const generation=epoch,user=identity?.id;try{await loadList();if(mounted&&generation===epoch&&user===identity?.id)showList();}catch(error){if(!mounted||generation!==epoch||user!==identity?.id)return;reviews=[];if([401,403].includes(error.status))lostAccess(error.message);else{unavailable=error.message;showList();}}
  }
 }
 const onHash=()=>{if(mounted)navigate().catch(error=>notify(error.message));};
 const onUnload=event=>{if(mounted&&(pending||dirty())){event.preventDefault();event.returnValue='';}};
 const onInput=event=>{if(mounted&&draft&&event.target.matches?.('#client-response-comment'))draft.message=event.target.value;};
 const onError=event=>{const img=event.target;if(!mounted||!img.matches?.('.client-issued-image')||!root.contains(img))return;const figure=img.closest('figure');if(!figure.querySelector('[data-client-image-error]'))figure.insertAdjacentHTML('beforeend','<p role="alert" data-client-image-error>This issued image could not load. Reload the review to retry or check your invitation with NAM Studio.</p>');};
 const onClick=event=>click(event).catch(error=>notify(error.message));
 function attach(){if(attached)return;attached=true;root.addEventListener('submit',submit);root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('error',onError,true);window.addEventListener('hashchange',onHash);window.addEventListener('beforeunload',onUnload);}
 function detach(){if(!attached)return;attached=false;root.removeEventListener('submit',submit);root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('error',onError,true);window.removeEventListener('hashchange',onHash);window.removeEventListener('beforeunload',onUnload);}
 attach();
 return {mount,unmount,isBusy:()=>pending,isDirty:dirty,getState:()=>({review,selected,reviews,identity})};
}
