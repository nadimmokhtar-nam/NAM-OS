import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {attioSnapshot} from '../lib/integrations/adapters.mjs';
import {renderSalesWorkspace,salesMoney,createSalesWorkspace} from '../public/sales-workspace.js';

const schema={people:{owner:'responsible',leadStatus:'prospect_status'},companies:{owner:'account_owner'},deals:{closeDate:'expected_close',closedDate:'closed_date',probability:'win_probability'},stageCategories:{'stage-open':'open','Customer':'won'},qualifiedValues:['Qualified'],probabilityScale:100};
const responses={people:[{id:{record_id:'p'},created_at:'2026-11-20T12:00:00Z',web_url:'https://app.attio.com/test/p',values:{name:[{full_name:'Real contact'}],company:[{target_record_id:'c'}],responsible:[{referenced_actor_type:'workspace-member',referenced_actor_id:'owner'}],prospect_status:[{option:{title:'Qualified'}}]}}],companies:[{id:{record_id:'c'},values:{name:[{value:'Real company'}],domains:[{domain:'example.com'}]}}],deals:[{id:{record_id:'d'},values:{name:[{value:'Actual opportunity'}],owner:[{referenced_actor_type:'workspace-member',referenced_actor_id:'owner'}],stage:[{status:{id:{status_id:'stage-open'},title:'Proposal'}}],value:[{currency_value:2400,currency_code:'EUR'}],expected_close:[{value:'2026-11-30'}],closed_date:[{value:'2026-02-30'}],win_probability:[{value:40}],associated_people:[{target_record_id:'p'}],associated_company:[{target_record_id:'c'}]}}]};
function transport(events=[]){return {paceMs:0,fetchImpl:async(url,options)=>{events.push({url:String(url),options});const object=new URL(url).pathname.split('/')[3];return Response.json({data:responses[object]||[]});}};}

test('Attio reporting mappings read real attributes and exact statuses without CRM writes',async()=>{
 const calls=[],snapshot=await attioSnapshot({token:'fixture-secret',attioSchema:JSON.stringify(schema)},transport(calls)),person=snapshot.records.find(r=>r.kind==='lead'),deal=snapshot.records.find(r=>r.kind==='deal');
 assert.equal(person.lead_status,'Qualified');assert.equal(person.is_qualified,true);assert.equal(person.external_owner_id,'owner');assert.deepEqual(person.company_ids,['c']);assert.equal(deal.stage_category,'open');assert.equal(deal.probability,.4);assert.equal(deal.projected_close_on,'2026-11-30');assert.equal(deal.closed_on,null);assert.deepEqual(deal.people_ids,['p']);
 assert(calls.every(c=>c.options.method==='POST'&&c.url.endsWith('/records/query')));assert(calls.every(c=>!Object.hasOwn(JSON.parse(c.options.body),'values')));assert.equal(snapshot.coverage.closed_date_configured,true);
});
test('Unconfigured or invalid CRM semantics remain unavailable',async()=>{
 const snapshot=await attioSnapshot({token:'fixture-secret'},transport()),person=snapshot.records.find(r=>r.kind==='lead'),deal=snapshot.records.find(r=>r.kind==='deal');
 assert.equal(person.lead_status,null);assert.equal(person.is_qualified,null);assert.equal(deal.stage_category,null);assert.equal(deal.probability,null);assert.equal(deal.projected_close_on,null);
 const invalid={...schema,deals:{probability:'win_probability'},probabilityScale:undefined};await assert.rejects(attioSnapshot({token:'fixture',attioSchema:JSON.stringify(invalid)},transport()),e=>e.code==='configuration_error');
 for(const config of ['{broken}',JSON.stringify({people:false}),JSON.stringify({probabilityScale:10}),JSON.stringify({stageCategories:{Won:'guess'}})])await assert.rejects(attioSnapshot({token:'fixture',attioSchema:config},transport()),e=>e.code==='configuration_error');
});

const ctx={actor:{id:'a',role:'sales'},today:'2026-11-25',members:[{id:'a',name:'Actual owner'}],capabilities:{createTaskSections:['sales']}};
const base={view:'contacts',period:'2026-11',offset:0,limit:30,records_total:1,connections:[{source:'attio',label:'Attio',status:'not_connected',last_synced_at:null,coverage:{}}],definitions:{crm:'Attio holds CRM records.'},records:[]};
test('Native sales views use compact source-labelled tables and escape provider text',()=>{
 const unsafe='<img src=x onerror=alert(1)>',data={...base,records:[{source:'attio',kind:'lead',external_id:'p',title:unsafe,email:unsafe,owner_member_id:'a',companies:[{title:unsafe}],followups:[{id:'task',title:unsafe,status:'Todo',due_date:'2026-11-30'}]}]};
 const html=renderSalesWorkspace(data,ctx);assert.match(html,/<table class="sales-table">/);assert.match(html,/Attio · Person/);assert.match(html,/Actual owner/);assert.match(html,/data-action="open-task" data-id="task"/);assert.match(html,/data-sales-workspace-action="new-followup"/);assert(!html.includes(unsafe));assert(!html.includes('class="kpi'));assert(!/ style=/.test(html));
});
test('Unavailable sources and incomplete forecast values cannot render fabricated zero totals',()=>{
 const data={...base,view:'revenue',targets:[{owner_id:'a',currency:'EUR',amount:10000,known_won_value:null,missing_won_data:0}],forecast:[{currency:'EUR',deals:2,known_amount:1000,weighted_amount:null,missing_value:1,missing_probability:1}],forecast_limits:{unclassified_deals:1,undated_open_deals:1,unknown_currency_deals:0,won_without_close_date:0}};
 const html=renderSalesWorkspace(data,ctx);assert.match(html,/Weighted value/);assert.match(html,/Unavailable/);assert(!html.includes('€0'));assert.equal(salesMoney(null,'EUR'),'Unavailable');assert.equal(salesMoney(Infinity,'EUR'),'Unavailable');assert.equal(salesMoney(0,'EUR'),'€0.00');
});
test('Pipeline and campaign rate definitions distinguish snapshot share and event ratios',()=>{
 const pipeline=renderSalesWorkspace({...base,view:'pipeline',connections:[{source:'attio',last_synced_at:'2026-11-25',coverage:{stage_categories_configured:true}}],pipeline:[{currency:'EUR',stage:'Proposal',category:'open',deals:1,known_amount:1000,missing_value:0}],conversion:{won:2,lost:2,unclassified:1}},ctx);assert.match(pipeline,/Closed win share/);assert.match(pipeline,/50%/);assert.match(pipeline,/Current snapshot/);
 const campaign=renderSalesWorkspace({...base,view:'campaigns',definitions:{outreach:'Lifetime team totals.'},records:[{source:'lemlist',kind:'campaign_report',title:'Campaign',emails_sent:100,emails_replied:10,linkedin_sent:null,linkedin_replied:null}]},ctx);assert.match(campaign,/10%/);assert.match(campaign,/not unique-lead conversion/);assert.match(campaign,/Unavailable/);
});
test('Owner selectors and objective actions follow actor capabilities',()=>{
 const sales=renderSalesWorkspace({...base,view:'revenue'},ctx),founder=renderSalesWorkspace({...base,view:'revenue'},{...ctx,actor:{id:'a',role:'founder'}});assert(!sales.includes('id="sales-workspace-owner"'));assert(!sales.includes('data-sales-workspace-action="target"'));assert(founder.includes('id="sales-workspace-owner"'));assert(founder.includes('data-sales-workspace-action="target"'));
});
test('Late source responses cannot repopulate a workspace after session reset',async()=>{
 const previous=globalThis.document;globalThis.document={addEventListener(){}};try{let resolve;const module=createSalesWorkspace({request:()=>new Promise(r=>{resolve=r;}),openDialog(){},getContext:()=>ctx});const pending=module.load();await Promise.resolve();module.reset();resolve({...base,records:[{source:'attio',title:'Must not survive sign-out'}]});await pending;assert(!module.render().includes('Must not survive sign-out'));}finally{globalThis.document=previous;}
});
test('Source-link writes block duplicate actions and restore controls after actor reset',async()=>{
 const previous=globalThis.document,listeners=new Map(),notifications=[],button={dataset:{salesWorkspaceAction:'unlink',id:'task',version:'2'},disabled:false,isConnected:true},close={disabled:false,isConnected:true};globalThis.document={addEventListener:(name,handler)=>listeners.set(name,handler),querySelectorAll:()=>[button,close]};
 try{let finish,writes=0;const module=createSalesWorkspace({request:path=>{if(path==='/sales/workspace/links'){writes++;return new Promise(resolve=>{finish=resolve;});}return Promise.resolve(base);},openDialog(){},getContext:()=>ctx,toast:text=>notifications.push(text)});await module.load();const event={target:{closest:()=>button},preventDefault(){}};const pending=listeners.get('click')(event);assert.equal(module.isSaving(),true);assert.equal(button.disabled,true);assert.equal(close.disabled,true);await listeners.get('click')(event);assert.equal(writes,1);module.reset();assert.equal(module.isSaving(),false);assert.equal(close.disabled,false);finish({task_id:'task'});await pending;assert.equal(notifications.length,0);assert.equal(button.disabled,false);}finally{globalThis.document=previous;}
});
test('Scoped styles and client module preserve the production CSP',async()=>{
 const js=await readFile(new URL('../public/sales-workspace.js',import.meta.url),'utf8'),css=await readFile(new URL('../public/sales-workspace.css',import.meta.url),'utf8');assert(!js.includes('style="'));assert(!js.includes('javascript:'));assert(css.includes('var(--font-display)'));assert(css.includes('var(--font-ui)'));assert(css.includes('.sales-table-wrap{overflow:auto'));
});
