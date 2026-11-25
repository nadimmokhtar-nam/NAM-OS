export function registerSubtaskFocusCases({test,assert,harness,node,task,actor}) {

// Reproduce native disable blur at the DOM boundary while executing the real
// change listener. Browser assertions remain the authority for native focus.
async function pendingSubtaskFocus({failure=false}={}){
 let release,started;const hold=new Promise(r=>release=r),seen=new Promise(r=>started=r),initial={...task(),subtasks:[{id:'child-1',title:'Check lighting',completed:false}]};
 const h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/tasks/task-1'&&!init.method)return response(initial);if(url==='/api/tasks/task-1/subtasks'&&init.method==='POST'){started();await hold;return failure?response({error:'Network temporarily unavailable'},503):response({...initial,version:2,subtasks:[{...initial.subtasks[0],completed:true}]});}return null;}});
 await h.ui.openTask('task-1');h.document.body=node();const dialog=h.nodes.get('#dialog');let disabled=false,checkbox=node(),liveCheckbox=checkbox,html=dialog.innerHTML;
 checkbox.dataset.subtask='child-1';checkbox.checked=true;checkbox.focus=()=>h.document.activeElement=checkbox;
 Object.defineProperty(checkbox,'disabled',{get:()=>disabled,set(value){disabled=value;if(value&&h.document.activeElement===checkbox)h.document.activeElement=h.document.body;}});
 Object.defineProperty(dialog,'innerHTML',{get:()=>html,set(value){html=value;if(value.includes('data-subtask="child-1"')){liveCheckbox=node();liveCheckbox.dataset.subtask='child-1';liveCheckbox.checked=value.includes('type="checkbox" checked data-subtask="child-1"');liveCheckbox.focus=()=>h.document.activeElement=liveCheckbox;}}});
 h.document.querySelectorAll=selector=>selector==='[data-subtask]'?[liveCheckbox]:[];checkbox.focus();
 return {h,checkbox,seen,release,get liveCheckbox(){return liveCheckbox;},start:()=>h.dispatch('change',{target:checkbox})};
}
for(const failure of [false,true])test('subtask keyboard focus returns to its logical checkbox after '+(failure?'a failed mutation':'a successful rerender'),async()=>{
 const f=await pendingSubtaskFocus({failure}),pending=f.start();await f.seen;assert.equal(f.checkbox.disabled,true);assert.equal(f.h.document.activeElement,f.h.document.body);await f.h.dispatch('change',{target:f.checkbox});assert.equal(f.h.requests.filter(r=>r.url.endsWith('/subtasks')&&r.init.method==='POST').length,1);f.release();await pending;
 assert.equal(f.h.document.activeElement,f.liveCheckbox);assert.equal(f.liveCheckbox.disabled,false);assert.equal(f.liveCheckbox.checked,!failure);if(!failure)assert.notEqual(f.liveCheckbox,f.checkbox);else assert(f.h.nodes.get('#toast').textContent.includes('Network temporarily unavailable'));
});
test('subtask response preserves focus moved to another field while the checkbox is pending',async()=>{
 const f=await pendingSubtaskFocus(),pending=f.start();await f.seen;const notes=node();notes.id='live-task-notes';notes.focus=()=>f.h.document.activeElement=notes;f.h.nodes.set('#live-task-notes',notes);notes.focus();f.release();await pending;assert.equal(f.h.document.activeElement,notes);assert.equal(f.liveCheckbox.checked,true);
});
for(const changed of ['route','actor','task','dialog'])test('subtask keyboard response cannot restore focus after '+changed+' context changed',async()=>{
 const f=await pendingSubtaskFocus(),pending=f.start();await f.seen;if(changed==='route')f.h.ui.state.routeVersion++;if(changed==='actor')f.h.ui.state.data={...f.h.ui.state.data,actor:{...actor,id:'replacement-actor'}};if(changed==='task')f.h.ui.state.task={...task(),id:'different-task'};if(changed==='dialog')f.h.nodes.get('#dialog').open=false;f.release();await pending;assert.equal(f.h.document.activeElement,f.h.document.body);
});
}
