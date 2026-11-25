// Execute the application's actual event handlers with a simulated DOM/HTTP
// boundary. Native browser tests remain the authority for browser focus behavior.
export function registerInteractionIntentCases({test,assert,harness,node,task}){
 function trigger(h,dataset){
  const button=node();button.dataset=dataset;button.focus=()=>h.document.activeElement=button;
  button.closest=selector=>selector==='[data-action]'&&dataset.action?button:null;
  h.document.body??=node();
  let disabled=false;
  Object.defineProperty(button,'disabled',{get:()=>disabled,set(value){disabled=value;if(value&&h.document.activeElement===button)h.document.activeElement=h.document.body;}});
  return button;
 }
 test('a task opener blurred by pending feedback remains the logical dialog return target',async()=>{
  const h=await harness(),button=trigger(h,{action:'open-task',id:'task-1'}),dialog=h.nodes.get('#dialog');
  h.document.querySelectorAll=selector=>selector==='[data-action]'?[button]:[];
  button.focus();await h.dispatch('click',{target:button,preventDefault(){}});
  assert.equal(dialog.open,true);dialog.open=false;h.document.activeElement=h.document.body;dialog.listeners.close();
  assert.equal(h.document.activeElement,button);
 });
 for(const [kind,dataset,selector] of [
  ['Academy publication',{academyAction:'publish',course:'course-1'},'[data-academy-action]'],
  ['private video preview',{videoAction:'preview',id:'video-1'},'[data-video-action]'],
  ['member access',{accessAction:'open',accessMember:'member-1'},'[data-access-action]'],
  ['member security',{securityAction:'recovery',securityId:'member-1'},'[data-security-action]'],
 ])test(kind+' dialog restores its identified control after a rerender',async()=>{
  const h=await harness(),opener=trigger(h,dataset),replacement=trigger(h,{...dataset}),dialog=h.nodes.get('#dialog');
  opener.focus();h.ui.openDialog('Review','<p>Review details</p>');
  const unrelated=trigger(h,dataset.academyAction?{...dataset,course:'another-course'}:dataset.videoAction?{...dataset,id:'another-video'}:dataset.accessAction?{...dataset,accessMember:'another-member'}:{...dataset,securityId:'another-member'});
  h.document.querySelectorAll=value=>value===selector?[unrelated,replacement]:[];
  dialog.open=false;h.document.activeElement=h.document.body;dialog.listeners.close();
  assert.equal(h.document.activeElement,replacement);
 });
 for(const failure of [false,true])test('member access loading keeps its opener focusable and suppresses duplicate reads on '+(failure?'failure':'success'),async()=>{
  let release,started;const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
  const h=await harness({intercept:async(url,init,model,response)=>{
   if(url==='/api/auth/access/member-1'){started();await hold;return failure?response({error:'Access settings are temporarily unavailable.'},503):response({id:'member-1',name:'Synthetic member',role:'artist',editable:true,revision:3,grants:[]});}
   return null;
  }}),opener=trigger(h,{accessAction:'open',accessMember:'member-1'}),dialog=h.nodes.get('#dialog');
  opener.closest=selector=>selector==='[data-access-action]'?opener:null;
  h.document.querySelectorAll=selector=>selector==='[data-access-action]'?[opener]:[];
  opener.focus();const request=h.dispatch('click',{target:opener,preventDefault(){}});await seen;
  assert.equal(opener.disabled,false);assert.equal(opener.attributes['aria-busy'],'true');assert.equal(opener.attributes['aria-disabled'],'true');assert.equal(h.document.activeElement,opener);
  await h.dispatch('click',{target:opener,preventDefault(){}});
  assert.equal(h.requests.filter(request=>request.url==='/api/auth/access/member-1').length,1);
  release();await request;assert.equal(opener.disabled,false);assert.equal(opener.attributes['aria-busy'],undefined);assert.equal(opener.attributes['aria-disabled'],undefined);
  assert.equal(dialog.open,!failure);
  if(failure){assert(h.nodes.get('#toast').textContent.includes('temporarily unavailable'));assert.equal(h.document.activeElement,opener);}
  else{dialog.open=false;h.document.activeElement=h.document.body;dialog.listeners.close();assert.equal(h.document.activeElement,opener);}
 });
 for(const action of ['invite','password'])test('the security '+action+' opening action preserves its return target without submitting protected fields',async()=>{
  const h=await harness(),opener=trigger(h,{securityAction:action}),dialog=h.nodes.get('#dialog');
  opener.closest=selector=>selector==='[data-security-action]'?opener:null;
  h.document.querySelectorAll=selector=>selector==='[data-security-action]'?[opener]:[];
  opener.focus();const before=h.requests.length;await h.dispatch('click',{target:opener,preventDefault(){}});
  assert.equal(dialog.open,true);assert.equal(opener.disabled,false);assert(!h.requests.slice(before).some(request=>request.init.method==='POST'));
  dialog.open=false;h.document.activeElement=h.document.body;dialog.listeners.close();assert.equal(h.document.activeElement,opener);
 });
 test('a pending security refresh keeps its opener focusable and issues only one concurrent read',async()=>{
  let release,started,reads=0;const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
  const h=await harness({intercept:async(url,init,model,response)=>{
   if(url==='/api/auth/security'){
    if(++reads===1){started();await hold;}
    return response({account:{email:'qa@nam-qa.invalid',status:'active',mfaEnabled:false},canManageMembers:false,mfaAvailable:true,mfaVerified:false});
   }
   return null;
  }}),opener=trigger(h,{securityAction:'reload'});
  opener.closest=selector=>selector==='[data-security-action]'?opener:null;opener.focus();
  await h.dispatch('click',{target:opener,preventDefault(){}});await seen;
  assert.equal(opener.disabled,false);assert.equal(opener.attributes['aria-busy'],'true');assert.equal(opener.attributes['aria-disabled'],'true');assert.equal(h.document.activeElement,opener);
  await h.dispatch('click',{target:opener,preventDefault(){}});assert.equal(reads,1);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(opener.attributes['aria-busy'],undefined);assert.equal(opener.attributes['aria-disabled'],undefined);
 });
 test('a slower earlier task response cannot replace the later chosen task',async()=>{
  let releaseFirst,releaseSecond,firstStarted,secondStarted;
  const firstHold=new Promise(resolve=>releaseFirst=resolve),secondHold=new Promise(resolve=>releaseSecond=resolve);
  const firstSeen=new Promise(resolve=>firstStarted=resolve),secondSeen=new Promise(resolve=>secondStarted=resolve);
  const h=await harness({intercept:async(url,init,model,response)=>{
   if(url==='/api/tasks/first'){firstStarted();await firstHold;return response({...task(),id:'first',title:'Earlier task'});}
   if(url==='/api/tasks/second'){secondStarted();await secondHold;return response({...task(),id:'second',title:'Chosen task'});}
   return null;
  }});
  const earlier=h.ui.openTask('first');await firstSeen;
  const later=h.ui.openTask('second');await secondSeen;
  releaseSecond();await later;assert.equal(h.ui.state.task.id,'second');
  releaseFirst();await earlier;
  assert.equal(h.ui.state.task.id,'second');assert(h.nodes.get('#dialog').innerHTML.includes('Chosen task'));assert(!h.nodes.get('#dialog').innerHTML.includes('Earlier task'));
 });
 test('a failed later task request still invalidates an older unresolved intent',async()=>{
  let releaseFirst,firstStarted;
  const hold=new Promise(resolve=>releaseFirst=resolve),seen=new Promise(resolve=>firstStarted=resolve);
  const h=await harness({intercept:async(url,init,model,response)=>{
   if(url==='/api/tasks/first'){firstStarted();await hold;return response({...task(),id:'first',title:'Earlier task'});}
   if(url==='/api/tasks/second')return response({error:'The selected task is temporarily unavailable.'},503);
   return null;
  }});
  const earlier=h.ui.openTask('first');await seen;
  await assert.rejects(()=>h.ui.openTask('second'),/temporarily unavailable/);
  releaseFirst();await earlier;
  assert.equal(h.ui.state.task,null);assert.equal(h.nodes.get('#dialog').open,false);
 });
 test('a late task response is ignored after workspace unmount',async()=>{
  let release,started;
  const hold=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
  const h=await harness({intercept:async(url,init,model,response)=>{
   if(url==='/api/tasks/first'){started();await hold;return response({...task(),id:'first',title:'Private earlier task'});}
   return null;
  }});
  const earlier=h.ui.openTask('first');await seen;h.ui.unmountWorkspace();release();
  await assert.rejects(()=>earlier,{name:'AbortError'});
  assert.equal(h.ui.state.task,null);assert.equal(h.nodes.get('#dialog').open,false);assert(!h.nodes.get('#app').innerHTML.includes('Private earlier task'));
 });
 test('an abandoned subtask response cannot release a new session parent-save guard',async()=>{
  const releases=[],signals=[];let writes=0;
  const h=await harness({intercept:async(url,init,model,response)=>{
   if(url==='/api/tasks/task-1/subtasks'&&init.method==='POST'){
    const index=writes++;await new Promise(resolve=>{releases[index]=resolve;signals[index]?.();});
    return response({...task(),subtasks:[{id:'child-1',title:'Lighting',completed:index===0}]});
   }
   return null;
  }});
  const save=node(),edit={values:{title:'Review project lighting',description:'Original brief',status:'Todo',priority:'High',section:'projects',owner_id:'founder-1',due_date:'2026-11-25'}};
  const dialog=h.nodes.get('#dialog');dialog.querySelector=selector=>selector==='form[data-form="edit-task"]'?edit:selector==='form[data-form="edit-task"] [type="submit"]'?save:null;
  await h.ui.openTask('task-1');
  const first=node();first.dataset.subtask='child-1';first.checked=true;
  const oldSeen=new Promise(resolve=>signals[0]=resolve),oldWrite=h.dispatch('change',{target:first});await oldSeen;
  h.ui.unmountWorkspace();await h.ui.mountWorkspace();await h.ui.openTask('task-1');
  const second=node();second.dataset.subtask='child-1';second.checked=false;
  const newSeen=new Promise(resolve=>signals[1]=resolve),newWrite=h.dispatch('change',{target:second});await newSeen;
  assert.equal(save.disabled,true);releases[0]();await oldWrite;
  assert.equal(save.disabled,true,'The new session remains busy until its own write settles');
  releases[1]();await newWrite;assert.equal(save.disabled,false);assert.equal(writes,2);
 });
}
