import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function fixture({confirmed=false,missing=false,banned=false,providerError=false}={}){
 const calls=[],uid='30000000-0000-4000-8000-000000000001',email='client@email-test.invalid';
 const service={rpc:async(name,args)=>{assert.equal(name,'nam_client_account_for_email');assert.equal(args.address,email);return {data:missing?null:uid,error:null};},auth:{admin:{getUserById:async id=>{assert.equal(id,uid);return {data:{user:{id:uid,email,email_confirmed_at:confirmed?'2026-11-25T10:00:00Z':null,banned_until:banned?'2099-01-01T00:00:00Z':null}},error:null};}}}};
 const provider={auth:Object.fromEntries(['resend','signInWithOtp'].map(method=>[method,async input=>{calls.push([method,JSON.parse(JSON.stringify(input))]);return {error:providerError?{message:'private provider diagnostic'}:null};}]))};
 const source=await readFile(new URL('../lib/api/client-review-auth.ts',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
 vm.runInNewContext(code,{URL,Date,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://provider.email-test.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'private-test'}},module,exports:module.exports,require(name){
  if(name==='@supabase/supabase-js')return {createClient:(url,key)=>key==='private-test'?service:provider};
  if(['server-only','next/headers','@/lib/supabase/server','./client-context','./context'].includes(name))return {};
  throw Error('Unexpected dependency '+name);
 }});
 return {calls,send:()=>module.exports.sendClientSignIn(email,'https://nam.email-test.invalid')};
}

test('a provisioned unconfirmed client receives confirmation without enabling signup or auto-confirming an email',async()=>{
 const f=await fixture();assert.equal(await f.send(),true);assert.deepEqual(f.calls,[['resend',{type:'signup',email:'client@email-test.invalid',options:{emailRedirectTo:'https://nam.email-test.invalid/review'}}]]);
});
test('a returning confirmed client receives a sign-in link that cannot create another account',async()=>{
 const f=await fixture({confirmed:true});assert.equal(await f.send(),true);assert.deepEqual(f.calls,[['signInWithOtp',{email:'client@email-test.invalid',options:{emailRedirectTo:'https://nam.email-test.invalid/review',shouldCreateUser:false}}]]);
});
test('missing or banned client identities receive no provider email request',async()=>{
 for(const options of [{missing:true},{banned:true}]){const f=await fixture(options);assert.equal(await f.send(),false);assert.equal(f.calls.length,0);}
});
test('provider delivery failures remain unconfirmed without returning the private provider diagnostic',async()=>{
 const f=await fixture({providerError:true});assert.equal(await f.send(),false);assert.equal(f.calls.length,1);
});
