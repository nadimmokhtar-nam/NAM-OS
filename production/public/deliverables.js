import {icon} from './icons.js';
import {productionStages} from './production-stages.js';
import {createRenderVersions} from './render-versions.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds=[['still','Still image'],['animation','Animation'],['panorama','360 panorama']];
const kind=value=>kinds.find(([key])=>key===value)?.[1]||value;
const date=value=>value?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'No target date';
const options=(values,value,empty='')=>(empty?`<option value="">${esc(empty)}</option>`:'')+values.map(item=>{const [key,title]=Array.isArray(item)?item:[item,item];return `<option value="${esc(key)}" ${String(key)===String(value)?'selected':''}>${esc(title)}</option>`;}).join('');
const input=(name,label,value='',extra='')=>`<div class="field"><label for="deliverable-${name}">${label}</label><input id="deliverable-${name}" name="${name}" value="${esc(value)}" ${extra}></div>`;
const select=(name,label,values,value,empty='')=>`<div class="field"><label for="deliverable-${name}">${label}</label><select id="deliverable-${name}" name="${name}">${options(values,value,empty)}</select></div>`;
const note=value=>`<div class="field"><label for="deliverable-notes">Camera brief</label><textarea id="deliverable-notes" name="camera_notes" maxlength="5000" rows="5">${esc(value)}</textarea></div>`;

export function createProjectDeliverables({request,openDialog,getData,getProject,render,toast,canLeave=()=>true,onCreateTask,onOpenTask,ownerChoices,onBusy=()=>{},contextKey=()=>''}){
 const state={projectId:'',items:[],total:0,page:1,hasMore:false,search:'',kind:'',stage:'',sort:'code',archived:false,loading:false,error:''};
 let generation=0,read=0,opening=0,pending=null,detail=null;
 const founder=()=>getData()?.actor?.role==='founder';
 const artist=id=>getData()?.members.find(person=>person.id===id)?.name||(id?'Assigned artist':'Unassigned');
 const context=()=>({generation,actor:getData()?.actor?.id,project:getProject()?.id,key:contextKey()});
 const current=c=>c.generation===generation&&c.actor===getData()?.actor?.id&&c.project===getProject()?.id&&c.key===contextKey()&&!!getData();
 const renders=createRenderVersions({request,openDialog,getRecord:()=>detail,getData,getProject,getContext:context,isCurrent:current,onBusy,canLeave,onChanged:async(id,message)=>{await open(id);await refresh();if(message)toast(message);},toast});
 const isSaving=()=>!!pending&&current(pending)||renders.isBusy();
 const canCreateTask=()=>getData()?.capabilities?.createTaskSections?.includes('projects');
 function reset(){renders.reset();generation++;read++;opening++;pending=null;detail=null;Object.assign(state,{projectId:'',items:[],total:0,page:1,hasMore:false,search:'',kind:'',stage:'',sort:'code',archived:false,loading:false,error:''});}
 async function load(append=false){
  const project=getProject();if(!project)return;
  if(state.projectId!==project.id){reset();state.projectId=project.id;}
  const c=context(),version=++read,page=append?state.page+1:1;
  const query=new URLSearchParams({page:String(page),page_size:'100',search:state.search,kind:state.kind,stage:state.stage,sort:state.sort,archived:state.archived?'1':'0'});
  state.loading=true;state.error='';if(!append)state.items=[];
  try{const result=await request('/projects/'+encodeURIComponent(project.id)+'/deliverables?'+query);if(!current(c)||version!==read)return;
   state.items=append?Array.from(new Map([...state.items,...result.items].map(item=>[item.id,item])).values()):result.items;
   state.total=result.total;state.page=result.page;state.hasMore=result.hasMore;
  }catch(error){if(current(c)&&version===read){state.error=error.message;if(!append){state.items=[];state.total=0;state.hasMore=false;}}throw error;}
  finally{if(current(c)&&version===read)state.loading=false;}
 }
 function view(){
  const project=getProject(),add=founder()&&!project?.archived?'<button id="deliverable-create" class="button primary" data-deliverable-action="create">'+icon('plus')+' Add deliverable</button>':'';
  const heading=`<div class="page-head"><div><h1>Images &amp; deliverables</h1><p>${esc(project?.title)}</p></div>${add}</div>`;
  const tabs=`<div class="tabs" aria-label="Deliverable archive"><button class="tab ${!state.archived?'active':''}" id="deliverable-active-tab" data-deliverable-action="archive-view" data-value="0" aria-pressed="${!state.archived}">Active</button><button class="tab ${state.archived?'active':''}" id="deliverable-archived-tab" data-deliverable-action="archive-view" data-value="1" aria-pressed="${state.archived}">Archived</button></div>`;
  const filters=`<form class="toolbar deliverable-filters" data-deliverable-search><div class="filters"><label class="sr-only" for="deliverable-search">Search deliverables</label><input id="deliverable-search" type="search" name="search" value="${esc(state.search)}" placeholder="Search images…" maxlength="200"><button id="deliverable-search-submit" class="button" type="submit">${icon('search')} Search</button><label class="sr-only" for="deliverable-filter-kind">Deliverable type</label><select id="deliverable-filter-kind" data-deliverable-filter="kind">${options(kinds,state.kind,'All types')}</select><label class="sr-only" for="deliverable-filter-stage">Production stage filter</label><select id="deliverable-filter-stage" data-deliverable-filter="stage">${options(productionStages(),state.stage,'All stages')}</select><label class="sr-only" for="deliverable-sort">Sort deliverables</label><select id="deliverable-sort" data-deliverable-filter="sort">${options([['code','Camera code'],['title','Name'],['due_date','Target date'],['stage','Production stage']],state.sort)}</select></div></form>`;
  if(state.loading&&!state.items.length)return heading+tabs+filters+'<div class="empty" role="status">Loading deliverables…</div>';
  if(state.error)return heading+tabs+filters+`<div class="notice error" role="alert">${esc(state.error)}</div><button class="button" id="deliverable-retry" data-deliverable-action="refresh">Retry</button>`;
  const rows=state.items.map(item=>`<li><button type="button" id="deliverable-open-${esc(item.id)}" class="deliverable-row" data-deliverable-action="open" data-id="${esc(item.id)}"><span class="deliverable-code">${item.latest_render_id?`<img class="deliverable-thumb" src="/api/renders/${encodeURIComponent(item.latest_render_id)}/content?variant=thumbnail" alt="" loading="lazy">`:""}${esc(item.code)}</span><span class="deliverable-name">${esc(item.title)}</span><span class="deliverable-info"><span class="deliverable-kind">${esc(kind(item.kind))}</span><span class="deliverable-stage">${esc(item.stage)}</span><span class="deliverable-artist">${esc(artist(item.artist_id))}</span><span class="deliverable-date">${esc(date(item.due_date))}</span></span>${icon('arrow')}</button></li>`).join('');
  const empty=state.search||state.kind||state.stage?'No matching deliverables':state.archived?'No archived deliverables':founder()?'No deliverables yet':'No deliverables shared with you';
  return heading+tabs+filters+(rows?`<div class="deliverable-columns" aria-hidden="true"><span>Code</span><span>Name</span><span>Type</span><span>Production stage</span><span>Artist</span><span>Target date</span><span></span></div><ul class="deliverable-list" aria-label="Project deliverables">${rows}</ul>`:`<div class="empty"><b>${empty}</b>${founder()&&!state.archived?'Add the first camera, animation or panorama for this project.':'Assigned deliverables and linked work appear here.'}</div>`)+`<div class="spread deliverable-count"><small>${state.items.length} of ${state.total} matching deliverables</small>${state.hasMore?'<button class="button" id="deliverable-more" data-deliverable-action="more">Load more</button>':''}</div>`;
 }
 async function create(){
  if(!founder()||getProject()?.archived)throw Error('Only the project owner can add deliverables to an active project.');
  const c=context(),intent=++opening,people=await ownerChoices(getProject().id);if(!current(c)||intent!==opening)return;
  detail=null;openDialog('Add deliverable',`<form data-deliverable-form="create" data-project="${esc(c.project)}"><div class="form-error" role="alert"></div><div class="form-grid">${input('code','Camera code','','required maxlength="40" placeholder="e.g. INT-01" autofocus')}${select('kind','Deliverable type',kinds,'still')}</div>${input('title','Deliverable name','','required maxlength="200" placeholder="e.g. Living room hero"')}<div class="form-grid">${select('artist_id','Assigned artist',people,'','Unassigned')}${input('due_date','Target date','','type="date"')}${select('stage','Production stage',productionStages(),'Briefing')}</div>${note('')}<div class="form-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary">Create deliverable</button></div></form>`);
 }
 async function open(id){
  const c=context(),intent=++opening;const result=await request('/deliverables/'+encodeURIComponent(id));if(!current(c)||intent!==opening)return;
  const people=result.can_manage?await ownerChoices(result.project_id):[];if(!current(c)||intent!==opening)return;
  detail=result;try{await renders.load(result);}catch{/* The render section retains its real error and Retry. */}if(!current(c)||intent!==opening)return;showDetail(result,people);
 }
 function showDetail(item,people=[]){
  const editable=item.can_edit&&!item.archived&&!getProject()?.archived;
  const metadata=`<dl class="deliverable-meta"><div><dt>Camera code</dt><dd>${esc(item.code)}</dd></div><div><dt>Type</dt><dd>${esc(kind(item.kind))}</dd></div><div><dt>Artist</dt><dd>${esc(artist(item.artist_id))}</dd></div><div><dt>Target date</dt><dd>${esc(date(item.due_date))}</dd></div></dl>`;
  const fields=item.can_manage?`<div class="form-grid">${input('code','Camera code',item.code,'required maxlength="40"')}${select('kind','Deliverable type',kinds,item.kind)}</div>${input('title','Deliverable name',item.title,'required maxlength="200"')}<div class="form-grid">${select('artist_id','Assigned artist',people,item.artist_id,'Unassigned')}${input('due_date','Target date',item.due_date||'','type="date"')}</div>`:metadata;
  const editor=editable?`<form data-deliverable-form="edit" data-id="${esc(item.id)}" data-version="${item.version}"><div class="form-error" role="alert"></div>${fields}${select('stage','Production stage',productionStages(),item.stage)}${note(item.camera_notes)}<div class="form-actions"><button class="button primary" type="submit">Save deliverable</button></div></form>`:metadata+`<section class="detail-section"><h3>Production stage</h3><p>${esc(item.stage)}</p><h3>Camera brief</h3><p class="brief-copy">${esc(item.camera_notes||'No camera brief yet.')}</p></section>`;
  const tasks=(item.tasks||[]).map(task=>`<button type="button" class="deliverable-task" data-deliverable-action="task" data-id="${esc(task.id)}"><span>${esc(task.title)}<small>${esc(task.status)} · ${esc(date(task.due_date))}</small></span>${icon('arrow')}</button>`).join('');
  const history=(item.history||[]).map(event=>`<div class="event"><b>${esc(artist(event.actor_id))}</b><span> · ${esc(new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(event.created_at)))}</span><p>${Object.entries(event.changes||{}).filter(([field])=>field!=='project_id').map(([field,value])=>esc(({artist_id:'Artist',camera_notes:'Camera brief',due_date:'Target date',code:'Camera code',title:'Name',stage:'Stage',kind:'Type',archived:'Archived'})[field]||field)+': '+esc(field==='artist_id'?artist(value):field==='kind'?kind(value):value===null?'Not set':value)).join(' · ')}</p></div>`).join('');
  const taskCount=Number.isSafeInteger(item.task_total)?`${(item.tasks||[]).length} of ${item.task_total} tasks shared with you. `:'';
  openDialog(item.code+' · '+item.title,`<div class="deliverable-detail">${renders.summary(item)}${editor}<section class="detail-section"><div class="spread"><h3>Linked tasks</h3>${canCreateTask()&&!item.archived&&!getProject()?.archived?'<button class="button small" data-deliverable-action="create-task">'+icon('plus')+' Add task</button>':''}</div>${tasks||'<p class="muted">No tasks shared with you for this deliverable.</p>'}<small>${taskCount}Task comments and files retain their individual access.</small></section><section class="detail-section"><h3>Recent history</h3>${history}</section><div class="form-actions"><button class="button text" data-deliverable-action="reload">Reload latest</button>${item.can_manage&&!getProject()?.archived?`<button class="button text" data-deliverable-action="archive">${item.archived?'Restore deliverable':'Archive deliverable'}</button>`:''}</div></div>`,{drawer:true});
 }
 async function save(form){
  if(isSaving())return;const c=context(),token={...c},snapshot=detail;
  const body=Object.fromEntries(new FormData(form));if('artist_id' in body)body.artist_id=body.artist_id||null;if('due_date' in body)body.due_date=body.due_date||null;
  if(form.dataset.deliverableForm==='edit')for(const key of Object.keys(body))if(String(body[key]??'')===String(snapshot?.[key]??''))delete body[key];
  if(!Object.keys(body).length){toast('No changes to save');return;}
  pending=token;onBusy();const controls=Array.from(form.elements||[]).map(control=>[control,control.disabled]);for(const [control]of controls)control.disabled=true;form.setAttribute('aria-busy','true');form.dataset.pending='1';const submit=form.querySelector('[type="submit"]'),error=form.querySelector('.form-error');if(submit)submit.disabled=true;error.textContent='';
  try{
   const editing=form.dataset.deliverableForm==='edit';form.dataset.requestKey||=crypto.randomUUID();
   const result=await request(editing?'/deliverables/'+encodeURIComponent(form.dataset.id):'/projects/'+encodeURIComponent(form.dataset.project)+'/deliverables',editing?'PATCH':'POST',editing?{expectedVersion:Number(form.dataset.version),changes:body}:body,{'Idempotency-Key':form.dataset.requestKey});
   if(!current(c)||pending!==token)return;detail=result;
   try{await load();if(current(c)){render();toast('Deliverable saved');}}catch{if(current(c))toast('Deliverable saved. The list could not refresh; retry the list to check its latest state.');}
   if(current(c)&&pending===token){pending=null;onBusy();document.querySelector('#dialog')?.close();}
  }catch(problem){if(current(c)&&pending===token&&form.isConnected!==false)error.innerHTML=esc(problem.message)+(problem.status===409&&snapshot?'<div><button type="button" class="button" data-deliverable-action="reload">Reload latest</button></div>':'');}
  finally{if(pending===token)pending=null;onBusy();if(form.isConnected!==false){delete form.dataset.pending;form.removeAttribute('aria-busy');for(const [control,disabled]of controls)control.disabled=disabled;}}
 }
 async function archive(){
  if(!detail||!detail.can_manage||isSaving()||!canLeave())return;const c=context(),token={...c},item=detail;pending=token;onBusy();
  const form=document.querySelector('#dialog')?.querySelector('[data-deliverable-form]'),controls=Array.from(form?.elements||[]).map(control=>[control,control.disabled]);
  for(const [control]of controls)control.disabled=true;if(form){form.dataset.pending='1';form.setAttribute('aria-busy','true');}
  try{await request('/deliverables/'+encodeURIComponent(item.id),'PATCH',{expectedVersion:item.version,changes:{archived:!item.archived}});if(!current(c)||pending!==token)return;
   pending=null;onBusy();document.querySelector('#dialog')?.close();try{await load();if(current(c))render();}catch{if(current(c)){render();toast('Archive state saved. The list could not refresh; retry the list.');return;}}if(current(c))toast(item.archived?'Deliverable restored':'Deliverable archived');
  }catch(error){if(current(c))toast(error.message);}finally{if(pending===token)pending=null;onBusy();if(form?.isConnected!==false&&form){delete form.dataset.pending;form.removeAttribute('aria-busy');for(const [control,disabled]of controls)control.disabled=disabled;}}
 }
 async function refresh(){const result=load();render();try{await result;}catch{/* The view retains its real error and Retry action. */}render();}
 document.addEventListener('click',event=>{const control=event.target.closest('[data-deliverable-action]');if(!control||isSaving())return;event.preventDefault();const action=control.dataset.deliverableAction;
  const run=async()=>{
   if(action==='open')await open(control.dataset.id);
   else if(action==='create')await create();
   else if(action==='archive-view'){state.archived=control.dataset.value==='1';await refresh();}
   else if(action==='refresh')await refresh();
   else if(action==='more'){await load(true);render();}
   else if(action==='reload'&&detail&&canLeave())await open(detail.id);
   else if(action==='archive')await archive();
   else if(action==='create-task'&&detail&&canLeave())await onCreateTask(detail);
   else if(action==='task'&&canLeave())await onOpenTask(control.dataset.id);
  };run().catch(error=>toast(error.message));
 });
 document.addEventListener('submit',event=>{const form=event.target;if(form.matches('[data-deliverable-form]')){event.preventDefault();save(form).catch(error=>toast(error.message));}else if(form.matches('[data-deliverable-search]')){event.preventDefault();state.search=String(new FormData(form).get('search')||'').trim();refresh();}});
 document.addEventListener('change',event=>{const key=event.target.dataset?.deliverableFilter;if(!['kind','stage','sort'].includes(key))return;state[key]=event.target.value;refresh();});
 return {load,render:view,reset,open,create,isSaving,getState:()=>state};
}
