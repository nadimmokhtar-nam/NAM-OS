import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {ApiError,fields,readJSON} from '../lib/api/security-helpers.ts';

const workspaceId='10000000-0000-4000-8000-000000000001',memberId='20000000-0000-4000-8000-000000000002',taskId='30000000-0000-4000-8000-000000000003',FP='f'.repeat(64);
let fingerprints={attio:FP,lemlist:null,justcall:null};
const source=await readFile(new URL('../lib/api/sales-workspace.ts',import.meta.url),'utf8'),module={exports:{}};
const context={ApiError,fields,readJSON,json:(value,status=200)=>Response.json(value,{status}),requireFounder:ctx=>{if(ctx.actor.role!=='founder')throw new ApiError(403,'Founder required.');}};
const integrations={salesAccess:ctx=>{if(!['founder','sales','sales_manager'].includes(ctx.actor.role))throw new ApiError(403,'Sales access denied.');},databaseFailure:error=>{throw new ApiError(error.code==='40001'?409:error.code==='P0002'?404:503,'Database request rejected.');},integrationStatus:async()=>[{source:'attio',status:'not_connected',last_synced_at:null}],integrationFingerprints:()=>fingerprints};
// Execute the actual handler after Node's type erasure, substituting only the
// authenticated-context and database boundaries. No compiler package is needed.
const dependencies={'./context':context,'../integrations/service':integrations};
const js=stripTypeScriptTypes(source).replace(/^import ['"]server-only['"];?\s*$/gm,'').replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/gm,(_,bindings,name)=>{assert(Object.hasOwn(dependencies,name),'Unexpected dependency '+name);return `const {${bindings}}=dependencies[${JSON.stringify(name)}];`;}).replace(/^export\s+(?=(?:async\s+)?function)/gm,'');
vm.runInNewContext(js+'\nmodule.exports={dispatchSalesWorkspace,salesWorkspace};',{module,dependencies,URL,URLSearchParams,Request,Response,Date,Number,String,Set,Map},{filename:'sales-workspace.ts'});
const {dispatchSalesWorkspace}=module.exports;
const request=(path,method='GET',body,headers={})=>new Request('https://studio.example/api/sales/workspace'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
function ctx(role='sales',result={data:{view:'contacts',records:[]},error:null}){const calls=[];return {workspaceId,actor:{id:memberId,role},members:[],supabase:{rpc:async(name,args)=>{calls.push({name,args});return result;}},calls};}

test('Workspace GET sends server-owned fingerprints and bounded filters without disclosing them',async()=>{
 const c=ctx(),response=await dispatchSalesWorkspace(c,['sales','workspace'],request('?view=contacts&limit=30&offset=0&q=Actual'));const body=await response.json();assert.equal(c.calls[0].name,'nam_sales_workspace_data');assert.equal(c.calls[0].args.w,workspaceId);assert.equal(c.calls[0].args.fingerprints.attio,FP);assert.equal(c.calls[0].args.filters.q,'Actual');assert.equal(body.source_of_truth,'Attio');assert(!JSON.stringify(body).includes(FP));assert.match(response.headers.get('content-type'),/json/);
});
test('Invalid and cross-owner queries fail before database reads',async()=>{
 for(const query of ['?limit=0','?limit=101','?offset=-1','?period=2026-13','?view=fake','?fingerprints=forged','?owner=20000000-0000-4000-8000-000000000001']){const c=ctx();await assert.rejects(dispatchSalesWorkspace(c,['sales','workspace'],request(query)),e=>e instanceof ApiError&&[400,403].includes(e.status));assert.equal(c.calls.length,0);}
 const denied=ctx('artist');await assert.rejects(dispatchSalesWorkspace(denied,['sales','workspace'],request('')),e=>e.status===403);assert.equal(denied.calls.length,0);
});
test('Creating a follow-up writes one central task RPC with a stable request key and current fingerprint',async()=>{
 const c=ctx('sales',{data:{id:taskId,section:'sales',owner_id:memberId},error:null}),body={source:'attio',kind:'lead',external_id:'actual-provider-id',title:'Discuss next step',due_date:'2026-11-30',priority:'High'};
 const response=await dispatchSalesWorkspace(c,['sales','workspace','followups'],request('/followups','POST',body,{'Idempotency-Key':'stable-followup-key'}));assert.equal(response.status,201);assert.equal(c.calls.length,1);assert.equal(c.calls[0].name,'nam_create_sales_followup');assert.equal(c.calls[0].args.retry_key,'stable-followup-key');assert.equal(c.calls[0].args.source_fingerprint,FP);assert(!Object.hasOwn(c.calls[0].args.changes,'owner_id'));
 const noKey=ctx();await assert.rejects(dispatchSalesWorkspace(noKey,['sales','workspace','followups'],request('/followups','POST',body)),e=>e.status===400);assert.equal(noKey.calls.length,0);
 const forged=ctx();await assert.rejects(dispatchSalesWorkspace(forged,['sales','workspace','followups'],request('/followups','POST',{...body,owner_id:memberId},{'Idempotency-Key':'stable-followup-key'})),e=>e.status===400);assert.equal(forged.calls.length,0);
});
test('Unconfigured service and stale task links cannot be presented as successful saves',async()=>{
 const body={source:'attio',kind:'deal',external_id:'d',task_id:taskId,expectedVersion:2};fingerprints={attio:null};try{const disconnected=ctx();await assert.rejects(dispatchSalesWorkspace(disconnected,['sales','workspace','links'],request('/links','POST',body)),e=>e.status===409);assert.equal(disconnected.calls.length,0);}finally{fingerprints={attio:FP};}
 const stale=ctx('sales',{data:null,error:{code:'40001'}});await assert.rejects(dispatchSalesWorkspace(stale,['sales','workspace','links'],request('/links','POST',body)),e=>e.status===409);assert.equal(stale.calls.length,1);assert.equal(stale.calls[0].args.expected_task_version,2);
});
test('Removing a source link uses the central task version and never deletes the task',async()=>{
 const c=ctx('sales',{data:taskId,error:null});await dispatchSalesWorkspace(c,['sales','workspace','links'],request('/links','DELETE',{task_id:taskId,expectedVersion:3}));assert.equal(c.calls[0].name,'nam_unlink_sales_followup');assert.equal(c.calls[0].args.expected_task_version,3);
});
test('Revenue objectives require founder authority, exact currency/month and optimistic revisions',async()=>{
 const body={owner_id:memberId,period:'2026-11',currency:'EUR',amount:'12000.25',note:'Agreed',expectedVersion:2},c=ctx('founder');await dispatchSalesWorkspace(c,['sales','workspace','targets'],request('/targets','POST',body));assert.equal(c.calls[0].name,'nam_set_sales_revenue_target');assert.equal(c.calls[0].args.payload.expectedVersion,2);assert.equal(c.calls[0].args.payload.amount,'12000.25');
 const denied=ctx();await assert.rejects(dispatchSalesWorkspace(denied,['sales','workspace','targets'],request('/targets','POST',body)),e=>e.status===403);assert.equal(denied.calls.length,0);
 for(const invalid of [{amount:'1.999'},{currency:'eur'},{period:'2026-99'},{expectedVersion:0},{amount:'NaN'}]){const c=ctx('founder');await assert.rejects(dispatchSalesWorkspace(c,['sales','workspace','targets'],request('/targets','POST',{...body,...invalid})),e=>e.status===400);assert.equal(c.calls.length,0);}
});
