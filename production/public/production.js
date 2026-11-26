import {icon} from './icons.js';
import {productionStages} from './production-stages.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(name,label,value='',extra='')=>`<div class="field"><label for="project-${name}">${label}</label><input id="project-${name}" name="${name}" value="${esc(value)}" ${extra}></div>`;
const text=(name,label,value='',max=10000)=>`<div class="field"><label for="project-${name}">${label}</label><textarea id="project-${name}" name="${name}" maxlength="${max}">${esc(value)}</textarea></div>`;

export function createProductionProjects({request,openDialog,getData}){
 let records=[],project=null,archived=false,selection=0,listRequest=0;
 const directory={view:'grid',search:'',sort:'updated_at',direction:'desc'};
 const compareNames=new Intl.Collator('en',{numeric:true,sensitivity:'base'}).compare;
 const normalized=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const founder=()=>getData()?.actor.role==='founder';
 const eligible=()=>getData().members.filter(m=>m.sections?.includes('projects'));
 async function ownerChoices(projectId=''){
  const people=eligible();
  if(!founder())return people.filter(person=>person.id===getData()?.actor.id).map(person=>[person.id,person.name]);
  if(!projectId)return people.map(person=>[person.id,person.name]);
  const actor=getData()?.actor.id,details=project?.id===projectId?project:await request('/projects/'+encodeURIComponent(projectId));
  if(actor!==getData()?.actor.id||!founder())return [];
  const participants=new Set(details.member_ids||[]);participants.add(details.lead_id);
  return people.filter(person=>person.role==='founder'||participants.has(person.id)).map(person=>[person.id,person.name]);
 }
 async function load(){const version=++listRequest,actor=getData()?.actor.id,result=await request('/projects?archived='+(archived?'1':'0'));if(version===listRequest&&actor===getData()?.actor.id)records=result.items;return result.items;}
 async function open(id){const version=++selection,actor=getData()?.actor.id,result=await request('/projects/'+encodeURIComponent(id));if(version===selection&&actor===getData()?.actor.id)project=result;return result;}
 function reset(){selection++;listRequest++;records=[];project=null;archived=false;Object.assign(directory,{view:'grid',search:'',sort:'updated_at',direction:'desc'});}
 function setDirectory(changes={}){
  if(['grid','list'].includes(changes.view))directory.view=changes.view;
  if(typeof changes.search==='string')directory.search=changes.search.slice(0,200);
  if(['title','updated_at','created_at','due_date'].includes(changes.sort)){directory.sort=changes.sort;if(!changes.direction)directory.direction=['title','due_date'].includes(changes.sort)?'asc':'desc';}
  if(['asc','desc'].includes(changes.direction))directory.direction=changes.direction;
 }
 function directoryItems(){
  const words=normalized(directory.search).trim().split(/\s+/).filter(Boolean),sign=directory.direction==='asc'?1:-1;
  return records.filter(row=>{const text=normalized([row.title,row.client_name,row.location,row.project_type].join(' '));return words.every(word=>text.includes(word));}).sort((a,b)=>{
   let order=0;
   if(directory.sort==='title')order=sign*compareNames(String(a.title||''),String(b.title||''));
   else{const value=row=>row[directory.sort]?Date.parse(row[directory.sort]):NaN,left=value(a),right=value(b),hasLeft=Number.isFinite(left),hasRight=Number.isFinite(right);if(hasLeft!==hasRight)return hasLeft?-1:1;if(hasLeft)order=sign*(left-right);}
   return order||compareNames(String(a.title||''),String(b.title||''))||String(a.id).localeCompare(String(b.id));
  });
 }
 function directoryDate(record){
  if(directory.sort==='due_date')return record.due_date?'Delivery '+deliveryDate(record.due_date):'No delivery date';
  const value=record.updated_at&&new Date(record.updated_at);return value&&Number.isFinite(value.getTime())?'Edited '+new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'Europe/Paris'}).format(value):'Update date unavailable';
 }
 function directoryStatus(record){return `<span class="project-card-status${record.archived?' is-archived':record.blocked||record.overdue?' needs-attention':''}">${projectStatus(record)}</span>`;}
 function directoryToolbar(){return `<div class="project-index-actions"><div class="project-search">${icon('search')}<label class="sr-only" for="project-search">Search projects</label><input id="project-search" type="search" maxlength="200" placeholder="Search projects" value="${esc(directory.search)}" autocomplete="off">${directory.search?`<button type="button" class="project-search-clear" data-action="project-search-clear" aria-label="Clear project search">${icon('close')}</button>`:''}</div><details class="project-directory-menu project-sort-menu"><summary role="button" class="icon-btn" aria-label="Sort projects" data-project-sort-toggle>${icon('sort')}</summary><div class="project-directory-options"><p>Sort by</p><div role="group" aria-label="Sort projects by">${[['title','Project name'],['updated_at','Last updated'],['created_at','Created'],['due_date','Delivery date']].map(([value,label])=>`<button type="button" data-action="project-directory-sort" data-value="${value}" aria-pressed="${directory.sort===value}"><span>${label}</span>${directory.sort===value?icon('check'):''}</button>`).join('')}</div><div class="project-directory-order" role="group" aria-label="Project sort order">${[['asc','Ascending'],['desc','Descending']].map(([value,label])=>`<button type="button" data-action="project-directory-direction" data-value="${value}" aria-pressed="${directory.direction===value}"><span>${label}</span>${directory.direction===value?icon('check'):''}</button>`).join('')}</div></div></details>${founder()?'<button class="button primary" data-action="project-create">Create project</button>':''}</div>`;}
 function directoryViewControl(){return `<details class="project-directory-menu project-view-menu"><summary role="button" aria-label="Project view: ${directory.view==='grid'?'Grid':'List'}" data-project-view-toggle>${directory.view==='grid'?'Grid':'List'}${icon('down')}</summary><div class="project-directory-options" role="group" aria-label="Project view">${[['grid','Grid'],['list','List']].map(([value,label])=>`<button type="button" data-action="project-directory-view" data-value="${value}" aria-pressed="${directory.view===value}"><span>${label}</span>${directory.view===value?icon('check'):''}</button>`).join('')}<div class="project-directory-order"><button type="button" data-action="project-tab" data-value="tasks">All production work</button></div></div></details>`;}
 function directoryCards(){
  const visible=directoryItems();
  if(!visible.length)return records.length?`<section class="project-empty"><h2>No matching projects</h2><p>Try another project name, client or location.</p><button type="button" class="button text" data-action="project-search-clear">Clear search</button></section>`:`<section class="project-empty"><h2>${archived?'No archived projects':'No projects yet'}</h2><p>${founder()?'Create a project to collect its brief, team and work in one place.':'Projects appear when a brief is shared with you. Your existing assignments remain in All production work.'}</p></section>`;
  return `<p class="sr-only" role="status">${visible.length} project${visible.length===1?'':'s'} shown</p><div class="${directory.view==='list'?'project-list':'project-grid'}">${visible.map(record=>{const media=`<span class="project-card-media" aria-hidden="true">${record.has_cover?`<img src="/api/projects/${encodeURIComponent(record.id)}/cover?variant=thumbnail" alt="" loading="lazy">`:''}</span>`,title=`<span class="project-card-title">${esc(record.title)}</span>`,date=esc(directoryDate(record));return `<button type="button" class="project-card" data-action="project-open" data-id="${esc(record.id)}" title="${esc(record.title)}">${media}${directory.view==='list'?`<span class="project-list-name">${title}${directoryStatus(record)}</span><span class="project-list-updated">${date}</span>`:`<span class="project-card-caption">${title}<span class="project-card-meta">${directoryStatus(record)}<span aria-hidden="true">·</span><span class="project-card-updated">${date}</span></span></span>`}</button>`;}).join('')}</div>`;
 }
 function context(task){const p=task.project;if(!p)return task.project_id?'<div class="notice">This task’s project brief is not shared with your current account. The task remains available under your existing assignment.</div>':'';return `<section class="task-context"><p class="eyebrow">Project brief</p><button class="context-title" data-action="project-open" data-id="${esc(p.id)}">${esc(p.title)} ${icon('arrow')}</button>${p.brief?`<p>${esc(p.brief)}</p>`:''}${p.outcome?`<details><summary>What good looks like</summary><p>${esc(p.outcome)}</p></details>`:''}${p.reference_url?`<a class="reference-link" href="${esc(p.reference_url)}" target="_blank" rel="noopener noreferrer">Open project references ${icon('arrow')}</a>`:''}</section>`;}
 function fields(task={}){
  const editing=!!task.id||Object.hasOwn(task,'project_id'),current=(editing?task.project_id:project?.id)||'',choices=[...records];
  if(task.project&&!choices.some(p=>p.id===task.project.id))choices.push(task.project);
  if(project&&!choices.some(p=>p.id===project.id))choices.push(project);
  const unavailable=current&&!choices.some(p=>p.id===current)?`<option value="${esc(current)}" selected>Project brief not shared</option>`:'';
  return `<div class="form-grid"><div class="field"><label for="task-project">Project</label><select name="project_id" id="task-project"><option value="">No project · standalone work</option>${unavailable}${choices.filter(p=>!p.archived||p.id===current).map(p=>`<option value="${esc(p.id)}" ${p.id===current?'selected':''}>${esc(p.title)}</option>`).join('')}</select></div><div class="field"><label for="task-stage">Production stage</label><select name="production_stage" id="task-stage"><option value="">Not set</option>${productionStages(task.production_stage).map(stage=>`<option value="${stage}" ${stage===task.production_stage?'selected':''}>${stage}</option>`).join('')}</select></div></div>${getData()?.capabilities?.deliverables==='records'?`<div class="field"><label for="task-deliverable">Image / deliverable</label><select name="deliverable_id" id="task-deliverable" data-project="${esc(current)}"><option value="">No specific deliverable</option>${task.deliverable_id?`<option value="${esc(task.deliverable_id)}" selected>${esc(task.deliverable?task.deliverable.code+' · '+task.deliverable.title:'Current deliverable')}</option>`:''}</select></div>`:''}`;
 }
 function form(edit=false){
  const p=edit?project:null,people=eligible();
  openDialog(edit?'Edit project brief':'New project',`<form data-project-form="${edit?'edit':'create'}" ${edit?`data-id="${esc(p.id)}" data-version="${p.version}"`:''}><div class="form-error" role="alert"></div>${field('title','Project name',p?.title,'required maxlength="200" placeholder="e.g. Courtyard residence"')}${getData()?.capabilities?.projectPlanning==='records'?`<div class="form-grid">${field('client_name','Client / company',p?.client_name,'maxlength="200"')}${field('project_type','Project type',p?.project_type,'maxlength="100"')}</div>${field('location','Project location',p?.location,'maxlength="200"')}<p class="muted">These details are shared with people who can read the project brief.</p>`:''}${text('brief','Creative brief',p?.brief)}${text('outcome','Definition of done',p?.outcome,5000)}${field('reference_url','Reference folder or brief link',p?.reference_url,'type="url" placeholder="https://…" maxlength="2000"')}${getData()?.capabilities?.projectPlanning==='records'?field('start_date','Project start date',p?.start_date||'','type="date"'):''}<div class="form-grid">${field('due_date','Project delivery deadline',p?.due_date||'','type="date"')}<div class="field"><label for="project-lead">Project lead</label><select id="project-lead" name="lead_id">${people.map(m=>`<option value="${esc(m.id)}" ${m.id===(p?.lead_id||getData().actor.id)?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div></div><fieldset class="participant-picker"><legend>People who can read this brief</legend><p>Participation shares the brief only. Each person still sees their own assigned tasks. The project lead is always included.</p>${people.map(m=>`<label class="check-row"><input type="checkbox" name="member_ids" value="${esc(m.id)}" ${p?.member_ids?.includes(m.id)?'checked':''}><span>${esc(m.name)}</span></label>`).join('')}</fieldset><div class="form-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">${edit?'Save brief':'Create project'}</button></div></form>`);
 }
 async function save(form,captured=null){
  const data=captured||new FormData(form),body=Object.fromEntries(data);body.member_ids=data.getAll('member_ids');
  form.dataset.requestKey||=crypto.randomUUID();
  const result=await request('/projects'+(form.dataset.id?'/'+encodeURIComponent(form.dataset.id):''),form.dataset.id?'PATCH':'POST',form.dataset.id?{expectedVersion:Number(form.dataset.version),changes:body}:body,{'Idempotency-Key':form.dataset.requestKey});
  await load();return result;
 }
 function projectStatus(record){return record.archived?'Archived':record.blocked||record.overdue?'Needs attention':'Active';}
 function deliveryDate(value,full=false){return value?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:full?'long':'short',...(full?{year:'numeric'}:{}),timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'Not scheduled';}
 function projectTeam(){
  if(!founder())return `<section class="project-team" aria-labelledby="project-team-title"><h2 id="project-team-title">Project access</h2><p>This brief is shared with you. Your assigned tasks keep their individual access.</p></section>`;
  const ids=[...new Set([...(project.member_ids||[]),project.lead_id].filter(Boolean))];
  return `<section class="project-team" aria-labelledby="project-team-title"><div class="project-team-heading"><h2 id="project-team-title">Project team</h2><button class="button small" data-action="project-edit">Edit brief & team</button></div><ul class="project-team-list">${ids.map(id=>{const person=getData().members.find(member=>member.id===id);return `<li><span class="avatar" aria-hidden="true">${esc(person?.initials||'—')}</span><span>${esc(person?.name||'Studio member')}</span>${id===project.lead_id?'<small>Project lead</small>':''}</li>`;}).join('')}</ul><p>Sharing this brief does not change anyone’s task access.</p></section>`;
 }
 function projectMetrics(){
  const lead=getData().members.find(person=>person.id===project.lead_id),participants=new Set([...(project.member_ids||[]),project.lead_id].filter(Boolean)).size;
  const access=founder()?participants+' participant'+(participants===1?'':'s'):'Shared with you';
  return `<dl class="project-metric-strip" aria-label="Project details"><div class="project-metric"><dt>Project lead</dt><dd>${esc(lead?.name||'Studio member')}</dd></div><div class="project-metric"><dt>Delivery deadline</dt><dd>${esc(deliveryDate(project.due_date,true))}</dd></div><div class="project-metric"><dt>Status</dt><dd>${project.archived?'Archived':'Active'}</dd></div><div class="project-metric"><dt>Brief access</dt><dd>${esc(access)}</dd></div></dl>`;
 }
 function projectHash(view='overview'){
  if(!project)return '#projects';
  return '#projects/'+encodeURIComponent(project.id)+(['work','images','reviews','files','references','notes','revisions','delivery','milestones'].includes(view)?'/'+view:'');
 }
 function projectViewLabel(view='overview'){return view==='work'?'Project Management':view==='images'?'Images & deliverables':view==='reviews'?'Client reviews':view==='files'?'Files':view==='references'?'References':view==='notes'?'Notes':view==='revisions'?'Revision rounds':view==='delivery'?'Final delivery':view==='milestones'?'Milestones':'Overview';}
 function navigation(view='overview'){
  if(!project)return '';
  const active=['work','images','reviews','files','references','notes','revisions','delivery','milestones'].includes(view)?view:'overview';
  const choices=[project,...records.filter(record=>record.id!==project.id)];
  return `<div class="project-context-heading"><button type="button" class="icon-btn project-nav-back" aria-label="Back to projects" title="Back to projects" data-action="project-back">${icon('arrow')}</button><details class="project-switcher"><summary aria-label="Switch project: ${esc(project.title)}"><span class="project-context-name">${esc(project.title)}</span>${icon('chevron')}</summary><div class="project-switcher-menu" aria-label="Available projects">${choices.map(record=>`<button type="button" data-action="project-open" data-id="${esc(record.id)}" aria-pressed="${record.id===project.id}">${esc(record.title)}</button>`).join('')}</div></details></div><nav aria-label="Project navigation" data-project-navigation>${[['overview','overview'],...(getData()?.capabilities?.deliverables==='records'?[['images','image']]:[]),...(founder()&&getData()?.capabilities?.clientReviews==='records'?[['reviews','team']]:[]),['work','tasks'],...(getData()?.capabilities?.projectMilestones==='records'?[['milestones','tasks']]:[]),...(getData()?.capabilities?.projectDelivery==='records'?[['revisions','tasks'],...(founder()?[['delivery','library']]:[])]:[]),...(getData()?.capabilities?.projectResources==='records'?[['files','library'],['references','image'],['notes','tasks']]:[])].map(([key,symbol])=>`<a class="nav-link ${active===key?'active':''}" href="${esc(projectHash(key))}" ${active===key?'aria-current="page"':''}>${icon(symbol)}${projectViewLabel(key)}</a>`).join('')}</nav>`;
 }
 function projectWorkSummary(projectTaskCount){
  const count=Number.isSafeInteger(projectTaskCount)&&projectTaskCount>=0?projectTaskCount:null;
  return `<section class="project-overview-work" aria-labelledby="project-task-summary-title"><div><h2 id="project-task-summary-title">Project tasks</h2>${count===null?'':`<strong class="project-task-total">${count.toLocaleString('en-GB')}</strong>`}<p>${founder()?'All permitted tasks linked to this project.':'Your assigned tasks linked to this project.'}</p></div><div class="project-overview-actions"><a class="button" href="${esc(projectHash('work'))}">Open Project Management</a>${founder()?`<button class="button text small" data-action="project-archive">${project.archived?'Restore project':'Archive project'}</button>`:''}</div></section>`;
 }
 function render({taskWorkspace,newTaskButton,taskTab=false,projectView='overview',projectTaskCount=null,deliverableView,clientReviewView,planningOverview,resourceView,deliveryView,milestonesView}){
  if(project){
   if(['revisions','delivery'].includes(projectView)&&getData()?.capabilities?.projectDelivery==='records'&&deliveryView)return deliveryView(projectView);
   if(projectView==='milestones'&&getData()?.capabilities?.projectMilestones==='records'&&milestonesView)return milestonesView();
   if(['files','references','notes'].includes(projectView)&&getData()?.capabilities?.projectResources==='records'&&resourceView)return resourceView(projectView);
   if(projectView==='images'&&getData()?.capabilities?.deliverables==='records')return deliverableView();
   if(projectView==='reviews'&&getData()?.capabilities?.clientReviews==='records')return clientReviewView();
   if(projectView==='work')return `<div class="page-head project-detail-header"><div><h1>Project Management</h1>${getData()?.capabilities?.projectPlanning==='records'?'':`<p>${esc(project.title)}</p>`}</div>${!project.archived?newTaskButton('projects'):''}</div><section class="project-work-section" aria-label="Project tasks">${taskWorkspace('projects')}</section>`;
   if(getData()?.capabilities?.projectPlanning==='records'&&planningOverview)return planningOverview({newTaskButton,projectTaskCount});
   const hasContext=!!(project.outcome||project.reference_url);
   const metadata=hasContext?`<aside class="project-overview-meta" aria-label="Project context">${project.outcome?`<section><h2>Definition of done</h2><p class="brief-copy">${esc(project.outcome)}</p></section>`:''}${project.reference_url?`<section><h2>References</h2><p>Open the project’s shared reference folder or brief.</p><a class="button small" href="${esc(project.reference_url)}" target="_blank" rel="noopener noreferrer">Open project references ${icon('arrow')}</a></section>`:''}</aside>`:'';
   return `<div class="page-head project-detail-header"><div><h1>${esc(project.title)}</h1></div>${!project.archived?newTaskButton('projects'):''}</div>
    <div class="project-overview-grid${hasContext?'':' project-overview-single'}"><div><section class="project-brief" aria-labelledby="project-brief-title"><h2 id="project-brief-title">Project brief</h2><p class="brief-copy">${esc(project.brief||'No brief has been written yet.')}</p></section>${projectTeam()}</div>${metadata}</div>
    ${projectMetrics()}
    ${projectWorkSummary(projectTaskCount)}`;
  }
  const archiveTab=(value,title,active)=>`<button class="tab ${active?'active':''}" data-action="project-archived" data-value="${value}" aria-pressed="${active}">${title}</button>`;
  return `<section class="project-directory"><div class="page-head project-index-header"><h1>Projects</h1>${taskTab?'':directoryToolbar()}</div><div class="project-navigation"><div class="tabs" aria-label="Production views">${archiveTab('all','All',!taskTab&&!archived)}${archiveTab('archived','Archived',!taskTab&&archived)}${taskTab?'<button class="tab active" data-action="project-tab" data-value="tasks" aria-pressed="true">All production work</button>':''}</div>${taskTab?newTaskButton('projects'):directoryViewControl()}</div>${taskTab?taskWorkspace('projects'):directoryCards()}${!taskTab&&records.length>=200?'<p class="panel-foot">Showing the first 200 permitted projects. Search and sorting apply to these results.</p>':''}</section>`;
 }

 return {load,open,reset,form,save,fields,ownerChoices,context,render,navigation,projectHash,projectViewLabel,setDirectory,getDirectory:()=>({...directory}),getProject:()=>project,getRecords:()=>records,select:result=>{selection++;project=result;},back:()=>{selection++;project=null;},toggleArchive:value=>{archived=value==='all'?false:value==='archived'?true:!archived;}};
}
