import {icon} from './icons.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stages=['Brief','Modelling','Materials','Lighting','Internal review','Client review','Revisions','Delivery'];
const field=(name,label,value='',extra='')=>`<div class="field"><label for="project-${name}">${label}</label><input id="project-${name}" name="${name}" value="${esc(value)}" ${extra}></div>`;
const text=(name,label,value='',max=10000)=>`<div class="field"><label for="project-${name}">${label}</label><textarea id="project-${name}" name="${name}" maxlength="${max}">${esc(value)}</textarea></div>`;

export function createProductionProjects({request,openDialog,getData}){
 let records=[],project=null,archived=false,selection=0,listRequest=0;
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
 function reset(){selection++;listRequest++;records=[];project=null;archived=false;}
 function context(task){const p=task.project;if(!p)return task.project_id?'<div class="notice">This task’s project brief is not shared with your current account. The task remains available under your existing assignment.</div>':'';return `<section class="task-context"><p class="eyebrow">Project brief</p><button class="context-title" data-action="project-open" data-id="${esc(p.id)}">${esc(p.title)} ${icon('arrow')}</button>${p.brief?`<p>${esc(p.brief)}</p>`:''}${p.outcome?`<details><summary>What good looks like</summary><p>${esc(p.outcome)}</p></details>`:''}${p.reference_url?`<a class="reference-link" href="${esc(p.reference_url)}" target="_blank" rel="noopener noreferrer">Open project references ${icon('arrow')}</a>`:''}</section>`;}
 function fields(task={}){
  const editing=!!task.id||Object.hasOwn(task,'project_id'),current=(editing?task.project_id:project?.id)||'',choices=[...records];
  if(task.project&&!choices.some(p=>p.id===task.project.id))choices.push(task.project);
  if(project&&!choices.some(p=>p.id===project.id))choices.push(project);
  const unavailable=current&&!choices.some(p=>p.id===current)?`<option value="${esc(current)}" selected>Project brief not shared</option>`:'';
  return `<div class="form-grid"><div class="field"><label for="task-project">Project</label><select name="project_id" id="task-project"><option value="">No project · standalone work</option>${unavailable}${choices.filter(p=>!p.archived||p.id===current).map(p=>`<option value="${esc(p.id)}" ${p.id===current?'selected':''}>${esc(p.title)}</option>`).join('')}</select></div><div class="field"><label for="task-stage">Production stage</label><select name="production_stage" id="task-stage"><option value="">Not set</option>${stages.map(stage=>`<option value="${stage}" ${stage===task.production_stage?'selected':''}>${stage}</option>`).join('')}</select></div></div>`;
 }
 function form(edit=false){
  const p=edit?project:null,people=eligible();
  openDialog(edit?'Edit project brief':'New project',`<form data-project-form="${edit?'edit':'create'}" ${edit?`data-id="${esc(p.id)}" data-version="${p.version}"`:''}><div class="form-error" role="alert"></div>${field('title','Project name',p?.title,'required maxlength="200" placeholder="e.g. Courtyard residence"')}${text('brief','Creative brief',p?.brief)}${text('outcome','Definition of done',p?.outcome,5000)}${field('reference_url','Reference folder or brief link',p?.reference_url,'type="url" placeholder="https://…" maxlength="2000"')}<div class="form-grid">${field('due_date','Project delivery deadline',p?.due_date||'','type="date"')}<div class="field"><label for="project-lead">Project lead</label><select id="project-lead" name="lead_id">${people.map(m=>`<option value="${esc(m.id)}" ${m.id===(p?.lead_id||getData().actor.id)?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div></div><fieldset class="participant-picker"><legend>People who can read this brief</legend><p>Participation shares the brief only. Each person still sees their own assigned tasks. The project lead is always included.</p>${people.map(m=>`<label class="check-row"><input type="checkbox" name="member_ids" value="${esc(m.id)}" ${p?.member_ids?.includes(m.id)?'checked':''}><span>${esc(m.name)}</span></label>`).join('')}</fieldset><div class="form-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">${edit?'Save brief':'Create project'}</button></div></form>`);
 }
 async function save(form){
  const data=new FormData(form),body=Object.fromEntries(data);body.member_ids=data.getAll('member_ids');
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
  return '#projects/'+encodeURIComponent(project.id)+(view==='work'?'/work':'');
 }
 function projectViewLabel(view='overview'){return view==='work'?'Project Management':'Overview';}
 function navigation(view='overview'){
  if(!project)return '';
  const active=view==='work'?'work':'overview';
  const choices=[project,...records.filter(record=>record.id!==project.id)];
  return `<div class="project-context-heading"><button type="button" class="icon-btn project-nav-back" aria-label="Back to projects" title="Back to projects" data-action="project-back">${icon('arrow')}</button><details class="project-switcher"><summary aria-label="Switch project: ${esc(project.title)}"><span class="project-context-name">${esc(project.title)}</span>${icon('chevron')}</summary><div class="project-switcher-menu" aria-label="Available projects">${choices.map(record=>`<button type="button" data-action="project-open" data-id="${esc(record.id)}" aria-pressed="${record.id===project.id}">${esc(record.title)}</button>`).join('')}</div></details></div><nav aria-label="Project navigation" data-project-navigation>${[['overview','overview'],['work','tasks']].map(([key,symbol])=>`<a class="nav-link ${active===key?'active':''}" href="${esc(projectHash(key))}" ${active===key?'aria-current="page"':''}>${icon(symbol)}${projectViewLabel(key)}</a>`).join('')}</nav>`;
 }
 function projectWorkSummary(projectTaskCount){
  const count=Number.isSafeInteger(projectTaskCount)&&projectTaskCount>=0?projectTaskCount:null;
  return `<section class="project-overview-work" aria-labelledby="project-task-summary-title"><div><h2 id="project-task-summary-title">Project tasks</h2>${count===null?'':`<strong class="project-task-total">${count.toLocaleString('en-GB')}</strong>`}<p>${founder()?'All permitted tasks linked to this project.':'Your assigned tasks linked to this project.'}</p></div><div class="project-overview-actions"><a class="button" href="${esc(projectHash('work'))}">Open Project Management</a>${founder()?`<button class="button text small" data-action="project-archive">${project.archived?'Restore project':'Archive project'}</button>`:''}</div></section>`;
 }
 function render({taskWorkspace,newTaskButton,taskTab=false,projectView='overview',projectTaskCount=null}){
  if(project){
   if(projectView==='work')return `<div class="page-head project-detail-header"><div><h1>Project Management</h1><p>${esc(project.title)}</p></div>${!project.archived?newTaskButton('projects'):''}</div><section class="project-work-section" aria-label="Project tasks">${taskWorkspace('projects')}</section>`;
   const hasContext=!!(project.outcome||project.reference_url);
   const metadata=hasContext?`<aside class="project-overview-meta" aria-label="Project context">${project.outcome?`<section><h2>Definition of done</h2><p class="brief-copy">${esc(project.outcome)}</p></section>`:''}${project.reference_url?`<section><h2>References</h2><p>Open the project’s shared reference folder or brief.</p><a class="button small" href="${esc(project.reference_url)}" target="_blank" rel="noopener noreferrer">Open project references ${icon('arrow')}</a></section>`:''}</aside>`:'';
   return `<div class="page-head project-detail-header"><div><h1>${esc(project.title)}</h1></div>${!project.archived?newTaskButton('projects'):''}</div>
    <div class="project-overview-grid${hasContext?'':' project-overview-single'}"><div><section class="project-brief" aria-labelledby="project-brief-title"><h2 id="project-brief-title">Project brief</h2><p class="brief-copy">${esc(project.brief||'No brief has been written yet.')}</p></section>${projectTeam()}</div>${metadata}</div>
    ${projectMetrics()}
    ${projectWorkSummary(projectTaskCount)}`;
  }
  const archiveTab=(value,title,active)=>`<button class="tab ${active?'active':''}" data-action="project-archived" data-value="${value}" aria-pressed="${active}">${title}</button>`;
  const directory=records.length?`<div class="project-grid">${records.map(record=>`<button class="project-card" data-action="project-open" data-id="${esc(record.id)}"><span class="project-card-media" aria-hidden="true"></span><span class="project-card-caption"><span class="project-card-title">${esc(record.title)}</span><span class="project-card-meta"><span class="project-card-status">${projectStatus(record)}</span><span class="project-card-date">${record.due_date?'Delivery '+esc(deliveryDate(record.due_date)):'No delivery date'}</span></span></span></button>`).join('')}</div>`:`<section class="project-empty"><h2>${archived?'No archived projects':'No projects yet'}</h2><p>${founder()?'Create a project to collect its brief, team and work in one place.':'Projects appear when a brief is shared with you. Your existing assignments remain in All production work.'}</p></section>`;
  return `<section class="project-directory"><div class="page-head project-index-header"><h1>Projects</h1>${founder()?'<button class="button primary" data-action="project-create">Create project</button>':''}</div><div class="project-navigation"><div class="tabs" aria-label="Production views">${archiveTab('all','All',!taskTab&&!archived)}${archiveTab('archived','Archived',!taskTab&&archived)}<button class="tab ${taskTab?'active':''}" data-action="project-tab" data-value="tasks" aria-pressed="${taskTab}">All production work</button></div>${taskTab?newTaskButton('projects'):''}</div>${taskTab?taskWorkspace('projects'):directory}${!taskTab&&records.length>=200?'<p class="panel-foot">Showing the first 200 permitted projects.</p>':''}</section>`;
 }

 return {load,open,reset,form,save,fields,ownerChoices,context,render,navigation,projectHash,projectViewLabel,getProject:()=>project,getRecords:()=>records,select:result=>{selection++;project=result;},back:()=>{selection++;project=null;},toggleArchive:value=>{archived=value==='all'?false:value==='archived'?true:!archived;}};
}
