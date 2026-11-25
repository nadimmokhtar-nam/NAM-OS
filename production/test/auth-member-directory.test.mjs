import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as helpers from '../lib/api/security-helpers.ts';
import {database,asUser,ids} from './database.mjs';

// PostgreSQL/RLS/ACL and real dispatchers execute; GoTrue/cookies are fixtures.
// These checks are not represented as hosted HTTP or browser verification.
let db;
before(async()=>{db=await database();});
after(async()=>{await db?.close();});
const quote=value=>{if(!/^[a-z_]+$/.test(value))throw Error('Invalid fixture identifier');return '"'+value+'"';};
const secret='fixture-only-directory-CSRF-secret-longer-than32chars';
const env={NAM_APP_ORIGIN:'https://nam.example.test',NAM_CSRF_SECRET:secret,NEXT_PUBLIC_SUPABASE_URL:'https://provider.example.test',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key'};
const rpc=(user,name,args,options={aal:'aal1'})=>asUser(db,user,()=>db.query('select * from public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args),options);
function table(user,table,options,calls){
 assert(['nam_memberships','nam_invitations'].includes(table));const query={columns:'*',filters:[],order:'',single:false};
 return {
  select(columns){query.columns=columns.split(',').map(quote).join(',');return this;},
  eq(name,value){query.filters.push([name,value]);return this;},
  order(name,{ascending=true}={}){query.order=' order by '+quote(name)+(ascending?' asc':' desc');return this;},
  maybeSingle(){query.single=true;return this;},
  then(resolve,reject){return (async()=>{
   calls.push({kind:options.role==='service_role'?'admin-read':'caller-read',table});
   try{
    const args=[],where=query.filters.map(([name,value])=>quote(name)+' = $'+args.push(value)).join(' and ');
    const result=await asUser(db,user,()=>db.query('select '+query.columns+' from public.'+quote(table)+(where?' where '+where:'')+query.order,args),options);
    return {data:query.single?result.rows[0]||null:result.rows,error:null};
   }catch(error){return {data:null,error};}
  })().then(resolve,reject);},
 };
}
async function fixture(user=ids.founder){
 const calls=[],csrf=helpers.issueCsrf(user,ids.w,secret),ctx={user:{id:user,email:'synthetic@policy-test.invalid'},sessionId:user,workspaceId:ids.w,actor:{id:user,name:'Synthetic member',role:user===ids.founder?'founder':'sales'},members:[],csrf,mfa:{required:false,verified:false,factors:[]}};
 ctx.supabase={
  auth:{getClaims:async()=>({data:{claims:{sub:user,session_id:user,aal:'aal1'}},error:null})},
  from:name=>table(user,name,{aal:'aal1'},calls),
  async rpc(name,args){
   calls.push({kind:'caller-rpc',name});assert(['nam_founder','nam_member_directory'].includes(name));
   try{const result=await rpc(user,name,[args.w]);return {data:name==='nam_founder'?result.rows[0].nam_founder:result.rows,error:null};}
   catch(error){return {data:null,error};}
  },
 };
 const admin={from:name=>table(null,name,{role:'service_role'},calls),auth:{admin:{
  async getUserById(id){calls.push({kind:'provider-user'});return {data:{user:(await db.query('select id,email from auth.users where id=$1',[id])).rows[0]},error:null};},
  async generateLink(){calls.push({kind:'provider-link'});return {data:{properties:{hashed_token:'fixture-provider-hash'}},error:null};},
 }}};
 const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context={exports:{}};
 vm.runInNewContext(compile(await readFile(new URL('../lib/api/context.ts',import.meta.url),'utf8')),{Buffer,URL,Response,Request,console,process:{env},module:context,exports:context.exports,require(name){
  if(['server-only','next/headers','@/lib/supabase/server'].includes(name))return {};
  if(name==='./security-helpers')return helpers;throw Error('Unexpected context import');
 }});
 const module={exports:{}};
 vm.runInNewContext(compile(await readFile(new URL('../lib/api/auth.ts',import.meta.url),'utf8')),{Buffer,URL,Response,Request,Date,console,process:{env},module,exports:module.exports,require(name){
  if(name==='server-only')return {};if(name==='node:crypto')return crypto;
  if(name==='next/headers')return {cookies:async()=>({get(){},set(){},delete(){}})};
  if(name==='@supabase/supabase-js')return {createClient(){calls.push({kind:'provider-client'});return admin;}};
  if(name==='@/lib/supabase/server')return {supabaseServer:async()=>ctx.supabase};
  if(name==='./context')return context.exports;if(name==='./security-helpers')return helpers;throw Error('Unexpected auth import');
 }},{filename:'auth.ts'});
 return {ctx,api:module.exports,calls,request(path,body){return new Request(env.NAM_APP_ORIGIN+'/api'+path,body===undefined?{}:{method:'POST',headers:{origin:env.NAM_APP_ORIGIN,'content-type':'application/json',cookie:'nam_csrf='+csrf,'x-csrf-token':csrf},body:JSON.stringify(body)});}};
}

test('Founder directory includes suspended members without granting the Auth service membership SELECT',async()=>{
 const rights=(await db.query("select has_table_privilege('service_role','public.nam_memberships','SELECT') as service,has_table_privilege('authenticated','public.nam_memberships','SELECT') as caller")).rows[0];
 assert.equal(rights.service,false);assert.equal(rights.caller,true);
 await assert.rejects(asUser(db,null,()=>db.query('select user_id from nam_memberships'),{role:'service_role'}),error=>error.code==='42501');
 await assert.rejects(rpc(null,'nam_member_directory',[ids.w],{role:'service_role'}),error=>error.code==='42501');
 const ordinary=(await asUser(db,ids.founder,()=>db.query('select user_id from nam_memberships where workspace_id=$1',[ids.w]),{aal:'aal1'})).rows;
 assert(!ordinary.some(row=>row.user_id===ids.suspended),'Ordinary active-only membership RLS must remain unchanged');
 const rows=(await rpc(ids.founder,'nam_member_directory',[ids.w])).rows;
 assert(rows.some(row=>row.user_id===ids.suspended&&!row.active));assert(!rows.some(row=>row.user_id===ids.outsider));
 assert.deepEqual(Object.keys(rows[0]).sort(),['active','name','role','user_id']);
 const f=await fixture(),response=await f.api.authAPI(f.ctx,f.request('/auth/members'),'/auth/members'),body=await response.json();
 assert.equal(response.status,200);assert(body.accounts.some(row=>row.id===ids.suspended&&row.status==='suspended'));assert(!body.accounts.some(row=>row.id===ids.outsider));
 assert(f.calls.some(call=>call.kind==='caller-rpc'&&call.name==='nam_member_directory'));assert(!f.calls.some(call=>call.kind==='admin-read'));
});

test('directory denies non-Founders, anonymous calls and cross-workspace lookup',async()=>{
 for(const user of [ids.sales,ids.artist,ids.outsider,ids.suspended])await assert.rejects(rpc(user,'nam_member_directory',[ids.w]),error=>error.code==='42501');
 await assert.rejects(rpc(null,'nam_member_directory',[ids.w],{role:'anon'}),error=>error.code==='42501');
 await assert.rejects(rpc(ids.founder,'nam_member_directory',[ids.otherW]),error=>error.code==='42501');
 const f=await fixture(ids.sales);
 await assert.rejects(()=>f.api.authAPI(f.ctx,f.request('/auth/members'),'/auth/members'),error=>error.status===403);
 await assert.rejects(()=>f.api.authAPI(f.ctx,f.request('/auth/recovery-links',{member_id:ids.sales}),'/auth/recovery-links'),error=>error.status===403);
 assert(!f.calls.some(call=>call.kind==='provider-client'||call.kind==='provider-user'||call.kind==='provider-link'));
 const own=(await asUser(db,ids.sales,()=>db.query('select user_id from nam_memberships'),{aal:'aal1'})).rows;assert.equal(own.length,1);assert.equal(own[0].user_id,ids.sales);
});

test('directory preserves optional-MFA and the original managed-session boundary',async()=>{
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);
 try{
  await assert.rejects(rpc(ids.founder,'nam_member_directory',[ids.w]),error=>error.code==='42501');
  assert((await rpc(ids.founder,'nam_member_directory',[ids.w],{aal:'aal2'})).rows.length>0);
 }finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
 for(const sessionId of [null,ids.sales])await assert.rejects(rpc(ids.founder,'nam_member_directory',[ids.w],{aal:'aal1',sessionId}),error=>error.code==='42501');
 await db.query('delete from auth.sessions where id=$1',[ids.founder]);
 try{
  await assert.rejects(rpc(ids.founder,'nam_member_directory',[ids.w]),error=>error.code==='42501');
  const f=await fixture();await assert.rejects(()=>f.api.authAPI(f.ctx,f.request('/auth/members'),'/auth/members'),error=>error.status===403&&error.code==='FOUNDER_REQUIRED');
  assert(!f.calls.some(call=>call.kind==='provider-client'||call.kind==='provider-user'));
 }finally{await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.founder]);}
});

test('suspended members remain discoverable for restore without changing their identity or role',async()=>{
 const before=(await rpc(ids.founder,'nam_member_directory',[ids.w])).rows.find(row=>row.user_id===ids.suspended);assert.equal(before.active,false);
 await rpc(ids.founder,'nam_set_member_active',[ids.w,ids.suspended,true]);
 try{
  const restored=(await rpc(ids.founder,'nam_member_directory',[ids.w])).rows.find(row=>row.user_id===ids.suspended);assert.equal(restored.active,true);assert.equal(restored.role,before.role);assert.equal(restored.name,before.name);
  assert.equal((await asUser(db,ids.suspended,()=>db.query('select nam_role($1) as role',[ids.w]),{aal:'aal1'})).rows[0].role,'sales');
 }finally{await rpc(ids.founder,'nam_set_member_active',[ids.w,ids.suspended,false]);}
 assert.equal((await rpc(ids.founder,'nam_member_directory',[ids.w])).rows.find(row=>row.user_id===ids.suspended).active,false);
});

test('recovery reads active membership through caller RLS before privileged provider account/link work',async()=>{
 const f=await fixture(),response=await f.api.authAPI(f.ctx,f.request('/auth/recovery-links',{member_id:ids.sales}),'/auth/recovery-links');
 assert.equal(response.status,201);const url=new URL((await response.json()).url);assert.equal(url.origin,env.NAM_APP_ORIGIN);assert.equal(url.searchParams.get('type'),'recovery');
 assert(f.calls.some(call=>call.kind==='caller-read'&&call.table==='nam_memberships'));assert(!f.calls.some(call=>call.kind==='admin-read'));assert.equal(f.calls.filter(call=>call.kind==='provider-user').length,1);assert.equal(f.calls.filter(call=>call.kind==='provider-link').length,1);
 for(const target of [ids.suspended,ids.outsider]){
  const denied=await fixture();await assert.rejects(()=>denied.api.authAPI(denied.ctx,denied.request('/auth/recovery-links',{member_id:target}),'/auth/recovery-links'),error=>error.status===404);
  assert(!denied.calls.some(call=>call.kind==='provider-client'||call.kind==='provider-user'||call.kind==='provider-link'));
 }
});
