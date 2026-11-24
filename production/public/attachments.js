const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ready=file=>file?.status==='ready'&&file.cleanupPending!==true;
export function createTaskAttachments({request,onChange,toast,getActor=()=>null}){
  const pending=new Set(),messages=new Map();
  const uploader=file=>!!getActor()?.id&&file.created_by===getActor().id;
  const removable=file=>uploader(file)||getActor()?.role==='founder';
  function status(file){
    if(ready(file))return {title:'Ready to download',detail:'',remove:'Remove'};
    if(file.status==='deleting'||file.cleanupPending&&file.status!=='pending')return {title:'Storage cleanup pending',detail:'This file is unavailable until removal finishes. Retry removal or ask the uploader or founder to finish cleanup.',remove:'Retry removal'};
    if(file.status==='pending')return {title:'Upload incomplete',detail:uploader(file)?'Choose the same original file and upload it again, or remove this pending upload.':'Ask the original uploader to retry this upload, or ask the founder to remove it.',remove:'Remove pending upload'};
    return {title:'File unavailable',detail:'Refresh the task to check the latest file status.',remove:null};
  }
  function fileRow(file,task){
    const info=status(file),size=Number(file.size),sizeLabel=Number.isFinite(size)&&size>0?`${Math.max(1,Math.ceil(size/1024))} KB`:'Size unavailable';
    const name=ready(file)?`<a href="/api/attachments/${encodeURIComponent(file.id)}" download="${esc(file.name)}">${esc(file.name)}</a>`:`<span>${esc(file.name)}</span>`;
    return `<div class="data-row"><div>${name}<small>${sizeLabel} · ${esc(file.mime)}</small><small role="status">${info.title}</small>${info.detail?`<p class="muted"><small>${info.detail}</small></p>`:''}</div><div class="filters">${file.status==='pending'&&uploader(file)?`<button type="button" class="button small" data-file-retry="${esc(file.id)}" data-file-task="${esc(task.id)}" data-file-name="${esc(file.name)}">Retry upload</button>`:''}${info.remove&&removable(file)?`<button type="button" class="button small" data-file-remove="${esc(file.id)}" data-file-task="${esc(task.id)}">${info.remove}</button>`:''}${!ready(file)?`<button type="button" class="button small" data-file-refresh="${esc(task.id)}">Refresh status</button>`:''}</div></div>`;
  }
  function render(task){const files=(task.attachments||[]).filter(file=>file.status!=='deleted');return `<section class="detail-section"><h3>Attachments</h3>${files.map(file=>fileRow(file,task)).join('')||'<small>No attachments yet.</small>'}<form data-file-form="${esc(task.id)}"><div class="field"><label for="task-upload">Add a file</label><input id="task-upload" name="file" type="file" accept="application/pdf,image/png,image/jpeg,text/plain" required><small>PDF, PNG, JPEG or plain text · Up to 2 MiB per file</small></div><div class="form-error" role="alert">${esc(messages.get(task.id)||'')}</div><button type="submit" class="button small">Upload attachment</button></form></section>`;}
  function message(taskId,text,form){messages.set(taskId,text);const error=form?.querySelector('.form-error');if(error)error.textContent=text;}
  async function refreshQuietly(taskId){try{await onChange(taskId);return true;}catch{return false;}}
  document.addEventListener('submit',async e=>{
    const form=e.target,id=form.dataset.fileForm;if(!id)return;e.preventDefault();const key='upload:'+id;if(pending.has(key))return;
    const input=form.querySelector('input[type=file]'),file=input.files[0],submit=form.querySelector('[type=submit]');message(id,'',form);
    if(!file){message(id,'Choose a file first.',form);return;}if(file.size>2097152){message(id,'Attachments cannot exceed 2 MiB.',form);return;}if(file.size===0){message(id,'Choose a file that is not empty.',form);return;}
    pending.add(key);submit.disabled=true;
    try{
      const bytes=new Uint8Array(await file.arrayBuffer()),chunks=[];for(let n=0;n<bytes.length;n+=32768)chunks.push(String.fromCharCode(...bytes.subarray(n,n+32768)));
      const mime=file.type||(/\.txt$/i.test(file.name)?'text/plain':'');
      const result=await request(`/tasks/${encodeURIComponent(id)}/attachments`,'POST',{name:file.name,mime,content_base64:btoa(chunks.join(''))});
      if(!ready(result)||typeof result.id!=='string')throw new Error('The upload is not ready to download. Retry the same file or remove the pending upload.');
      input.value='';
      if(await refreshQuietly(id))toast('Attachment saved');
      else{message(id,'The attachment was saved, but the task could not refresh. Reopen the task to view it.',form);toast('Attachment saved. Refresh the task to view it.');}
    }catch(error){message(id,error.message,form);await refreshQuietly(id);toast(error.message);}
    finally{pending.delete(key);submit.disabled=false;}
  });
  document.addEventListener('click',async e=>{
    const retry=e.target.closest('[data-file-retry]');
    if(retry){e.preventDefault();const id=retry.dataset.fileTask,form=Array.from(document.querySelectorAll('form[data-file-form]')).find(form=>form.dataset.fileForm===id);if(!form){toast('Reopen the task to retry the upload.');return;}message(id,`Choose the same original file: ${retry.dataset.fileName}. Then select Upload attachment.`,form);const input=form.querySelector('input[type=file]');input?.focus();input?.click();return;}
    const refresh=e.target.closest('[data-file-refresh]');
    if(refresh){e.preventDefault();const id=refresh.dataset.fileRefresh,key='refresh:'+id;if(pending.has(key))return;pending.add(key);refresh.disabled=true;try{await onChange(id);}catch{toast('The file status could not refresh. Reopen the task to check it.');}finally{pending.delete(key);refresh.disabled=false;}return;}
    const button=e.target.closest('[data-file-remove]');if(!button)return;e.preventDefault();const id=button.dataset.fileRemove,taskId=button.dataset.fileTask,key='remove:'+id;
    if(pending.has(key)||!confirm('Remove this attachment and finish any pending private storage cleanup?'))return;pending.add(key);button.disabled=true;
    try{const result=await request(`/attachments/${encodeURIComponent(id)}`,'DELETE',{});if(result?.ok!==true||result.cleanupPending===true||['pending','deleting'].includes(result.status))throw new Error('The file is not confirmed removed. Refresh its status and retry removal.');messages.delete(taskId);if(await refreshQuietly(taskId))toast('Attachment removed');else toast('Attachment removed. Reopen the task to refresh its file list.');}
    catch(error){messages.set(taskId,error.message);await refreshQuietly(taskId);toast(error.message);}
    finally{pending.delete(key);button.disabled=false;}
  });
  return {render};
}
