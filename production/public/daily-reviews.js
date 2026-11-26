const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paragraph=(title,body)=>`<section class="daily-review-copy"><h3>${esc(title)}</h3><p class="prose">${esc(body||'None reported.')}</p></section>`;

// Review the source record itself. Versions are captured from the detail read,
// so a stale overview can never silently approve a resubmitted response.
export function createDailyReviews({request,openDialog,closeDialog,toast,onChange,contextKey}){
 let generation=0;
 const current=(key,version)=>key===contextKey()&&version===generation;
 async function open(kind,id){
  if(!['sales_report','academy_submission'].includes(kind))return;
  const key=contextKey(),version=++generation;
  const row=await request(kind==='sales_report'?`/sales/reports/${encodeURIComponent(id)}`:`/academy/submissions/${encodeURIComponent(id)}`);
  if(!current(key,version))return;
  const report=kind==='sales_report',pending=report?!row.reviewed_at:row.status==='submitted';
  const copy=report?paragraph('Outcomes',row.outcomes)+paragraph('Blockers',row.blockers)+paragraph('Next week',row.next_week):paragraph(row.title,row.instructions)+paragraph('Practical response',row.body);
  const fields=report?'':`<div class="field"><label for="daily-review-decision">Review decision</label><select id="daily-review-decision" name="status"><option value="changes_requested">Changes requested</option><option value="approved">Approved</option></select></div><div class="field"><label for="daily-review-feedback">Feedback</label><textarea id="daily-review-feedback" name="feedback" maxlength="5000" rows="5">${esc(row.feedback||'')}</textarea></div><p class="muted"><small>Describe the next action when requesting changes.</small></p>`;
  openDialog(report?'Review weekly sales report':'Review practical response',`<p class="eyebrow">${esc(row.owner_name)}${report?' · Week of '+esc(row.week_start):''}</p>${copy}${pending?`<form data-daily-review="${kind}" data-id="${esc(id)}" data-revision="${esc(report?row.submitted_at:row.revision)}" data-generation="${version}"><div class="form-error" role="alert"></div>${fields}<div class="form-actions"><button type="submit" class="button primary">${report?'Mark reviewed':'Save review'}</button></div></form>`:'<p class="notice">This response has already been reviewed. Close this panel to refresh your daily brief.</p>'}`);
 }
 async function submit(form){
  if(!form.dataset.dailyReview||form.dataset.pending)return;
  const key=contextKey(),version=Number(form.dataset.generation);if(!current(key,version))return;
  form.dataset.pending='1';const submit=form.querySelector('[type="submit"]'),error=form.querySelector('.form-error');
  if(submit){submit.disabled=true;submit.setAttribute('aria-busy','true');}if(error)error.textContent='';
  let saved=false;
  try{
   const id=encodeURIComponent(form.dataset.id),values=Object.fromEntries(new FormData(form));
   if(form.dataset.dailyReview==='sales_report')await request(`/sales/reports/${id}/review`,'POST',{expectedSubmittedAt:form.dataset.revision});
   else await request(`/academy/submissions/${id}/review`,'POST',{expectedRevision:Number(form.dataset.revision),status:values.status,feedback:values.feedback});
   saved=true;if(!current(key,version)||!form.isConnected)return;closeDialog();await onChange();if(current(key,version))toast('Review saved');
  }catch(problem){
   if(!current(key,version))return;
   if(saved)toast('Review saved. Reload your daily brief to see the latest records.');
   else if(error&&form.isConnected)error.textContent=problem.message+(problem.status===409?' Close this panel and reopen the response. Your feedback remains here until you close it.':'');
  }finally{delete form.dataset.pending;if(submit){submit.disabled=false;submit.removeAttribute('aria-busy');}}
 }
 return {open,submit,reset(){generation++;}};
}
