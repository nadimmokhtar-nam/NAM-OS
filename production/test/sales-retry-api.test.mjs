import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import {ApiError,fields,readJSON} from '../lib/api/security-helpers.ts';

// Actual dispatch and error normalization; the database's fingerprint rejection
// is separately exercised by sales-db.test.mjs against PostgreSQL.
async function load(relative,dependencies){
 const source=await readFile(new URL(relative,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
 vm.runInNewContext(js,{exports:module.exports,require:name=>{assert(Object.hasOwn(dependencies,name),'Unexpected dependency '+name);return dependencies[name];},process,URL,URLSearchParams,Request,Response,Date,Number,String,Set,Map,Buffer},{filename:relative});
 return module.exports;
}
const context={ApiError,fields,readJSON,json:(value,status=200)=>Response.json(value,{status}),requireFounder:ctx=>{if(ctx.actor.role!=='founder'||!ctx.mfa.verified)throw new ApiError(403,'Founder MFA required.');}};
const service=await load('../lib/integrations/service.ts',{'server-only':{},'node:crypto':crypto,'../api/context':context,'./adapters.mjs':{},'./http.mjs':{IntegrationError:class extends Error{}},'./types':{SOURCES:['attio','lemlist','justcall'],LABELS:{attio:'Attio',lemlist:'Lemlist',justcall:'JustCall'}}});
const api=await load('../lib/api/sales.ts',{'server-only':{},'node:crypto':crypto,'./context':context,'../integrations/service':service,'../integrations/types':{SOURCES:['attio','lemlist','justcall']}});

test('changed-body activity retry reaches the same scoped request key and surfaces HTTP409 without reporting success',async()=>{
 const calls=[],ctx={workspaceId:'10000000-0000-4000-8000-000000000001',actor:{id:'20000000-0000-4000-8000-000000000002',role:'sales'},supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:null,error:{code:'40001',message:'Request key reused for different data'}};},from(){throw new Error('Failed mutation must not load a success snapshot');}}};
 const body={type:'Reply',context:'Updated company',outcome:'Changed after an uncertain response',note:'',occurred_on:'2026-11-24'};
 const request=new Request('http://localhost/api/sales/activities',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'stable-form-key'},body:JSON.stringify(body)});
 await assert.rejects(api.dispatchSales(ctx,['sales','activities'],request),error=>error instanceof ApiError&&error.status===409);
 assert.equal(calls.length,1);assert.equal(calls[0].name,'nam_save_sales_activity');assert.equal(calls[0].args.w,ctx.workspaceId);assert.equal(calls[0].args.p_request_key,'stable-form-key');assert.equal(calls[0].args.payload.outcome,body.outcome);assert(!('owner_id' in calls[0].args.payload));
});
