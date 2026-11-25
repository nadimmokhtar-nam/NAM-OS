import test from 'node:test';
import assert from 'node:assert/strict';
import {salesDeskModel,salesTargetCount,renderSalesDesk} from '../public/sales-desk.js';

const data={actor:{id:'sales-a',role:'sales'},today:'2026-11-25',members:[{id:'sales-a',name:'Sales A'},{id:'sales-b',name:'Sales B'}],capabilities:{createTaskSections:['sales']},tasks:[]};
const task=(id,changes={})=>({id,owner_id:'sales-a',section:'sales',status:'Todo',title:id,due_date:null,...changes});
const sales={activities:[],reports:[],targets:[],activity_counts:[]};
const render=(changes={})=>renderSalesDesk({data,sales,taskRows:rows=>rows.map(row=>row.title).join('|'),...changes});

test('Sales desk prioritizes actionable follow-ups without counting closed or other-section work',()=>{
 const tasks=[task('future',{due_date:'2026-12-01'}),task('today',{due_date:data.today}),task('blocked',{status:'Blocked'}),task('late',{due_date:'2026-11-20'}),task('done',{status:'Done'}),task('canceled',{status:'Canceled'}),task('archived',{archived:true}),task('deleted',{deleted_at:'2026-11-24'}),task('project',{section:'projects'})];
 const model=salesDeskModel({data:{...data,tasks},sales});assert.deepEqual(model.tasks.map(t=>t.id),['late','blocked','today','future']);
 assert.equal(tasks[0].id,'future','render sorting does not mutate the shared task page');
});

test('Sales representatives cannot select another owner through renderer arguments',()=>{
 const model=salesDeskModel({data:{...data,tasks:[task('mine'),task('other',{owner_id:'sales-b'})]},sales:{...sales,activities:[{owner_id:'sales-b'}],reports:[{owner_id:'sales-b'}],targets:[{owner_id:'sales-b',period:'2026-11'}]},owner:'sales-b'});
 assert.equal(model.owner,'sales-a');assert.deepEqual(model.tasks.map(t=>t.id),['mine']);assert.equal(model.activities.length,0);assert.equal(model.reports.length,0);assert.equal(model.targets.length,0);
});

test('Founder desk can review the permitted team or focus one salesperson consistently',()=>{
 const founder={...data,actor:{id:'founder',role:'founder'},tasks:[task('a'),task('b',{owner_id:'sales-b'})]};
 assert.equal(salesDeskModel({data:founder,sales}).tasks.length,2);
 const focused=salesDeskModel({data:founder,sales,owner:'sales-b'});assert.deepEqual(focused.tasks.map(t=>t.id),['b']);
 const html=render({data:founder,owner:'sales-b'});assert.match(html,/data-action="sales-work"[^>]*data-owner="sales-b"/);assert.match(html,/Sales B/);
});

test('Target figures require complete server aggregates and never infer a zero from recent activities',()=>{
 const target={owner_id:'sales-a',metric:'Meetings held',period:'2026-11'};
 assert.equal(salesTargetCount({activities:[{type:'Meeting held'}]},target),null);
 assert.equal(salesTargetCount({...sales,activity_counts:[{owner_id:'sales-a',type:'Meeting held',period:'2026-11',n:'7'}]},target),7);
 assert.equal(salesTargetCount({...sales,activity_counts:[{owner_id:'sales-b',type:'Meeting held',period:'2026-11',n:999}]},target),0);
 for(const n of [null,undefined,-1,1.5,'oops',Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(salesTargetCount({...sales,activity_counts:[{owner_id:'sales-a',type:'Meeting held',period:'2026-11',n}]},target),null);
});

test('A bounded page never claims all follow-ups are clear or supplies an inferred metric',()=>{
 const html=render({taskPage:{hasMore:true,total:1000}});assert.match(html,/No open follow-ups in this loaded page/);assert.match(html,/preview from the loaded work/);assert.doesNotMatch(html,/0 overdue|all caught up|No overdue/i);
});

test('Recent activity, owner names, outcomes and report blockers remain escaped',()=>{
 const unsafe='<img src=x onerror=alert(1)>';
 const html=render({data:{...data,members:[{id:'sales-a',name:unsafe}]},sales:{...sales,activities:[{id:'a',owner_id:'sales-a',context:unsafe,outcome:unsafe,occurred_on:data.today,type:'Outreach'}],reports:[{id:'r',owner_id:'sales-a',week_start:'2026-11-23',blockers:unsafe}]}});
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes(unsafe));
});

test('Pending founder reviews use the source detail workflow, with previews bounded',()=>{
 const founder={...data,actor:{id:'founder',role:'founder'}},reports=Array.from({length:8},(_,i)=>({id:'r'+i,owner_id:'sales-a',week_start:'2026-11-23',submitted_at:'2026-11-24',reviewed_at:null,blockers:'Waiting on brief'}));
 const html=render({data:founder,sales:{...sales,reports}});assert.equal((html.match(/data-action="brief-review"/g)||[]).length,3);assert.match(html,/data-kind="sales_report"/);assert.doesNotMatch(html,/data-action="review-report"/);
});

test('Sales desk actions are meaningful existing handlers and creation respects capabilities',()=>{
 const html=render();for(const action of ['activity','report','create-task','sales-work','tab'])assert.ok(html.includes(`data-action="${action}"`));
 assert.ok(html.includes('data-value="connected"'));assert.ok(html.includes('data-value="activities"'));
 const denied=render({data:{...data,capabilities:{createTaskSections:[]}}});assert.ok(!denied.includes('data-action="create-task"'));assert.ok(!denied.includes('data-action="target"'));
});
