import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {asUser,ids} from '../database.mjs';

// Isolated test transport: PostgreSQL/RLS is real; managed provider HTTP and
// identity are fixtures. It never connects to the owner's Supabase project.
const root=fileURLToPath(new URL('../../',import.meta.url));
const requirePackage=createRequire(new URL('../../package.json',import.meta.url));
const queues=new WeakMap();
export function serial(db,run){const pending=(queues.get(db)||Promise.resolve()).then(run,run);queues.set(db,pending.catch(()=>{}));return pending;}
const quote=name=>{if(!/^[a-z_][a-z0-9_]*$/.test(name))throw Error('Invalid SQL test identifier');return '"'+name+'"';};

export function client(db,user,{aal='aal1',role='authenticated',storage}={}){
 const execute=run=>serial(db,()=>asUser(db,user,run,{aal,role}));
 const api={
  storage,
  auth:{
   async getUser(){const result=await serial(db,()=>db.query('select id,email,email_confirmed_at,banned_until from auth.users where id=$1',[user]));const found=result.rows[0];return {data:{user:found?.email_confirmed_at&&(!found.banned_until||new Date(found.banned_until)<=new Date())?found:null},error:null};},
   async getClaims(){return {data:{claims:{sub:user,session_id:user,aal}},error:null};},
   async getSession(){return {data:{session:{user:{id:user},access_token:'isolated-fixture-not-a-provider-credential'}},error:null};},
   mfa:{async listFactors(){const result=await serial(db,()=>db.query('select id,status from auth.mfa_factors where user_id=$1',[user]));return {data:{all:result.rows.map(f=>({...f,factor_type:'totp'}))},error:null};}},
  },
  async rpc(name,args={}){try{quote(name);const keys=Object.keys(args),values=keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);const result=await execute(()=>db.query(`select to_jsonb(public.${quote(name)}(${keys.map((key,i)=>quote(key)+' => $'+(i+1)).join(',')})) as data`,values));return {data:result.rows[0].data,error:null};}catch(error){return {data:null,error};}},
  from(table){quote(table);const query={columns:'*',filters:[],order:[],limit:null,offset:0,single:false,count:false};
   const compare=(column,operator,value)=>{query.filters.push({column:quote(column),operator,value});return builder;};
   const builder={
    select(columns='*',options={}){query.columns=columns==='*'?'*':columns.split(',').map(quote).join(',');query.count=options.count==='exact';return this;},
    eq:(column,value)=>compare(column,'=',value),neq:(column,value)=>compare(column,'<>',value),
    gt:(column,value)=>compare(column,'>',value),gte:(column,value)=>compare(column,'>=',value),lt:(column,value)=>compare(column,'<',value),lte:(column,value)=>compare(column,'<=',value),
    is(column,value){if(value!==null)throw Error('Unsupported test filter');query.filters.push({column:quote(column),operator:'IS NULL'});return this;},
    not(column,operator,value){if(operator!=='is'||value!==null)throw Error('Unsupported test filter');query.filters.push({column:quote(column),operator:'IS NOT NULL'});return this;},
    order(column,{ascending=true}={}){query.order.push(quote(column)+(ascending?' ASC':' DESC'));return this;},
    limit(count){if(!Number.isSafeInteger(count)||count<1||count>1000)throw Error('Unbounded test query');query.limit=count;return this;},
    range(from,to){if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to-from>=1000)throw Error('Invalid test range');query.offset=from;query.limit=to-from+1;return this;},
    maybeSingle(){query.single=true;return this;},single(){query.single=true;return this;},
    then(onValue,onError){return execute(async()=>{try{
     const params=[],filters=query.filters.map(f=>`${f.column} ${f.operator}${Object.hasOwn(f,'value')?' $'+params.push(f.value):''}`),where=filters.length?' where '+filters.join(' and '):'';
     const rows=await db.query(`select ${query.columns} from public.${quote(table)}${where}${query.order.length?' order by '+query.order.join(','):''}${query.limit?' limit '+query.limit:''}${query.offset?' offset '+query.offset:''}`,params);
     const count=query.count?(await db.query(`select count(*)::integer as n from public.${quote(table)}${where}`,params)).rows[0].n:undefined;
     return {data:query.single?rows.rows[0]||null:rows.rows,error:null,count};
    }catch(error){return {data:null,error};}}).then(onValue,onError);},
   };return builder;
  },
 };return api;
}

export async function context(db,user=ids.founder,options={}){
 const members=(await serial(db,()=>db.query('select user_id as id,name,role from nam_memberships where workspace_id=$1 and active and (user_id=$2 or $2=$3)',[ids.w,user,ids.founder]))).rows;
 const actor=members.find(m=>m.id===user);if(!actor)throw Error('No active fixture identity');
 for(const person of members)person.initials=person.name.split(' ').map(x=>x[0]).join('').slice(0,2);
 const supabase=client(db,user,options),factors=await supabase.auth.mfa.listFactors();
 return {actor,members,user:{id:user,email:user+'@isolated-test.invalid'},sessionId:user,workspaceId:ids.w,supabase,csrf:'isolated-fixture-csrf',mfa:{required:factors.data.all.some(f=>f.status==='verified'),verified:options.aal==='aal2',factors:factors.data.all}};
}

const cache=new Map();
export async function loadServerModule(relativePath){
 const file=resolve(root,relativePath);if(cache.has(file))return cache.get(file);
 const source=await readFile(file,'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const imports=new Map();
 for(const match of code.matchAll(/require\(["']([^"']+)["']\)/g)){
  const name=match[1];if(imports.has(name))continue;
  if(name==='server-only'){imports.set(name,{});continue;}
  if(name==='next/headers'){imports.set(name,{cookies:async()=>({get:()=>undefined,getAll:()=>[],set(){},delete(){}})});continue;}
  if(name.startsWith('.')||name.startsWith('@/')){
   const base=name.startsWith('@/')?resolve(root,name.slice(2)):resolve(dirname(file),name);let dependency;
   for(const extension of ['','.ts','.mjs','.js']){try{if((await stat(base+extension)).isFile()){dependency=base+extension;break;}}catch{}}
   if(!dependency)throw Error('Unknown test import '+name);
   imports.set(name,dependency.endsWith('.mjs')?await import(dependency):await loadServerModule(dependency));
  }else imports.set(name,requirePackage(name));
 }
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports.get(name),Buffer,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,ReadableStream,Date,Intl,Number,String,Map,Set,console,fetch,crypto:globalThis.crypto,process:{env:{}},setTimeout,clearTimeout},{filename:file});
 cache.set(file,module.exports);return module.exports;
}
