import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkspaceRoute,taskPageHash} from '../public/workspace-route.js';

test('task deep links keep the project context and one decoded record identity',()=>{
 const route=parseWorkspaceRoute('#projects/shared%20project/work?task=task%2Fone');
 assert.equal(route.view,'projects');assert.equal(route.recordId,'shared%20project');
 assert.equal(route.projectView,'work');assert.equal(route.taskId,'task/one');
 assert.equal(route.parentHash,'#projects/shared%20project/work');
});

test('replacing a task retains unrelated parent URL state and removes duplicate task keys',()=>{
 const hash=taskPageHash('#tasks?owner=artist&task=old&task=duplicate','next & review');
 assert.equal(hash,'#tasks?owner=artist&task=next+%26+review');
 assert.equal(parseWorkspaceRoute(hash).parentHash,'#tasks?owner=artist');
});

test('task identifiers cannot become routes, query controls or executable markup',()=>{
 const id='"><img src=x onerror=alert(1)>/#?task=other';
 const hash=taskPageHash('#projects/authorized/work',id);
 assert(!hash.includes('<img'));assert.equal(parseWorkspaceRoute(hash).taskId,id);
 assert.equal(parseWorkspaceRoute(hash).parentHash,'#projects/authorized/work');
});

test('an empty location opens Home and a normal route has no selected task',()=>{
 assert.deepEqual(parseWorkspaceRoute(''),{view:'overview',recordId:'',projectView:'overview',taskId:'',parentHash:'#overview'});
 assert.equal(parseWorkspaceRoute('#academy').taskId,'');
});
