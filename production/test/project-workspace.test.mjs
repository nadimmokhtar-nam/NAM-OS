import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProductionProjects} from '../public/production.js';

// Real project-controller output with bounded authorized input. Routing, native
// focus and database authorization are verified separately through the app.
function fixture(role='founder'){
 const members=[{id:'lead',name:'Studio lead',initials:'SL',role:'founder',sections:['projects']},{id:'artist',name:'Assigned artist',initials:'AA',role:'artist',sections:['projects']}];
 const data={actor:members[role==='founder'?0:1],members,tasks:[{id:'one-loaded-task',project_id:'shared-project'}]};
 const module=createProductionProjects({getData:()=>data,openDialog(){},request:async()=>{throw Error('Rendering must not query hidden project data.');}});
 const project={id:'shared-project',title:'Shared courtyard',brief:'Preserve the approved camera.',outcome:'Checked final files.',reference_url:'https://example.invalid/references',lead_id:'lead',member_ids:role==='founder'?['lead','artist']:['artist'],due_date:'2026-12-10',version:1,archived:false};
 let calls=0;
 const views={taskWorkspace:section=>{calls++;return '<div data-real-task-workspace="'+section+'">Authorized shared records</div>';},newTaskButton:()=>'<button data-action="create-task" data-section="projects">Create task</button>'};
 return {module,data,project,views,get calls(){return calls;}};
}

test('No selected project produces no contextual navigation or invented project route',()=>{
 const {module}=fixture();assert.equal(module.navigation(),'');assert.equal(module.projectHash(),'#projects');
});

test('Contextual navigation exposes real Overview and Project Management routes with one selected view',()=>{
 const {module,project}=fixture();module.select(project);
 const overview=module.navigation('overview');
 assert(overview.includes('aria-label="Back to projects"'));assert(overview.includes('data-action="project-back"'));
 assert(overview.includes('href="#projects/shared-project" aria-current="page"'));
 assert(overview.includes('href="#projects/shared-project/work" >'));
 assert.equal((overview.match(/aria-current="page"/g)||[]).length,1);
 const work=module.navigation('work');assert(work.includes('href="#projects/shared-project/work" aria-current="page"'));
 assert.equal(module.projectViewLabel('overview'),'Overview');assert.equal(module.projectViewLabel('work'),'Project Management');
 assert(!/Files|Timeline|Guest|Approval/.test(work));
});

test('Project names are escaped and route identifiers cannot create markup or alternate link protocols',()=>{
 const {module,project}=fixture();module.select({...project,id:'bad"<id>/test',title:'Courtyard <img src=x onerror=alert(1)> & study'});
 const html=module.navigation();assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('&amp; study'));
 assert.equal(module.projectHash('work'),'#projects/bad%22%3Cid%3E%2Ftest/work');assert(!html.includes('href="javascript:'));
});

test('Overview presents the brief and team separately from task management and uses the authoritative task total',()=>{
 const f=fixture();f.module.select(f.project);
 const html=f.module.render({...f.views,projectView:'overview',projectTaskCount:120});
 assert.equal(f.calls,0,'Overview must not mount the task workspace');
 assert(html.includes('Preserve the approved camera.'));assert(html.includes('project-team-list'));assert(html.includes('Checked final files.'));
 assert(html.includes('project-task-total">120</strong>'),'The full total must not be replaced by the one loaded task');
 assert(html.includes('Project tasks</h2>'));assert(html.includes('href="#projects/shared-project/work">Open Project Management'));
 assert(!html.includes('data-real-task-workspace'));assert(!/Images approved|Revenue|Timeline/.test(html));
});

test('Project Management reuses the exact shared project task workspace without duplicating the brief',()=>{
 const f=fixture();f.module.select(f.project);
 const html=f.module.render({...f.views,projectView:'work',projectTaskCount:120});
 assert.equal(f.calls,1);assert(html.includes('<h1>Project Management</h1>'));
 assert(html.includes('data-real-task-workspace="projects"'));assert(html.includes('Authorized shared records'));
 assert(!html.includes('project-brief-title'));assert(!html.includes('project-team-list'));assert(!html.includes('project-task-total'));
});

test('Missing or invalid task totals retain a working management link without displaying a fabricated count',()=>{
 const f=fixture();f.module.select(f.project);
 for(const projectTaskCount of [null,undefined,-1,1.5,'12',Infinity,NaN]){
  const html=f.module.render({...f.views,projectView:'overview',projectTaskCount});
  assert(!html.includes('class="project-task-total"'));assert(html.includes('href="#projects/shared-project/work">Open Project Management'));
 }
 assert(f.module.render({...f.views,projectView:'overview',projectTaskCount:0}).includes('project-task-total">0</strong>'),'A verified empty total remains a genuine zero');
});

test('Artist project context preserves individual access rather than exposing the Founder team controls',()=>{
 const f=fixture('artist');f.module.select(f.project);
 const html=f.module.render({...f.views,projectView:'overview',projectTaskCount:1});
 assert(html.includes('Your assigned tasks linked to this project.'));
 assert(html.includes('<dd>Shared with you</dd>'));assert(!html.includes('project-team-list'));
 assert(!html.includes('data-action="project-edit"'));assert(!html.includes('data-action="project-archive"'));
 assert(f.module.navigation('work').includes('Project Management'));
});

test('Archived projects preserve their real work and Founder restore action without offering new work creation',()=>{
 const f=fixture();f.module.select({...f.project,archived:true});
 const work=f.module.render({...f.views,projectView:'work'});assert(work.includes('Authorized shared records'));assert(!work.includes('data-action="create-task"'));
 const overview=f.module.render({...f.views,projectView:'overview'});assert(overview.includes('data-action="project-archive">Restore project'));
});

test('Leaving or replacing a project removes stale contextual navigation and routes',()=>{
 const {module,project}=fixture();module.select(project);module.back();
 assert.equal(module.navigation('work'),'');assert.equal(module.projectHash('work'),'#projects');
 module.select({...project,id:'second-project',title:'Second shared project'});
 const html=module.navigation('work');assert(html.includes('Second shared project'));assert(!html.includes('shared-project/work'));assert.equal(module.projectHash('work'),'#projects/second-project/work');
});

test('Unsupported project subviews resolve to the implemented overview without fake navigation items',()=>{
 const f=fixture();f.module.select(f.project);
 assert.equal(f.module.projectHash('timeline'),'#projects/shared-project');assert.equal(f.module.projectViewLabel('timeline'),'Overview');
 const html=f.module.render({...f.views,projectView:'timeline'});assert(html.includes('project-brief-title'));assert.equal(f.calls,0);
});
