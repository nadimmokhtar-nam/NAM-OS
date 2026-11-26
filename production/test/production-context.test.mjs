import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProductionProjects} from '../public/production.js';

// Exercise the real production controller. Transport is bounded to authorized
// project metadata; rendering assertions do not claim browser usability proof.
function harness(){
 const members=[{id:'founder',name:'Studio lead',role:'founder',sections:['projects']},{id:'artist',name:'Assigned artist',role:'artist',sections:['projects']},{id:'unshared',name:'Other artist',role:'artist',sections:['projects']},{id:'sales',name:'Sales member',role:'sales',sections:['sales']}];
 const data={actor:members[0],members},calls=[];
 const project={id:'shared',title:'Shared courtyard',lead_id:'founder',member_ids:['artist','founder'],brief:'Afternoon light',version:1};
 const module=createProductionProjects({getData:()=>data,openDialog(){},request:async path=>{calls.push(path);return path.startsWith('/projects?')?{items:[structuredClone(project)]}:structuredClone(project);}});
 return {module,data,project,calls};
}

test('An existing standalone task never inherits the currently open project',()=>{
 const {module,project}=harness();module.select(project);
 assert(module.fields().includes('value="shared" selected'),'Quick creation in a project retains its context');
 assert(!module.fields({id:'existing',project_id:null}).includes('value="shared" selected'));
 assert(!module.fields({project_id:''}).includes('value="shared" selected'));
});

test('An unshared project association stays selected instead of silently becoming standalone work',()=>{
 const {module,project}=harness();module.select(project);
 const html=module.fields({id:'assigned',project_id:'unshared-project',production_stage:'Lighting'});
 assert(html.includes('value="unshared-project" selected>Project brief not shared'));
 assert(!html.includes('value="shared" selected'));
 assert(html.includes('value="Lighting" selected'));
});

test('Founder assignment choices follow project participation while standalone work uses section access',async()=>{
 const {module}=harness();
 assert.deepEqual(await module.ownerChoices('shared'),[['founder','Studio lead'],['artist','Assigned artist']]);
 assert.deepEqual(await module.ownerChoices(''),[['founder','Studio lead'],['artist','Assigned artist'],['unshared','Other artist']]);
});

test('An artist assignment picker remains personal and never queries another project membership list',async()=>{
 const {module,data,calls}=harness();data.actor=data.members[1];
 assert.deepEqual(await module.ownerChoices('shared'),[['artist','Assigned artist']]);assert.deepEqual(calls,[]);
});

test('Project assignment choices reject responses after identity or role changes',async()=>{
 let resolve;const data={actor:{id:'founder',role:'founder'},members:[{id:'founder',name:'Lead',role:'founder',sections:['projects']}]};
 const module=createProductionProjects({getData:()=>data,openDialog(){},request:()=>new Promise(done=>resolve=done)});
 const pending=module.ownerChoices('shared');data.actor={id:'founder',role:'artist'};resolve({member_ids:['founder']});
 assert.deepEqual(await pending,[]);
});

test('The project brief shows the accountable project lead',()=>{
 const {module,project}=harness();module.select(project);
 const html=module.render({taskWorkspace:()=>'',newTaskButton:()=>''});
 assert(html.includes('<dt>Project lead</dt><dd>Studio lead</dd>'));
});

test('The project directory uses bare cover regions and real captions without invented artwork or approvals',async()=>{
 const {module,project}=harness();await module.load();
 const html=module.render({taskWorkspace:()=>'<p>Shared work</p>',newTaskButton:()=>''});
 assert(html.includes('class="project-card" data-action="project-open" data-id="'+project.id+'"'));
 assert(html.includes('class="project-card-media" aria-hidden="true"'));
 assert(html.includes('class="project-card-title">Shared courtyard'));
 assert(html.includes('class="project-card-status">Active'));
 assert(!html.includes('panel project-card'));assert(!html.includes('<img'));assert(!html.includes('Approved'));
 assert(html.includes('data-action="project-archived" data-value="all" aria-pressed="true"'));
 assert(html.includes('data-action="project-archived" data-value="archived" aria-pressed="false"'));
});

test('Archive tabs select an explicit scope and do not toggle when selected again',async()=>{
 const {module,calls}=harness();module.toggleArchive('archived');await module.load();
 module.toggleArchive('archived');await module.load();
 assert.deepEqual(calls,['/projects?archived=1','/projects?archived=1']);
 let html=module.render({taskWorkspace:()=>'',newTaskButton:()=>''});assert(html.includes('data-value="archived" aria-pressed="true"'));
 module.toggleArchive('all');await module.load();assert.equal(calls.at(-1),'/projects?archived=0');
 html=module.render({taskWorkspace:()=>'',newTaskButton:()=>''});assert(html.includes('data-value="all" aria-pressed="true"'));
});

test('A project overview keeps its real brief and team with a direct shared-work link and no fake metrics',()=>{
 const {module,project}=harness();module.select({...project,due_date:'2026-12-10',outcome:'Reviewed final files',reference_url:'https://example.invalid/references'});
 const html=module.render({taskWorkspace:section=>'<p>Actual '+section+' work</p>',newTaskButton:()=>'<button>New assigned work</button>'});
 assert(html.includes('class="project-overview-grid"'));assert(html.includes('class="project-brief"'));
 assert(html.includes('class="brief-copy">Afternoon light'));
 assert(html.includes('class="project-overview-meta"'));assert(html.includes('Reviewed final files'));assert(html.includes('href="https://example.invalid/references"'));
 assert(html.includes('class="project-team-list"'));assert(html.includes('Assigned artist'));assert(!html.includes('Other artist'));
 assert(html.includes('<dt>Delivery deadline</dt><dd>10 December 2026</dd>'));
 assert(html.includes('<dt>Brief access</dt><dd>2 participants</dd>'));
 assert(!html.includes('Actual projects work'));assert(html.includes('href="#projects/shared/work">Open Project Management'));assert(html.indexOf('project-team-list')<html.indexOf('project-metric-strip'));assert(html.indexOf('project-metric-strip')<html.indexOf('project-overview-work'));
 const work=module.render({projectView:'work',taskWorkspace:section=>'<p>Actual '+section+' work</p>',newTaskButton:()=>''});assert(work.includes('Actual projects work'));assert(!work.includes('project-brief-title'));
 assert(!html.includes('Approved'));assert(!html.includes('Revenue'));assert(!html.includes('Hours tracked'));
});

test('An artist overview does not expose the Founder participant list or editing actions',()=>{
 const {module,project,data}=harness();data.actor=data.members[1];module.select({...project,member_ids:['artist']});
 const html=module.render({taskWorkspace:()=>'<p>Only assigned work</p>',newTaskButton:()=>''});
 assert(html.includes('This brief is shared with you.'));assert(html.includes('<dt>Brief access</dt><dd>Shared with you</dd>'));
 assert(!html.includes('class="project-team-list"'));assert(!html.includes('data-action="project-edit"'));assert(!html.includes('data-action="project-archive"'));
 assert(html.includes('Your assigned tasks linked to this project.'));assert(!html.includes('Only assigned work'));
 const work=module.render({projectView:'work',taskWorkspace:()=>'<p>Only assigned work</p>',newTaskButton:()=>''});assert(work.includes('Only assigned work'));assert(!work.includes('project-team-list'));
});

test('Missing optional context leaves a single calm brief column and archive retains its restore action',()=>{
 const {module,project}=harness();module.select({...project,archived:true});
 const html=module.render({taskWorkspace:()=>'',newTaskButton:()=>'<button>Unexpected new work</button>'});
 assert(html.includes('project-overview-single'));assert(!html.includes('class="project-overview-meta"'));
 assert(!html.includes('Unexpected new work'));assert(html.includes('data-action="project-archive">Restore project'));
 assert(html.includes('<dt>Status</dt><dd>Archived</dd>'));
});
