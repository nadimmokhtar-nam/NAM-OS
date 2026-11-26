const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roles={sales_manager:'Sales Manager',sales:'Sales Representative',production_manager:'Production Manager',artist:'CGI Artist',freelancer:'Freelancer'};
const labels={sales:'Sales',academy:'Academy',projects:'Projects',library:'Library',team:'Team',operations:'Operations'};
const ceiling=role=>['sales','sales_manager'].includes(role)?['sales','academy','operations']:['production_manager','artist','freelancer'].includes(role)?['projects','academy','library','operations']:[];

export function invitationAccessSummary(role){return `Initial sections: ${ceiling(role).map(section=>labels[section]).join(', ')}. Access covers own assigned work with task creation enabled. Lessons require enrollment. Manage section access after acceptance.`;}

/** Fixed templates and assigned-only section grants. No manager-team or
 * collaborator permission is inferred from a role label or a checked section. */
export function createAccessAdmin({request,openDialog,toast,onChange}){
 let record=null,draft=null,busy=false,generation=0,dirty=false;
 const activeForm=()=>document.querySelector('form[data-access-form]');
 function reset(){generation++;record=null;draft=null;busy=false;dirty=false;}
 function capture(form){return Array.from(form.querySelectorAll('[data-access-section]')).filter(input=>input.checked).map(input=>({section:input.dataset.accessSection,can_create:!!form.querySelector(`[data-access-create="${input.dataset.accessSection}"]`)?.checked}));}
 function rows(role,grants){return ceiling(role).map(section=>{const grant=grants.find(g=>g.section===section);return `<div class="access-section"><label class="check-row"><input type="checkbox" data-access-section="${section}" ${grant?'checked':''}><span>${labels[section]}</span></label><label class="check-row"><input type="checkbox" data-access-create="${section}" ${grant?.can_create?'checked':''} ${grant?'':'disabled'}><span>Create tasks</span></label></div>`;}).join('');}
 function view(){
  if(!record.editable){openDialog('Workspace access',`<p>${esc(record.name)} has protected founder access. Founder changes use the verified operator process.</p>`);return;}
  openDialog(`Access for ${record.name}`,`<form data-access-form="${esc(record.id)}"><div class="form-error" role="alert" tabindex="-1"></div><div class="field"><label for="access-role">Role template</label><select id="access-role" name="role">${Object.entries(roles).map(([id,title])=>`<option value="${id}" ${draft.role===id?'selected':''}>${title}</option>`).join('')}</select></div><p class="notice">Access applies to own assigned work. Managed teams require a separate scope. Academy lessons require enrollment; course publishing remains a founder action.</p><fieldset class="access-sections"><legend>Enabled sections</legend><div id="access-section-options">${rows(draft.role,draft.grants)}</div></fieldset><p class="muted"><small>Removing a section takes effect on the next request. Existing work and history remain saved. Leaving every section unchecked removes all section work access.</small></p><div class="form-actions"><button type="submit" class="button primary">Save access</button></div></form>`);
  const dialog=document.querySelector('#dialog');if(dialog&&!dialog.dataset.accessBound){dialog.dataset.accessBound='1';dialog.addEventListener('cancel',event=>{if(activeForm()&&dirty&&!confirm('Discard the unsaved access changes?'))event.preventDefault();});dialog.addEventListener('close',()=>{record=null;draft=null;dirty=false;});}
 }
 async function open(id){const current=++generation;const result=await request(`/auth/access/${encodeURIComponent(id)}`);if(current!==generation)return;record=result;draft={role:result.role,grants:result.grants.map(g=>({section:g.section,can_create:g.can_create}))};dirty=false;view();}
 function error(message,form,reload=false){const region=form?.querySelector('.form-error');if(!region){toast(message);return;}region.innerHTML=`${esc(message)}${reload?'<div class="form-actions"><button type="button" class="button small" data-access-action="reload">Reload current access</button></div>':''}`;region.focus();}
 document.addEventListener('click',async event=>{const element=event.target.closest('[data-access-action]');if(!element)return;event.preventDefault();if(busy||element.disabled)return;const action=element.dataset.accessAction;if(action==='reload'&&dirty&&!confirm('Discard this access draft and load the latest saved permissions?'))return;const id=action==='reload'?record?.id:element.dataset.accessMember;if(!id)return;busy=true;element.setAttribute('aria-busy','true');element.setAttribute('aria-disabled','true');try{await open(id);}catch(e){toast(e.message);}finally{busy=false;element.removeAttribute('aria-busy');element.removeAttribute('aria-disabled');}});
 document.addEventListener('change',event=>{const form=event.target.closest('form[data-access-form]');if(!form||!draft)return;dirty=true;if(event.target.id==='access-role'){draft.grants=capture(form).filter(grant=>ceiling(event.target.value).includes(grant.section));draft.role=event.target.value;form.querySelector('#access-section-options').innerHTML=rows(draft.role,draft.grants);}else if(event.target.dataset.accessSection){const create=form.querySelector(`[data-access-create="${event.target.dataset.accessSection}"]`);create.disabled=!event.target.checked;if(create.disabled)create.checked=false;draft.grants=capture(form);}else if(event.target.dataset.accessCreate)draft.grants=capture(form);});
 document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches?.('form[data-access-form]'))return;event.preventDefault();if(busy||!record)return;
  const identity=record.id,current=generation,submit=form.querySelector('[type=submit]');busy=true;submit.disabled=true;submit.setAttribute('aria-busy','true');form.querySelector('.form-error').textContent='';
  try{const result=await request(`/auth/access/${encodeURIComponent(identity)}`,'PATCH',{expectedRevision:record.revision,role:form.elements.role.value,grants:capture(form)});if(current!==generation)return;record=result;dirty=false;document.querySelector('#dialog')?.close();try{await onChange?.();toast('Access saved. Permissions take effect on the next request.');}catch{toast('Access was saved. Reload Settings to refresh the member directory.');}}
  catch(e){if(current!==generation)return;if(e.status===401||e.status===403){dirty=false;document.querySelector('#dialog')?.close();reset();try{await onChange?.();}catch{/* The protected admin view remains closed. */}toast(e.message);}else error(e.message,form,e.status===409);}
  finally{busy=false;if(submit.isConnected){submit.disabled=false;submit.removeAttribute('aria-busy');}}
 });
 // A native dialog's explicit close control and browser reload both preserve
 // the same unsaved-change decision as Escape.
 document.addEventListener('click',event=>{if(event.target.closest('[data-action="close-dialog"]')&&activeForm()&&dirty&&!confirm('Discard the unsaved access changes?')){event.preventDefault();event.stopImmediatePropagation();}},true);
 globalThis.window?.addEventListener('beforeunload',event=>{if(activeForm()&&dirty){event.preventDefault();event.returnValue='';}});
 return {reset,open};
}
