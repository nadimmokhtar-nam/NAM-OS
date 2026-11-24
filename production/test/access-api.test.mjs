import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as helpers from '../lib/api/security-helpers.ts';
import {database,asUser,ids} from './database.mjs';

// Actual access dispatcher and PostgreSQL RPCs; provider transport and the
// central route's CSRF enforcement remain separately tested boundaries.
async function fixture(t){
 const db=await database();t.after(()=>db.close());const calls=[];
 function context(user=ids.founder,{role=user===ids.founder?'founder':'sales',aal='aal2'}={}){const ctx={user:{id:user},sessionId:user,actor:{id:user,role},workspaceId:ids.w,members:[{id:ids.founder,name:'Founder',role:'founder'},{id:ids.sales,name:'Sales',role:'sales'}],mfa:{verified:aal==='aal2',required:user===ids.founder},supabase:{async rpc(name,args){calls.push({name,args});try{const keys=Object.keys(args);const result=await asUser(db,user,()=>db.query(`select to_jsonb(public.${name}(${keys.map((key,i)=>key+' => $'+(i+1)).join(',')})) as data`,keys.map(key=>args[key])),{aal});return {data:result.rows[0].data,error:null};}catch(error){return {data:null,error};}}}};return ctx;}
 const dependencies={...helpers,json:(value,status=200)=>Response.json(value,{status}),requireFounder(ctx){if(ctx.actor.role!=='founder'||!ctx.mfa.verified)throw new helpers.ApiError(403,'Verified founder required');},async requireLiveContext(ctx){const {data,error}=await ctx.supabase.rpc('nam_founder',{w:ctx.workspaceId});if(error||!data)throw new helpers.ApiError(403,'Founder access was revoked');}};
 const code=ts.transpileModule(await readFile(new URL('../lib/api/access.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};vm.runInNewContext(code,{exports:module.exports,module,Request,Response,Number,Set,Object,Array,console,require(name){if(name==='server-only')return {};if(name==='./context')return dependencies;throw new Error(name);}});
 const request=(method='GET',input)=>new Request(`https://nam.example/api/auth/access/${ids.sales}`,{method,...(input?{headers:{'content-type':'application/json'},body:JSON.stringify(input)}:{})});
 return {db,calls,context,request,...module.exports};
}

test('access API returns and saves the actual fixed-role/grant revision through user-scoped PostgreSQL',async t=>{
 const f=await fixture(t),ctx=f.context();let response=await f.dispatchAccess(ctx,['auth','access',ids.sales],f.request());let member=await response.json();assert.equal(member.id,ids.sales);assert.equal(member.editable,true);assert.equal(member.grants.length,3);
 response=await f.dispatchAccess(ctx,['auth','access',ids.sales],f.request('PATCH',{expectedRevision:member.revision,role:'sales',grants:[{section:'sales',can_create:false}]}));member=await response.json();assert.equal(member.revision,2);assert.deepEqual(member.grants.map(g=>({section:g.section,can_create:g.can_create})),[{section:'sales',can_create:false}]);const effective=await f.effectiveAccess(f.context(ids.sales));assert.deepEqual(Array.from(effective.sections),['sales']);assert.deepEqual(Array.from(effective.create_sections),[]);
 await assert.rejects(()=>f.dispatchAccess(ctx,['auth','access',ids.sales],f.request('PATCH',{expectedRevision:1,role:'sales',grants:[]})),e=>e.status===409&&e.code==='ACCESS_CONFLICT');
 const write=f.calls.find(c=>c.name==='nam_save_member_access');assert.equal(write.args.w,ids.w);assert.equal(write.args.target_user,ids.sales);assert(!('actor_id'in write.args));
});
test('access API rejects unverified roles, forged fields, unsupported scopes and duplicate sections before mutation',async t=>{
 const f=await fixture(t),path=['auth','access',ids.sales];await assert.rejects(()=>f.dispatchAccess(f.context(ids.sales),path,f.request()),{status:403});await assert.rejects(()=>f.dispatchAccess(f.context(ids.founder,{aal:'aal1'}),path,f.request()),{status:403});
 const invalid=[{expectedRevision:1,role:'founder',grants:[]},{expectedRevision:1,role:'sales',grants:[],actor_id:ids.founder},{expectedRevision:1,role:'sales',grants:[{section:'sales',can_create:true,can_manage:true}]},{expectedRevision:1,role:'sales',grants:[{section:'sales',can_create:true},{section:'sales',can_create:false}]},{expectedRevision:'1',role:'sales',grants:[]}];for(const input of invalid)await assert.rejects(()=>f.dispatchAccess(f.context(),path,f.request('PATCH',input)),{status:400});assert(!f.calls.some(c=>c.name==='nam_save_member_access'));
 await assert.rejects(()=>f.dispatchAccess(f.context(),['auth','access','not-a-uuid'],f.request()),{status:400});assert.equal(await f.dispatchAccess(f.context(),['auth','security'],f.request()),null);
});
test('access API rechecks live founder authority after a slow request body',async t=>{
 const f=await fixture(t);let stream;const body=new ReadableStream({start(controller){stream=controller;}});const request=new Request('https://nam.example/api/auth/access/'+ids.sales,{method:'PATCH',headers:{'content-type':'application/json'},body,duplex:'half'}),pending=f.dispatchAccess(f.context(),['auth','access',ids.sales],request);
 await Promise.resolve();await f.db.query('update nam_memberships set active=false where workspace_id=$1 and user_id=$2',[ids.w,ids.founder]);stream.enqueue(new TextEncoder().encode(JSON.stringify({expectedRevision:1,role:'sales',grants:[]})));stream.close();await assert.rejects(()=>pending,{status:403});assert(!f.calls.some(c=>c.name==='nam_save_member_access'));assert.equal((await f.db.query('select count(*)::int as n from nam_access_events')).rows[0].n,0);
});
test('missing or malformed effective-access metadata fails closed',async t=>{
 const f=await fixture(t);for(const data of [null,{}, {sections:['sales'],create_sections:['projects'],member_sections:{}},{sections:['sales'],create_sections:[],member_sections:{}},{sections:['sales'],create_sections:[],member_sections:{[ids.sales]:['finance']}}])await assert.rejects(()=>f.effectiveAccess({...f.context(ids.sales),supabase:{rpc:async()=>({data,error:null})}}),{status:503});
});
