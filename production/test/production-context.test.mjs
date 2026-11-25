import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProductionProjects} from '../public/production.js';

// Exercise the real production controller. Transport is bounded to authorized
// project metadata; rendering assertions do not claim browser usability proof.
function harness(){
 const members=[{id:'founder',name:'Studio lead',role:'founder',sections:['projects']},{id:'artist',name:'Assigned artist',role:'artist',sections:['projects']},{id:'unshared',name:'Other artist',role:'artist',sections:['projects']},{id:'sales',name:'Sales member',role:'sales',sections:['sales']}];
 const data={actor:members[0],members},calls=[];
 const project={id:'shared',title:'Shared courtyard',lead_id:'founder',member_ids:['artist','founder'],brief:'Afternoon light',version:1};
 const module=createProductionProjects({getData:()=>data,openDialog(){},request:async path=>{calls.push(path);return structuredClone(project);}});
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
 assert(html.includes('Project lead</span><strong>Studio lead</strong>'));
});
