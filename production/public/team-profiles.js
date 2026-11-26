const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roles={founder:'Founder',sales_manager:'Sales Manager',sales:'Sales Representative',production_manager:'Production Manager',artist:'CGI Artist',freelancer:'Freelancer'};
const events=[['assignment','Task assignments','When another person assigns a task to you.'],['due','Tasks due today','When the scheduled daily reminder runs for your tasks due today.'],['overdue','Overdue tasks','When the scheduled daily reminder runs for your overdue tasks.']];
const button=(label,action,extra='')=>`<button type="button" class="button small" data-team-action="${action}" ${extra}>${label}</button>`;
const errorRegion=()=>'<div class="form-error" role="alert" tabindex="-1"></div>';
const input=(name,label,value,extra='')=>`<div class="field"><label for="team-${name}">${label}</label><input id="team-${name}" name="${name}" value="${esc(value)}" ${extra}></div>`;
const pager=(page,action)=>`<div class="team-pagination"><span>${page.total} ${action==='directory'?'people':'departments'} · Page ${page.page}</span><div>${button('Previous',action+'-previous',page.page>1?'':'disabled')}${button('Next',action+'-next',page.hasMore?'':'disabled')}</div></div>`;

/** Presentation sits beside the existing account/invitation/access controls;
 * no profile or department field is an authorization input. */
export function createTeamProfiles({request,getData,openDialog,toast,render,onChange=async()=>{},onBusy=()=>{},contextKey=()=>''}){
 const state={tab:'profile',profile:null,profileDraft:null,notificationDraft:null,directory:null,departments:null,search:'',directoryPage:1,departmentPage:1,includeArchived:false,loading:new Set(),errors:{},formErrors:{},dirty:false,uncertain:false};
 let generation=0,opening=0,pending=null,editor=null,retryDraft=null;const reads=new Map(),boundDialogs=new WeakSet();
 const founder=()=>getData()?.actor?.role==='founder',actor=()=>getData()?.actor?.id;
 const capture=()=>({generation,actor:actor(),role:getData()?.actor?.role,key:contextKey()});
 const current=c=>c.generation===generation&&c.actor===actor()&&c.role===getData()?.actor?.role&&c.key===contextKey()&&!!getData();
 const isBusy=()=>!!pending&&current(pending);
 const activeForms=()=>document.querySelectorAll?.('form[data-team-form]')||[];
 function syncBusy(){for(const form of activeForms())for(const control of form.querySelectorAll('input,select,button'))control.disabled=isBusy()||state.uncertain&&control.type!=='submit';onBusy();}
 function reset(){generation++;opening++;reads.clear();pending=null;editor=null;retryDraft=null;state.profile=state.profileDraft=state.notificationDraft=state.directory=state.departments=null;state.tab='profile';state.errors={};state.formErrors={};state.loading.clear();state.dirty=state.uncertain=false;state.directoryPage=state.departmentPage=1;state.search='';onBusy();}
 function canLeave(){if(isBusy())return false;if((state.dirty||state.uncertain)&&!confirm(state.uncertain?'Leave this unsaved result? Reload saved settings before making a different change.':'Discard your unsaved settings changes?'))return false;state.dirty=state.uncertain=false;retryDraft=null;state.formErrors={};if(state.profile)profileValue(state.profile);return true;}
 function profileValue(value){
  if(!value||value.id!==actor()||typeof value.name!=='string'||typeof value.job_title!=='string'||!Number.isSafeInteger(value.revision)||value.revision<0||events.some(([key])=>typeof value.notifications?.[key]!=='boolean'))throw new Error('The saved profile could not be verified.');
  state.profile=value;state.profileDraft={name:value.name,job_title:value.job_title};state.notificationDraft={...value.notifications};
 }
 function listValue(value){if(!value||!Array.isArray(value.items)||value.items.length>50||!Number.isSafeInteger(value.total)||value.total<0||!Number.isSafeInteger(value.page)||value.page<1||value.pageSize!==50||typeof value.hasMore!=='boolean'||value.items.some(row=>!row||typeof row.id!=='string'||typeof row.name!=='string'||!Number.isSafeInteger(row.revision)||row.revision<0))throw new Error('The saved team list could not be verified.');return value;}
 async function read(kind,path){const c=capture(),version=(reads.get(kind)||0)+1;reads.set(kind,version);state.loading.add(kind);delete state.errors[kind];if(kind!=='profile')state[kind]=null;try{const result=await request(path);if(!current(c)||version!==reads.get(kind))return null;if(kind==='profile'){if(state.profile&&(state.dirty||state.uncertain||isBusy()))return state.profile;profileValue(result);}else state[kind]=listValue(result);return result;}catch(error){if(current(c)&&version===reads.get(kind)){if([401,403].includes(error.status)){reset();}state.errors[kind]=error.message;}throw error;}finally{if(current(c)&&version===reads.get(kind))state.loading.delete(kind);}}
 async function loadSettings({force=false}={}){if(!force&&state.profile&&(state.dirty||state.uncertain||isBusy()))return state.profile;return read('profile','/team/profile');}
 async function loadDirectory(){if(!founder())return;return read('directory','/team/directory?page='+state.directoryPage+'&search='+encodeURIComponent(state.search));}
 async function loadDepartments(){if(!founder())return;return read('departments','/team/departments?page='+state.departmentPage+'&archived='+(state.includeArchived?'1':'0'));}
 function loading(kind){return state.errors[kind]?`<div class="notice error" role="alert">${esc(state.errors[kind])}</div>${button('Retry','reload-'+kind)}`:`<p class="muted" role="status">Loading ${kind==='profile'?'your profile':kind}…</p>`;}
 const formError=kind=>`<div class="form-error" role="alert" tabindex="-1">${state.formErrors[kind]||''}</div>`;
 function profile(){
  if(!state.profile||state.loading.has('profile')||state.errors.profile)return loading('profile');const p=state.profile,draft=state.profileDraft;
  return `<div class="team-settings-heading"><h2>Professional profile</h2><p>Your name and job title identify you in the studio.</p></div><form data-team-form="profile" class="team-profile-form">${formError('profile')}${input('name','Full name',draft.name,'required maxlength="100" autocomplete="name"')}${input('job_title','Job title',draft.job_title,'maxlength="100" autocomplete="organization-title"')}<dl class="team-profile-details"><div><dt>Department</dt><dd>${esc(p.department?.name||'Not assigned')}${p.department?.archived?' (archived)':''}</dd></div></dl><p class="muted team-note">Your Founder manages departments and workspace access.</p><div class="form-actions"><button class="button primary" type="submit">Save profile</button></div></form>`;
 }
 function preferences(){
  if(!state.profile||state.loading.has('profile')||state.errors.profile)return loading('profile');
  return `<div class="team-settings-heading"><h2>Notifications</h2><p>Choose the task events that create a notification in your NAM inbox.</p></div><form data-team-form="notifications" class="team-preferences">${formError('notifications')}<fieldset><legend>Task inbox events</legend>${events.map(([key,label,description])=>`<label class="team-preference-row"><input type="checkbox" name="${key}" ${state.notificationDraft[key]?'checked':''}><span><b>${label}</b><small>${description}</small></span></label>`).join('')}</fieldset><p class="muted team-note">Changes apply to future notifications. Existing inbox items stay available. Daily reminders depend on the configured scheduled job.</p><div class="form-actions"><button class="button primary" type="submit">Save preferences</button></div></form>`;
 }
 function departments(){
  if(!founder())return '';const page=state.departments;
  return `<div class="team-settings-heading"><div><h2>Departments</h2><p>Organise professional profiles by department.</p></div>${button('New department','new-department')}</div><p class="muted team-note">Department membership does not change roles, section grants or access to assigned work.</p><label class="check-row team-archive-filter"><input type="checkbox" data-team-archived ${state.includeArchived?'checked':''}>Include archived departments</label>${!page||state.loading.has('departments')?loading('departments'):`<div class="team-department-list">${page.items.map(row=>`<div class="team-department-row"><div><b>${esc(row.name)}</b><small>${row.members} active ${row.members===1?'member':'members'}${row.archived?' · Archived':''}</small></div>${button('Edit','department','data-id="'+esc(row.id)+'"')}</div>`).join('')||'<p class="muted">No departments yet.</p>'}</div>${pager(page,'departments')}`}`;
 }
 function settings(security=''){
  const tabs=[['profile','Profile'],['notifications','Notifications'],['account','Account & access'],...(founder()?[['departments','Departments']]:[])],selected=tabs.some(([key])=>key===state.tab)?state.tab:'profile';
  const content=selected==='account'?security:selected==='notifications'?preferences():selected==='departments'?departments():profile();
  return `<div class="team-settings-layout"><nav class="team-settings-nav" aria-label="Settings">${tabs.map(([key,label])=>`<button type="button" data-team-action="tab" data-tab="${key}" ${key===selected?'aria-current="page"':''}>${label}</button>`).join('')}</nav><section class="team-settings-content" aria-label="${esc(tabs.find(([key])=>key===selected)?.[1])}">${state.uncertain&&selected!=='account'?content.replace(/<(input|select)\b/g,'<$1 disabled'):content}</section></div>`;
 }
 function directory(){
  if(!founder())return '<p class="muted">The Team directory requires the existing Team section access.</p>';
  const page=state.directory;return `<section class="team-directory"><div class="team-directory-toolbar"><form data-team-form="search" role="search">${input('search','Find a team member',state.search,'type="search" maxlength="100"')}<button class="button small" type="submit">Search</button></form><button type="button" class="button small" data-security-action="invite">Invite a team member</button></div>${!page||state.loading.has('directory')?loading('directory'):`<div class="team-directory-table" role="region" aria-label="Active team directory" tabindex="0"><table><caption class="sr-only">Active team members and their professional profiles. Department membership does not grant access.</caption><thead><tr><th scope="col">Name</th><th scope="col">Job title</th><th scope="col">Department</th><th scope="col">Role</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${page.items.map(row=>`<tr><th scope="row"><span class="team-person-name">${esc(row.name)}</span></th><td>${esc(row.job_title||'—')}</td><td>${esc(row.department?.name||'Unassigned')}${row.department?.archived?' (archived)':''}</td><td>${esc(roles[row.role]||row.role)}</td><td><div class="team-row-actions">${button('Department','member-department','data-id="'+esc(row.id)+'"')}${row.role!=='founder'?`<button type="button" class="button small" data-access-action="open" data-access-member="${esc(row.id)}">Manage access</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="5">No active team members match this search.</td></tr>'}</tbody></table></div>${pager(page,'directory')}`}<p class="muted team-note">This directory follows the existing Founder Team access. Invitations, suspended accounts and role permissions remain in Settings → Account & access.</p></section>`;
 }
 async function departmentChoices(c){let items=[],page=1;for(;;){const result=listValue(await request('/team/departments?page='+page+'&archived=0'));if(!current(c))return null;items.push(...result.items);if(!result.hasMore)return items;if(page>=4)throw new Error('The department list exceeds its supported size.');page++;}}
 function bindDialog(){const dialog=document.querySelector('#dialog');if(!dialog||boundDialogs.has(dialog))return;boundDialogs.add(dialog);dialog.addEventListener('cancel',event=>{if(editor&&!canLeave())event.preventDefault();});dialog.addEventListener('close',()=>{if(editor){editor=null;state.dirty=state.uncertain=false;retryDraft=null;}});}
 async function editDepartment(id=''){
  if(!founder()||!canLeave())return;opening++;const row=id?state.departments?.items.find(row=>row.id===id):null;if(id&&!row)return;
  editor={kind:'department',id,revision:row?.revision||0};openDialog(row?'Edit department':'New department',`<form data-team-form="department">${errorRegion()}${input('department_name','Department name',row?.name||'','required maxlength="80"')}<label class="check-row"><input type="checkbox" name="archived" ${row?.archived?'checked':''}><span>Archive this department</span></label><p class="muted team-note">Archived departments remain on existing profiles and in history. New assignments require an active department.</p><div class="form-actions"><button class="button primary" type="submit">Save department</button></div></form>`);bindDialog();
 }
 async function editMember(id){
  if(!founder()||!canLeave())return;const version=++opening,row=state.directory?.items.find(row=>row.id===id);if(!row)return;const c=capture(),choices=await departmentChoices(c);if(!choices||!current(c)||version!==opening)return;
  editor={kind:'member_department',id,revision:row.revision};openDialog('Department for '+row.name,`<form data-team-form="member_department">${errorRegion()}<div class="field"><label for="team-member-department">Department</label><select name="department_id" id="team-member-department"><option value="">Not assigned</option>${row.department?.archived?`<option value="${esc(row.department.id)}" selected>${esc(row.department.name)} (archived)</option>`:''}${choices.map(dept=>`<option value="${esc(dept.id)}" ${row.department?.id===dept.id?'selected':''}>${esc(dept.name)}</option>`).join('')}</select></div><p class="muted team-note">This label does not change this person’s role or access.</p><div class="form-actions"><button class="button primary" type="submit">Save department</button></div></form>`);bindDialog();
 }
 function changeDraft(form){
  if(!form||state.uncertain)return;const values=new FormData(form),kind=form.dataset.teamForm;if(kind==='profile')state.profileDraft={name:String(values.get('name')||''),job_title:String(values.get('job_title')||'')};if(kind==='notifications')state.notificationDraft=Object.fromEntries(events.map(([key])=>[key,values.has(key)]));if(kind!=='search')state.dirty=true;
 }
 async function save(form){
  if(isBusy())return;const kind=form.dataset.teamForm,c=capture(),values=new FormData(form);if(!actor()||(!state.profile&&!['department','member_department'].includes(kind)))return;
  let path,method='PATCH',changes,revision=state.profile?.revision;
  if(kind==='profile'){path='/team/profile';changes={name:values.get('name'),job_title:values.get('job_title')};}
  else if(kind==='notifications'){path='/team/preferences';changes=Object.fromEntries(events.map(([key])=>[key,values.has(key)]));}
  else if(kind==='department'&&founder()&&editor?.kind===kind){path='/team/departments'+(editor.id?'/'+encodeURIComponent(editor.id):'');method=editor.id?'PATCH':'POST';revision=editor.revision;changes={name:values.get('department_name'),archived:values.has('archived')};}
  else if(kind==='member_department'&&founder()&&editor?.kind===kind){path='/team/members/'+encodeURIComponent(editor.id)+'/department';revision=editor.revision;changes={department_id:values.get('department_id')||null};}
  else return;
  retryDraft??={path,method,body:{...(method==='POST'?{}:{expectedRevision:revision}),changes},key:crypto.randomUUID()};const exact=retryDraft,region=form.querySelector('.form-error');pending=c;region.textContent='';delete state.formErrors[kind];syncBusy();
  try{
   const result=await request(exact.path,exact.method,exact.body,{'Idempotency-Key':exact.key});if(!current(c))return;
   state.dirty=state.uncertain=false;state.formErrors={};retryDraft=null;if(['profile','notifications'].includes(kind)||result.id===actor())profileValue(result);if(['department','member_department'].includes(kind))editor=null;
   if(kind==='department')state.departments=null;if(kind==='member_department')state.directory=null;
   toast(kind==='notifications'?'Notification preferences saved.':kind==='profile'?'Profile saved.':'Department saved.');
   try{if(kind==='department')await loadDepartments();if(kind==='member_department')await loadDirectory();await onChange();}catch{toast('Your change was saved. Reload this page to refresh the directory.');}if(current(c)){if(['department','member_department'].includes(kind))document.querySelector('#dialog')?.close();render();}
  }catch(error){
   if(!current(c))return;if([401,403].includes(error.status)){reset();document.querySelector('#dialog')?.close();render();try{await onChange();}catch{}toast(error.message);return;}
   if([400,404,409,413,415].includes(error.status)){retryDraft=null;state.uncertain=false;}else state.uncertain=true;
   state.formErrors[kind]=esc(error.message)+(error.status===409?'<div>'+button('Reload saved values','reload-editor')+'</div>':'')+(state.uncertain?'<p>Your original change is retained. Save again to retry exactly the same request.</p>':'');region.innerHTML=state.formErrors[kind];region.focus?.();
  }finally{if(current(c)){pending=null;syncBusy();}}
 }
 async function action(element){
  if(isBusy()||element.disabled)return;const name=element.dataset.teamAction;
  if(name==='tab'){if(!canLeave())return;opening++;editor=null;state.tab=element.dataset.tab;if(state.tab==='departments'&&!state.departments)await loadDepartments();if(['profile','notifications'].includes(state.tab)&&!state.profile)await loadSettings();render();return;}
  if(name==='new-department')return editDepartment();if(name==='department')return editDepartment(element.dataset.id);if(name==='member-department')return editMember(element.dataset.id);
  if(name==='reload-editor'){
   if(!canLeave())return;editor=null;document.querySelector('#dialog')?.close();await loadSettings({force:true});if(founder()){if(state.tab==='departments')await loadDepartments();else if(state.directory)await loadDirectory();}render();return;
  }
  if(name.startsWith('reload-')){if(!canLeave())return;const kind=name.slice(7);if(kind==='profile')await loadSettings();if(kind==='directory')await loadDirectory();if(kind==='departments')await loadDepartments();render();return;}
  if(name.startsWith('directory-')){state.directoryPage+=name.endsWith('next')?1:-1;await loadDirectory();render();}
  if(name.startsWith('departments-')){state.departmentPage+=name.endsWith('next')?1:-1;await loadDepartments();render();}
 }
 document.addEventListener('click',async event=>{const element=event.target.closest?.('[data-team-action]');if(!element)return;event.preventDefault();try{await action(element);}catch(error){toast(error.message);render();}});
 document.addEventListener('input',event=>changeDraft(event.target.closest?.('form[data-team-form]')));
 document.addEventListener('change',async event=>{if(event.target.matches?.('[data-team-archived]')){if(!canLeave())return;state.includeArchived=event.target.checked;state.departmentPage=1;try{await loadDepartments();}catch(error){toast(error.message);}render();}else changeDraft(event.target.closest?.('form[data-team-form]'));});
 document.addEventListener('submit',async event=>{const form=event.target;if(!form.matches?.('form[data-team-form]'))return;event.preventDefault();if(isBusy())return;if(form.dataset.teamForm==='search'){if(!canLeave())return;state.search=String(new FormData(form).get('search')||'').trim();state.directoryPage=1;try{await loadDirectory();}catch(error){toast(error.message);}render();return;}await save(form);});
 // The host uses canLeave() for shell navigation and isBusy() for native close.
 document.addEventListener('click',event=>{if(event.target.closest?.('[data-action="close-dialog"]')&&editor&&!canLeave()){event.preventDefault();event.stopImmediatePropagation();}},true);
 globalThis.window?.addEventListener('beforeunload',event=>{if(state.dirty||state.uncertain||isBusy()){event.preventDefault();event.returnValue='';}});
 return {loadSettings,loadDirectory,loadDepartments,settings,directory,reset,canLeave,isBusy};
}
