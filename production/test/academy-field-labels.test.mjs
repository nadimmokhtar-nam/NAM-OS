import {loadBrowserModule} from './support/browser-module.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Audit the actual controller's combined persistent and modal HTML. No copied
// form templates or selector substitutions are used. This is a rendered-markup
// association regression; Playwright authoring remains a separate browser gate.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const course={id:'course',title:'Course title',area:'3d',summary:'Saved summary',revision:7,archived:false,version:1,publication_status:'draft',
  modules:[{id:'module',title:'Scene preparation',position:1,lesson_count:1}],
  lessons:[{id:'lesson',title:'Check geometry',body:'Written lesson text.',position:1,module_id:'module'}],
  resources:[{id:'resource',title:'Checklist',body:'Written resource text.',lesson_id:'lesson'}],
  publications:[{version:1,title:'Course title',published_at:'2026-11-24T12:00:00Z'}],enrollments:[],assignments:[],completion_records:[]};

async function render(action,dataset={}){
  const listeners={};let modal='';
  const document={querySelector:()=>({close(){}}),addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
  const context=vm.createContext({document,Intl,Date,Map,Set,JSON,String,Number,encodeURIComponent});
  const {createAcademyAdmin}=await loadBrowserModule(context,'academy-admin.js');
  const controller=createAcademyAdmin({request:async path=>path==='/bootstrap'?{members:[]}:path==='/academy/admin/courses'?[structuredClone(course)]:structuredClone(course),openDialog:(title,body)=>{modal=body;},toast:message=>{throw new Error(message);},onChange:async()=>{}});
  async function click(name,extra={}){const element={dataset:{academyAction:name,...extra},isConnected:true,setAttribute(){},removeAttribute(){},closest(selector){return selector==='[data-academy-action]'?this:null;}};for(const fn of listeners.click||[])fn({target:element,preventDefault(){}});await tick();}
  await controller.load();await click('open',{course:course.id});
  const persistent=controller.render();if(action)await click(action,dataset);
  return {persistent,modal,combined:persistent+modal};
}
function nodes(html){return Array.from(html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi),match=>({tag:match[1].toLowerCase(),at:match.index,attributes:Object.fromEntries(Array.from(match[2].matchAll(/([a-z][a-z0-9_-]*)="([^"]*)"/gi),a=>[a[1],a[2]]))}));}
function assertUniqueIds(html){const ids=nodes(html).map(node=>node.attributes.id).filter(Boolean);assert(ids.length>=3,'The real metadata controls must be present.');assert.equal(new Set(ids).size,ids.length,'Persistent and modal controls must not share IDs.');}
function assertLabelTarget(html,labelText,{id,name,tag,modalStartsAt=null}){
  const labels=Array.from(html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)).filter(match=>match[2]===labelText&&(modalStartsAt===null||match.index>=modalStartsAt));
  assert.equal(labels.length,1,`One ${labelText} label must be present in its form.`);
  const targetId=labels[0][1].match(/\bfor="([^"]+)"/)?.[1];assert.equal(targetId,id);
  // The first matching ID is what document.getElementById/label association
  // resolves; this specifically catches a dialog label targeting the backdrop.
  const target=nodes(html).find(node=>node.attributes.id===targetId);assert(target,`${labelText} must resolve to a control.`);assert.equal(target.tag,tag);assert.equal(target.attributes.name,name);
  if(modalStartsAt!==null)assert(target.at>=modalStartsAt,`${labelText} must target the modal control, not the persistent metadata field.`);
}

test('Academy metadata labels target distinct persistent controls without changing submitted field names',async()=>{
  const rendered=await render();assertUniqueIds(rendered.persistent);
  assertLabelTarget(rendered.persistent,'Course title',{id:'academy-details-title',name:'title',tag:'input'});
  assertLabelTarget(rendered.persistent,'Learning area',{id:'academy-details-area',name:'area',tag:'select'});
  assertLabelTarget(rendered.persistent,'Summary',{id:'academy-details-summary',name:'summary',tag:'textarea'});
});
for(const [action,dataset,label] of [['new-module',{},'Module title'],['edit-module',{module:'module'},'Module title'],['new-lesson',{},'Lesson title'],['edit-lesson',{lesson:'lesson'},'Lesson title'],['new-resource',{},'Resource title'],['edit-resource',{resource:'resource'},'Resource title']]){
  test(`Academy ${action} labels target their modal with persistent metadata still rendered`,async()=>{
    const rendered=await render(action,dataset);assert(rendered.modal,'The actual action must open its form.');assertUniqueIds(rendered.combined);
    assertLabelTarget(rendered.combined,'Course title',{id:'academy-details-title',name:'title',tag:'input'});
    assertLabelTarget(rendered.combined,label,{id:'academy-title',name:'title',tag:'input',modalStartsAt:rendered.persistent.length});
    if(action.includes('lesson'))assertLabelTarget(rendered.combined,'Written lesson',{id:'academy-body',name:'body',tag:'textarea',modalStartsAt:rendered.persistent.length});
    if(action.includes('resource')){
      assertLabelTarget(rendered.combined,'Available with',{id:'academy-lesson_id',name:'lesson_id',tag:'select',modalStartsAt:rendered.persistent.length});
      assertLabelTarget(rendered.combined,'Written resource content',{id:'academy-body',name:'body',tag:'textarea',modalStartsAt:rendered.persistent.length});
    }
  });
}
