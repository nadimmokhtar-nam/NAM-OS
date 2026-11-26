import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProductionProjects} from '../public/production.js';

const rows=[
 {id:'two',title:'Residence 2',client_name:'Example Architecture',location:'Paris',due_date:'2026-12-02',created_at:'2026-11-02T10:00:00Z',updated_at:'2026-11-22T10:00:00Z',has_cover:true},
 {id:'ten',title:'Residence 10',client_name:'Example Studio',location:'Sydney',due_date:'2026-12-10',created_at:'2026-11-10T10:00:00Z',updated_at:'2026-11-20T10:00:00Z'},
 {id:'atelier',title:'Atelier Étage',client_name:'Example Architecture',location:'Lyon',due_date:null,created_at:'2026-11-15T10:00:00Z',updated_at:'2026-11-25T10:00:00Z'},
 {id:'missing',title:'Unscheduled',client_name:'Example Client',location:'Paris',due_date:null,created_at:null,updated_at:null}
];
const views={taskWorkspace:()=>'',newTaskButton:()=>''};
function fixture(role='founder',request){
 const data={actor:{id:'actor',role},members:[]};let requests=0;
 const module=createProductionProjects({getData:()=>data,openDialog(){},request:async url=>{requests++;return request?request(url):url.startsWith('/projects?')?{items:rows.map(row=>({...row}))}:rows.find(row=>url.endsWith('/'+row.id));}});
 return {module,data,get requests(){return requests;}};
}
const ids=html=>[...html.matchAll(/class="project-card"[^>]*data-id="([^"]+)"/g)].map(match=>match[1]);

test('project search combines permitted name, client and location without fetching another record',async()=>{
 const f=fixture();await f.module.load();
 f.module.setDirectory({search:'example architecture paris'});assert.deepEqual(ids(f.module.render(views)),['two']);
 f.module.setDirectory({search:'etage'});assert.deepEqual(ids(f.module.render(views)),['atelier']);
 f.module.setDirectory({search:'SYDNEY'});assert.deepEqual(ids(f.module.render(views)),['ten']);
 assert.equal(f.requests,1);assert.equal(f.module.getRecords().length,4);
});

test('natural-name and saved-date sorting are stable and leave missing dates last in both directions',async()=>{
 const f=fixture();await f.module.load();
 f.module.setDirectory({sort:'title'});assert.deepEqual(ids(f.module.render(views)),['atelier','two','ten','missing']);
 f.module.setDirectory({direction:'desc'});assert.deepEqual(ids(f.module.render(views)),['missing','ten','two','atelier']);
 f.module.setDirectory({sort:'updated_at'});assert.deepEqual(ids(f.module.render(views)),['atelier','two','ten','missing']);
 f.module.setDirectory({sort:'created_at',direction:'asc'});assert.deepEqual(ids(f.module.render(views)),['two','ten','atelier','missing']);
 f.module.setDirectory({sort:'due_date',direction:'desc'});assert.deepEqual(ids(f.module.render(views)),['ten','two','atelier','missing']);
 assert.deepEqual(f.module.getRecords().map(row=>row.id),rows.map(row=>row.id));
});

test('Grid and List keep the same project identities, verified cover route and role-bound creation',async()=>{
 for(const role of ['founder','artist']){const f=fixture(role);await f.module.load();const grid=f.module.render(views);
  f.module.setDirectory({view:'list'});const list=f.module.render(views);assert.deepEqual(ids(grid),ids(list));
  assert(grid.includes('class="project-grid"'));assert(list.includes('class="project-list"'));assert(list.includes('/api/projects/two/cover?variant=thumbnail'));
  assert.equal(list.includes('data-action="project-create"'),role==='founder');assert.equal(f.requests,1);
 }
});

test('a project visit retains directory choices, while reset clears them and invalidates earlier reads',async()=>{
 let release,blocked=false;const f=fixture('founder',url=>url.startsWith('/projects?')?blocked?new Promise(resolve=>release=()=>resolve({items:rows})):{items:rows}:rows[0]);
 await f.module.load();f.module.setDirectory({search:'residence',view:'list',sort:'title'});await f.module.open('two');f.module.back();
 assert.equal(f.module.getDirectory().view,'list');assert.equal(f.module.getDirectory().search,'residence');assert.deepEqual(ids(f.module.render(views)),['two','ten']);
 blocked=true;const read=f.module.load();f.module.reset();f.data.actor={id:'another-actor',role:'artist'};release();await read;
 assert.equal(f.module.getRecords().length,0);assert.deepEqual(f.module.getDirectory(),{view:'grid',search:'',sort:'updated_at',direction:'desc'});
});

test('empty searches distinguish no matches from no projects and keep the 200-project boundary explicit',async()=>{
 const f=fixture('founder',async()=>({items:Array.from({length:200},(_,index)=>({...rows[0],id:'project-'+index,title:'Project '+index}))}));await f.module.load();
 f.module.setDirectory({search:'not present'});const html=f.module.render(views);
 assert(html.includes('No matching projects'));assert(html.includes('data-action="project-search-clear"'));assert(html.includes('Search and sorting apply to these results.'));assert(!html.includes('No projects yet'));
 const empty=fixture('artist',async()=>({items:[]}));await empty.module.load();assert(empty.module.render(views).includes('No projects yet'));
});

test('project captions, search values and menu state remain escaped and missing dates are not fabricated',async()=>{
 const f=fixture('founder',async()=>({items:[{id:'bad"<id>',title:'<img src=x onerror=alert(1)>',updated_at:null}]}));await f.module.load();
 let html=f.module.render(views);assert(!html.includes('<img src=x'));assert(html.includes('&lt;img'));assert(html.includes('Update date unavailable'));
 f.module.setDirectory({search:'"<svg>',view:'unsupported',sort:'unexpected',direction:'sideways'});html=f.module.render(views);
 assert(html.includes('value="&quot;&lt;svg&gt;"'));assert.equal(f.module.getDirectory().view,'grid');assert.equal(f.module.getDirectory().sort,'updated_at');assert.equal(f.module.getDirectory().direction,'desc');
});
