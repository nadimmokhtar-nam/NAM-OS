import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {ApiError,fields,readJSON} from '../lib/api/security-helpers.ts';

const w='10000000-0000-4000-8000-000000000001',actorId='20000000-0000-4000-8000-000000000001',aid='30000000-0000-4000-8000-000000000001';
const dependencies={'./context':{ApiError,fields,readJSON,json:(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}}),requireFounder:ctx=>{if(ctx.actor.role!=='founder')throw new ApiError(403,'Founder required.');},requireLiveContext:async ctx=>{if(!ctx.live||ctx.assured===false)throw new ApiError(403,'Original session or assurance ended.');}}};
const source=await readFile(new URL('../lib/api/home-announcements.ts',import.meta.url),'utf8'),module={exports:{}};
const js=stripTypeScriptTypes(source).replace(/^import ['"]server-only['"];?\s*$/gm,'').replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/gm,(_,bindings,name)=>{assert(Object.hasOwn(dependencies,name));return `const {${bindings}}=dependencies[${JSON.stringify(name)}];`;}).replace(/^export\s+(?=(?:async\s+)?function)/gm,'');
vm.runInNewContext(js+'\nmodule.exports={dispatchHomeAnnouncements};',{module,dependencies,URL,Request,Response,Date,Number,String,Set,Map},{filename:'home-announcements.ts'});
const {dispatchHomeAnnouncements}=module.exports;
const body={expectedVersion:0,changes:{title:'Studio scheduling update',body:'The reviewed delivery date is Friday.',audience_roles:['sales','artist'],starts_on:'2026-11-25',ends_on:null}};
function context(role='founder',result){const calls=[];return {workspaceId:w,actor:{id:actorId,role},live:true,calls,supabase:{rpc:async(name,args)=>{calls.push({name,args});return result||{data:name==='nam_role'?role:name==='nam_home_announcements_page'?{items:[],total:0,hasMore:false}:name==='nam_home_work_context'?{scope:args.scope,images:null,client_reviews:null}:{id:aid,version:1},error:null};}}};}
function request(path='',method='GET',value,key='home-stable-retry'){return new Request('https://nam.example/api/home/announcements'+path,{method,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});}
const run=(ctx,path='',method='GET',value,key)=>dispatchHomeAnnouncements(ctx,['home','announcements',...path.split('?')[0].split('/').filter(Boolean)],request(path,method,value,key));

test('Home reads use the authenticated workspace, existing permissions and explicit personal/studio scope',async()=>{
 const sales=context('sales'),response=await run(sales);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(sales.calls.length,3);assert(sales.calls.every(call=>call.args.w===w));assert.equal(sales.calls.find(call=>call.name==='nam_home_work_context').args.scope,'mine');
 const founder=context();await run(founder,'?scope=mine');assert.equal(founder.calls.find(call=>call.name==='nam_home_work_context').args.scope,'mine');
 const manager=context();await run(manager,'?mode=manage');assert.equal(manager.calls.length,2);assert.equal(manager.calls[0].args.filters.mode,'manage');
});
test('Malformed, repeated, cross-role and over-bounded Home filters fail before database reads',async()=>{
 for(const path of ['?limit=0','?limit=51','?offset=-1','?mode=invented','?mode=active&mode=manage','?q='+('x'.repeat(201)),'?workspace_id='+w,'?scope=all']){const ctx=context();await assert.rejects(run(ctx,path),e=>e.status===400);assert.equal(ctx.calls.length,0);}
 for(const path of ['?mode=manage','?scope=studio']){const ctx=context('sales');await assert.rejects(run(ctx,path),e=>e.status===403);assert.equal(ctx.calls.length,0);}
 const client=context('client');await assert.rejects(run(client),e=>e.status===403);
});
test('Founder announcement saves normalize only allowed fields and forward exact revisions/retry keys',async()=>{
 const ctx=context(),response=await run(ctx,'','POST',body);assert.equal(response.status,201);assert.equal(ctx.calls[0].name,'nam_save_home_announcement');assert.equal(ctx.calls[0].args.aid,null);assert.equal(ctx.calls[0].args.expected_version,0);assert.equal(ctx.calls[0].args.retry_key,'home-stable-retry');assert.deepEqual(Array.from(ctx.calls[0].args.changes.audience_roles),['artist','sales']);
 const edit=context();await run(edit,'/'+aid,'PATCH',{expectedVersion:4,changes:{archived:true}});assert.equal(edit.calls[0].args.aid,aid);assert.equal(edit.calls[0].args.expected_version,4);assert.equal(edit.calls[0].args.changes.archived,true);
});
test('Writes reject invalid roles, dates, revisions, forged fields and absent exact-retry keys',async()=>{
 for(const value of [{...body,expectedVersion:1},{...body,expectedVersion:'0'},{...body,workspace_id:w},{...body,changes:{...body.changes,audience_roles:['sales','sales']}},{...body,changes:{...body.changes,audience_roles:['client']}},{...body,changes:{...body.changes,starts_on:'2026-02-30'}},{...body,changes:{...body.changes,ends_on:'2026-11-24'}},{...body,changes:{...body.changes,created_by:actorId}},{...body,changes:{...body.changes,title:'Title\nnewline'}}]){const ctx=context();await assert.rejects(run(ctx,'','POST',value),e=>e.status===400);assert.equal(ctx.calls.length,0);}
 const noKey=context();await assert.rejects(run(noKey,'','POST',body,null),e=>e.status===400);assert.equal(noKey.calls.length,0);
 const denied=context('artist');await assert.rejects(run(denied,'','POST',body),e=>e.status===403);assert.equal(denied.calls.length,0);
});
test('Slow request bodies cannot preserve revoked Founder authority into a mutation',async()=>{
 const ctx=context();let controller;const stream=new ReadableStream({start(value){controller=value;}}),request=new Request('https://nam.example/api/home/announcements',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'home-slow-body'},body:stream,duplex:'half'});
 const pending=dispatchHomeAnnouncements(ctx,['home','announcements'],request);await Promise.resolve();ctx.live=false;controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close();await assert.rejects(pending,e=>e.status===403);assert.equal(ctx.calls.length,0);
});
test('History is Founder-only, paginated, tenant-bound and preserves error categories',async()=>{
 const ctx=context();await run(ctx,'/'+aid+'/history?offset=25');assert.equal(ctx.calls[0].name,'nam_home_announcement_history');assert.equal(ctx.calls[0].args.w,w);assert.equal(ctx.calls[0].args.page_offset,25);
 await assert.rejects(run(context('sales'),'/'+aid+'/history'),e=>e.status===403);
 await assert.rejects(run(context(),'/'+aid+'/history?offset=0&offset=25'),e=>e.status===400);
 for(const [code,status] of [['40001',409],['42501',403],['P0002',404],['22023',400],['unavailable',503]])await assert.rejects(run(context('founder',{data:null,error:{code,message:'PRIVATE raw diagnostic'}}),'','POST',body),e=>e.status===status&&!e.message.includes('PRIVATE'));
 assert.equal(await dispatchHomeAnnouncements(context(),['sales'],request()),null);
});
test('Final read checks reject session, elected MFA and role changes after the page or history was read',async()=>{
 for(const kind of ['session','mfa','role']){const ctx=context('sales'),original=ctx.supabase.rpc;ctx.supabase.rpc=async(name,args)=>{const value=await original(name,args);if(name==='nam_home_work_context'){if(kind==='session')ctx.live=false;if(kind==='mfa')ctx.assured=false;}if(kind==='role'&&name==='nam_role')return {data:'artist',error:null};return value;};await assert.rejects(run(ctx),e=>e.status===403);}
 const ctx=context(),original=ctx.supabase.rpc;ctx.supabase.rpc=async(name,args)=>{const value=await original(name,args);if(name==='nam_home_announcement_history')ctx.live=false;return value;};await assert.rejects(run(ctx,'/'+aid+'/history'),e=>e.status===403);
});
