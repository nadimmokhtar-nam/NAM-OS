import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

async function module(){const context=vm.createContext({Intl,Date,URLSearchParams,document:{addEventListener(){},querySelector(){return null;}}});return loadBrowserModule(context,'project-planning.js');}
test('timeline dates retain leap days, early years and inclusive endpoints without inventing unscheduled dates',async()=>{
 const {timelineModel,timelineBar}=await module(),model=timelineModel({cursor:'2028-02-29',today:'2028-02-29',range:'month'}),bar=timelineBar(model,'2028-02-28','2028-03-01');
 assert.equal(bar.width,3*model.width);assert.equal(timelineBar(model,null,null),null);assert.equal(timelineBar(model,null,'2028-02-29').point,true);assert.equal(timelineBar(model,'2029-01-01','2029-01-02'),null);
 const early=timelineModel({cursor:'0001-01-01',today:'0001-01-01'});assert.equal(new Date(early.start*86400000).toISOString().slice(0,10),'0001-01-01');assert.equal(timelineBar(early,'0001-01-01','0001-01-01').left,0);
});
async function harness(request){
 const {createProjectPlanning}=await module();let project={id:'one',title:'Project One',brief:'Direction & light',member_ids:[],lead_id:'founder',version:1,overview:{open_tasks:3,images:2,pending_responses:1,recent_images:[]}},actor={id:'founder',role:'founder'},key='one';
 const data=()=>({actor,today:'2026-11-25',members:[{id:'founder',name:'Founder',initials:'NM'}],capabilities:{projectPlanning:'records'}});
 const controller=createProjectPlanning({request,openDialog(){},getData:data,getProject:()=>project,render(){},toast(){},contextKey:()=>key});
 return {controller,project(value){project=value;key=value.id;},actor(value){actor=value;}};
}
test('a late plan from a previously opened project cannot replace the current project',async()=>{
 let release;const pending=new Promise(done=>release=done),h=await harness(url=>url.includes('/one/')?pending:Promise.resolve({id:'two',title:'Project Two',phases:[]}));
 const old=h.controller.load();h.project({id:'two',title:'Project Two'});await h.controller.load();release({id:'one',title:'Private old plan',phases:[]});await old;assert.equal(h.controller.getState().plan.id,'two');assert(!h.controller.render().includes('Private old plan'));
});
test('a denied plan read clears previous phase data instead of presenting it as current',async()=>{
 let fail=false;const h=await harness(async()=>{if(fail)throw Object.assign(Error('Plan access revoked'),{status:404});return {id:'one',title:'Project One',task_scope:'studio',phases:[{id:'phase',title:'Private phase',start_date:null,end_date:null,status:'planned',position:1}]};});
 await h.controller.load();fail=true;await assert.rejects(h.controller.load());assert.equal(h.controller.getState().plan,null);assert(!h.controller.render().includes('Private phase'));assert(h.controller.render().includes('Plan access revoked'));
});
test('overview renders real totals, escapes shared text and keeps participant identities restricted for artists',async()=>{
 const h=await harness(async()=>({phases:[]}));const founder=h.controller.overview();assert(founder.includes('class="project-metric-value">3</dd>'));assert(founder.includes('Pending client responses'));assert(founder.includes('title="Founder"'));assert(founder.includes('Direction &amp; light'));
 h.actor({id:'artist',role:'artist'});const artist=h.controller.overview();assert(artist.includes('Your active tasks'));assert(!artist.includes('title="Founder"'));assert(!artist.includes('data-action="project-edit"'));assert(!artist.includes('data-plan-action="cover"'));assert(!artist.includes('Pending client responses'));
});
