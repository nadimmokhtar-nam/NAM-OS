import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function fixture(path,{failProvider=false}={}){
 let calls=0,forwarded;const jar=new Map(),source=await readFile(new URL('../proxy.ts',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Buffer,URL,Headers,crypto:globalThis.crypto,process:{env:{NODE_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://isolated.example.test',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-public-identifier',NAM_APP_ORIGIN:'https://nam.example.test'}},require(name){
  if(name==='next/server')return {NextResponse:{next({request}){forwarded=request.headers;const response=new Response(null);response.cookies={set:(name,value,options)=>jar.set(name,{value,options})};return response;}}};
  if(name==='@supabase/ssr')return {createServerClient(url,key,options){return {auth:{async getClaims(){calls++;if(failProvider)throw Error('Isolated provider unavailable');options.cookies.setAll([{name:'session',value:'synthetic-cookie',options:{}}]);}}};}};
  if(name==='./lib/api/security-helpers')return {expectedOrigin:value=>value};throw Error(name);
 }});
 const url=new URL('https://nam.example.test'+path),request={url:url.href,nextUrl:url,headers:new Headers(),cookies:{getAll:()=>[],set(){}}};
 const response=await module.exports.proxy(request);return {calls,response,jar,forwarded};
}
test('public modules, fonts and release metadata keep security headers without contacting Auth',async()=>{
 for(const path of ['/app.js','/academy-video.js','/fonts/inter-latin-wght-normal.woff2','/manifest.webmanifest','/app-version.json']){
  const {calls,response,forwarded}=await fixture(path,{failProvider:true});assert.equal(calls,0);assert.match(response.headers.get('content-security-policy'),/'nonce-[^']+'/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');assert(forwarded.get('x-nonce'));
 }
});
test('pages and API routes still refresh sessions with HttpOnly same-site cookies',async()=>{
 for(const path of ['/workspace','/login','/api/bootstrap','/api/tasks/file.js']){const result=await fixture(path);assert.equal(result.calls,1);assert.equal(result.jar.get('session').options.httpOnly,true);assert.equal(result.jar.get('session').options.sameSite,'lax');assert.equal(result.jar.get('session').options.secure,true);}
});
