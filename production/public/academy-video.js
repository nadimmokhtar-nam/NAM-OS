const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=bytes=>(Number(bytes)/1024/1024).toLocaleString('en-GB',{maximumFractionDigits:1})+' MiB';

export function renderVideoLesson(course,lessonId){
 return (course.videos||[]).filter(video=>video.lesson_id===lessonId).map(video=>`<section class="lesson-video" aria-label="Lesson video"><div class="spread"><h3>${esc(video.title)}</h3><small>Private · ${size(video.size)}</small></div><video controls playsinline preload="metadata" data-academy-video="${esc(video.id)}" aria-label="${esc(video.title)}" src="/api/academy/videos/${encodeURIComponent(video.id)}/content">${video.has_captions?`<track kind="captions" src="/api/academy/videos/${encodeURIComponent(video.id)}/captions" srclang="en" label="English" default>`:''}Your browser cannot play this video. The written lesson remains available below.</video><p class="video-state" role="status" data-video-state="${esc(video.id)}">Private lesson video. Written steps are available below.</p></section>`).join('');
}

export function createAcademyVideo({request,openDialog,toast,getCourse,onChange}){
 let generation=0,xhr=null,uploading=false;
 const current=()=>{try{return getCourse();}catch{return null;}};
 function reset(){generation++;uploading=false;xhr?.abort();xhr=null;}
 function render(course,disabled=''){
  return `<section class="panel"><div class="panel-head"><div><h2>Private lesson video</h2><p>Upload once. Publish with the lesson. Keep every assigned version intact.</p></div><button type="button" class="button small" data-video-action="new" ${disabled||!course.lessons.length?'disabled':''}>Upload video</button></div>${(course.videos||[]).map(video=>`<div class="data-row"><div><h3>${esc(video.title)}</h3><small>${esc(course.lessons.find(l=>l.id===video.lesson_id)?.title||'Working lesson')} · ${size(video.size)}</small><small>${video.status==='ready'?'Verified · publish to make available to learners':'Upload pending · not available to learners'}</small></div><div class="filters">${video.status==='pending'?`<button type="button" class="button small" data-video-action="retry" data-id="${esc(video.id)}" ${disabled}>Retry upload</button><button type="button" class="button small" data-video-action="verify" data-id="${esc(video.id)}" ${disabled}>Verify uploaded file</button>`:`<button type="button" class="button small" data-video-action="preview" data-id="${esc(video.id)}">Preview</button>`}<button type="button" class="button text small" data-video-action="unlink" data-id="${esc(video.id)}" ${disabled}>Remove from draft</button></div></div>`).join('')||'<div class="empty">Demonstrate the craft alongside the written steps. No private videos uploaded yet.</div>'}<p class="video-guidance">MP4 (H.264) or WebM, up to 50 MiB per file. Add WebVTT captions for spoken audio; use the written lesson for a descriptive transcript. Video is private and is not transcoded. Removing a draft link retains published history and its storage allowance.</p></section>`;
 }
 function form(retryId=''){
  const course=current();if(!course)return;
  const video=course.videos?.find(v=>v.id===retryId);
  openDialog(video?'Retry private upload':'Upload lesson video',`<form data-video-form="upload" data-course="${esc(course.id)}" data-revision="${course.revision}" data-retry-id="${esc(retryId)}"><div class="form-error" role="alert"></div>${video?`<div class="notice">Select the original ${esc(video.file_name)} (${size(video.size)}). Its fingerprint must match the reserved upload.</div>`:`<div class="field"><label for="video-lesson">Lesson</label><select id="video-lesson" name="lesson_id">${course.lessons.map(lesson=>`<option value="${esc(lesson.id)}">${esc(lesson.title)}</option>`).join('')}</select></div><div class="field"><label for="video-title">Video title</label><input id="video-title" name="title" required maxlength="200" placeholder="e.g. Balancing daylight and practical lighting"></div>`}<div class="field"><label for="video-file">${video?'Original video file':'Video file'}</label><input id="video-file" name="video_file" type="file" accept="video/mp4,video/webm,.mp4,.webm" required><small>MP4 or WebM · maximum 50 MiB · original file, no external hosting required.</small></div>${!video?'<div class="field"><label for="video-captions">English captions (optional WebVTT file)</label><input id="video-captions" name="caption_file" type="file" accept="text/vtt,.vtt"><small>Provide captions for spoken audio. Keep a descriptive transcript in the written lesson.</small></div>':''}<div class="upload-feedback" aria-live="polite"><p data-upload-status>Choose a file to begin.</p><progress data-upload-progress max="100" value="0" aria-label="Video upload progress"></progress></div><div class="form-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary">${video?'Retry upload & verify':'Upload & verify'}</button></div></form>`);
 }
 function transfer(url,file,progress){
  return new Promise((resolve,reject)=>{
   xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.setRequestHeader('content-type',file.type||(/\.webm$/i.test(file.name)?'video/webm':'video/mp4'));xhr.setRequestHeader('cache-control','max-age=0');xhr.setRequestHeader('x-upsert','false');
   xhr.upload.onprogress=event=>{if(event.lengthComputable)progress(Math.round(event.loaded/event.total*100));};
   xhr.onload=()=>{const status=xhr.status;xhr=null;if(status>=200&&status<300||status===409)resolve();else reject(new Error('The upload did not finish. Keep the original file and retry this pending upload.'));};
   xhr.onerror=()=>{xhr=null;reject(new Error('The upload was interrupted. Retry the original file from the pending upload.'));};
   xhr.onabort=()=>{xhr=null;reject(new DOMException('Upload canceled','AbortError'));};xhr.send(file);
  });
 }
 async function upload(form){
  if(uploading)return;const version=++generation,course=current(),dialog=document.querySelector('#dialog'),submit=form.querySelector('[type=submit]'),error=form.querySelector('.form-error'),status=form.querySelector('[data-upload-status]'),progress=form.querySelector('[data-upload-progress]');
  if(!course||course.id!==form.dataset.course)return;
  const active=()=>version===generation&&current()?.id===course.id&&form.isConnected&&dialog?.open&&dialog.contains(form);
  const assertActive=()=>{if(!active())throw new DOMException('Upload view closed','AbortError');};
  const cancel=()=>{if(version===generation)reset();};dialog.addEventListener('close',cancel,{once:true});
  uploading=true;form.dataset.pending='1';submit.disabled=true;error.textContent='';
  try{
   const file=form.elements.video_file.files[0];if(!file||file.size<1||file.size>50*1024*1024)throw new Error('Choose a video of at most 50 MiB.');
   const mime=/\.mp4$/i.test(file.name)?'video/mp4':/\.webm$/i.test(file.name)?'video/webm':'';
   if(!mime||file.type&&file.type!==mime)throw new Error('Choose an MP4 or WebM file whose type matches its extension.');
   status.textContent='Checking the selected video…';const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());assertActive();
   const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
   let plan=form.__uploadPlan;
   if(!plan){
    if(form.dataset.retryId)plan=await request('/academy/videos/'+encodeURIComponent(form.dataset.retryId)+'/upload','POST',{});
    else{
     const caption=form.elements.caption_file.files[0];if(caption&&caption.size>100000)throw new Error('WebVTT captions must be at most 100 KB.');
     const caption_vtt=caption?await caption.text():'';assertActive();form.dataset.requestKey||=crypto.randomUUID();
     plan=await request('/academy/videos','POST',{course_id:course.id,lesson_id:form.elements.lesson_id.value,expectedRevision:Number(form.dataset.revision),title:form.elements.title.value,file_name:file.name,mime,byte_size:file.size,caption_vtt,sha256},{'Idempotency-Key':form.dataset.requestKey});
    }
    assertActive();form.__uploadPlan=plan;
   }
   if(plan.status!=='ready'){
    if(plan.sha256!==sha256||plan.size!==file.size||plan.mime!==mime)throw new Error('This is a different file. Select the original reserved video, or remove this pending draft link and start a new upload.');
    status.textContent='Uploading privately…';await transfer(plan.uploadUrl,file,value=>{if(active()){progress.value=value;status.textContent='Uploading privately… '+value+'%';}});assertActive();
    status.textContent='Verifying stored video bytes…';await request('/academy/videos/'+encodeURIComponent(plan.id)+'/finish','POST',{expectedRevision:plan.courseRevision});assertActive();
   }
   progress.value=100;status.textContent='Video verified. Ready for publication.';uploading=false;dialog.removeEventListener('close',cancel);await onChange(course.id,'Video verified. Publish the course to share it.');
  }catch(problem){if(active()&&problem.name!=='AbortError'){error.textContent=problem.message;status.textContent='Not verified. Your existing published videos have not changed.';}}
  finally{if(version===generation)uploading=false;delete form.dataset.pending;if(form.isConnected)submit.disabled=false;}
 }
 document.addEventListener('submit',event=>{const form=event.target;if(form.dataset?.videoForm!=='upload')return;event.preventDefault();void upload(form);});
 document.addEventListener('change',event=>{const input=event.target;if(input.id!=='video-file')return;const form=input.closest('[data-video-form]');if(!form||form.dataset.pending)return;form.__uploadPlan=null;delete form.dataset.requestKey;if(form.elements.title&&!form.elements.title.value&&input.files[0])form.elements.title.value=input.files[0].name.replace(/\.[^.]+$/,'');});
 document.addEventListener('click',async event=>{
  const target=event.target.closest?.('[data-video-action]');if(!target)return;event.preventDefault();
  if(target.dataset.videoAction==='reload-player'){document.querySelector(`video[data-academy-video="${CSS.escape(target.dataset.id)}"]`)?.load();return;}
  const course=current();if(!course||target.disabled)return;
  const action=target.dataset.videoAction;
  if(action==='new'||action==='retry'){form(action==='retry'?target.dataset.id:'');return;}
  if(action==='preview'){const video=course.videos.find(v=>v.id===target.dataset.id);openDialog('Private video preview',renderVideoLesson({videos:[{...video,lesson_id:'preview'}]},'preview'));return;}
  if(!['verify','unlink'].includes(action))return;
  if(action==='unlink'&&!confirm('Remove this video from the working lesson? Published versions and the stored video will be retained.'))return;
  target.disabled=true;const version=generation;
  try{await request('/academy/videos/'+encodeURIComponent(target.dataset.id)+(action==='verify'?'/finish':'/unlink'),'POST',{expectedRevision:course.revision});if(version===generation&&current()?.id===course.id)await onChange(course.id,action==='verify'?'Video verified.':'Working video removed. Published history retained.');}
  catch(problem){if(version===generation)toast(problem.message);}finally{target.disabled=false;}
 });
 document.addEventListener('error',event=>{const video=event.target;if(!video.matches?.('video[data-academy-video]'))return;const status=video.parentElement.querySelector('[data-video-state]');if(status)status.innerHTML=`The private video could not load. Check your access or try again. <button type="button" class="button small" data-video-action="reload-player" data-id="${esc(video.dataset.academyVideo)}">Retry video</button>`;},true);
 return {render,reset,isUploading:()=>uploading};
}
