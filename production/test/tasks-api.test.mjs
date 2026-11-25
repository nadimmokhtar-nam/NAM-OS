import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {isProductionStage} from '../public/production-stages.js';
import {ApiError,readJSON} from '../lib/api/security-helpers.ts';
import {database,asUser,ids} from './database.mjs';

// Runs the real TypeScript task dispatcher against actual PostgreSQL columns,
// RPCs and RLS. This boundary adapter translates select/filter/order calls into
// parameterized SQL; it does not fabricate response objects or accept unknown
// columns. Hosted PostgREST transport and provider authentication remain gates.
let db,dispatch,queue=Promise.resolve();
const serial=fn=>{const result=queue.then(fn,fn);queue=result.catch(()=>{});return result;};
before(async()=>{
 db=await database();const source=await readFile(new URL('../lib/api/tasks.ts',import.meta.url),'utf8'),js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
 vm.runInNewContext(js,{exports:module.exports,require:name=>{if(name==='../../public/production-stages.js')return {isProductionStage};assert.equal(name,'./context');return {ApiError,readJSON,json:(data,status=200)=>Response.json(data,{status})};},URL,URLSearchParams,Request,Response,Date,Number,String,Set,Map},{filename:'tasks.ts'});dispatch=module.exports.dispatchTasks;
});
after(async()=>{await db?.close();});
const identifier=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return `"${value}"`;};
function context(user=ids.founder,{aal='aal2',workspace=ids.w}={}){
 const role=user===ids.founder?'founder':user===ids.artist?'freelancer':'sales',execute=fn=>serial(()=>asUser(db,user,fn,{aal}));
 return {user:{id:user},sessionId:user,actor:{id:user,name:role,initials:'T',role},workspaceId:workspace,members:[{id:ids.founder,name:'Founder',initials:'F',role:'founder'},{id:ids.sales,name:'Sales',initials:'S',role:'sales'},{id:ids.artist,name:'Freelancer',initials:'A',role:'freelancer'}],csrf:'test-context',mfa:{verified:aal==='aal2',required:false},supabase:{
  async rpc(name,args){try{assert.match(name,/^nam_[a-z_]+$/);const keys=Object.keys(args),result=await execute(()=>db.query(`SELECT to_jsonb(public.${name}(${keys.map((key,i)=>`${identifier(key)} => $${i+1}`).join(',')})) AS data`,keys.map(key=>typeof args[key]==='object'&&args[key]!==null?JSON.stringify(args[key]):args[key])));return {data:result.rows[0].data,error:null};}catch(error){return {data:null,error};}},
  from(table){identifier(table);const query={columns:'*',filters:[],order:[],limit:null,single:false};const builder={
   select(columns){query.columns=columns==='*'?'*':columns.split(',').map(identifier).join(',');return this;},
   eq(column,value){query.filters.push({column:identifier(column),operator:'=',value});return this;},
   neq(column,value){query.filters.push({column:identifier(column),operator:'<>',value});return this;},
   is(column,value){assert.equal(value,null);query.filters.push({column:identifier(column),operator:'IS NULL'});return this;},
   not(column,operator,value){assert.equal(operator,'is');assert.equal(value,null);query.filters.push({column:identifier(column),operator:'IS NOT NULL'});return this;},
   order(column,{ascending=true}={}){query.order.push(`${identifier(column)} ${ascending?'ASC':'DESC'}`);return this;},
   limit(maximum){assert(Number.isSafeInteger(maximum)&&maximum>0&&maximum<=1000);query.limit=maximum;return this;},maybeSingle(){query.single=true;return this;},
   then(resolve,reject){return execute(async()=>{try{const params=[],where=query.filters.map(filter=>`${filter.column} ${filter.operator}${Object.hasOwn(filter,'value')?' $'+params.push(filter.value):''}`),sql=`SELECT ${query.columns} FROM public.${identifier(table)}${where.length?' WHERE '+where.join(' AND '):''}${query.order.length?' ORDER BY '+query.order.join(','):''}${query.limit?' LIMIT '+query.limit:''}`,result=await db.query(sql,params);return {data:query.single?result.rows[0]||null:result.rows,error:null};}catch(error){return {data:null,error};}}).then(resolve,reject);}
  };return builder;}
 }};
}
const request=(path,method='GET',body,headers={})=>new Request('https://nam.example/api/'+path,{method,...(body!==undefined?{headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}:{headers})});
async function call(ctx,path,method='GET',body,headers){const result=await dispatch(ctx,path.split('?')[0].split('/'),request(path,method,body,headers));assert(result);return {status:result.status,body:await result.json()};}
async function assigned(title='Task API workflow'){return (await call(context(),'tasks','POST',{title,description:'A real schema-backed task',section:'sales',owner_id:ids.sales,priority:'High'}, {'Idempotency-Key':'api-'+title.replaceAll(' ','-')})).body;}

test('production task dispatcher creates, reads, edits and comments through actual PostgreSQL schema',async()=>{
 const task=await assigned(),sales=context(ids.sales);assert(task.id);assert.equal(task.owner_name,'Sales');assert.deepEqual(task.attachments,[]);let result=await call(sales,`tasks/${task.id}`);assert.equal(result.status,200);assert.equal(result.body.description,'A real schema-backed task');
 result=await call(sales,`tasks/${task.id}`,'PATCH',{expectedVersion:task.version,changes:{status:'In progress',description:'Updated through the actual RPC'}});assert.equal(result.body.status,'In progress');assert.equal(result.body.version,task.version+1);assert.equal(result.body.description,'Updated through the actual RPC');
 result=await call(sales,`tasks/${task.id}/comments`,'POST',{body:'A decision attributed by PostgreSQL'});assert.equal(result.status,201);assert.equal(result.body.comments[0].body,'A decision attributed by PostgreSQL');assert.equal(result.body.comments[0].author_id,ids.sales);assert.equal(result.body.comments[0].author_name,'Sales');assert(result.body.events.some(e=>e.actor_id===ids.sales));
 await assert.rejects(()=>call(sales,`tasks/${task.id}`,'PATCH',{expectedVersion:task.version,changes:{title:'Stale overwrite'}}),error=>error.status===409);
});
test('attachment byte_size is translated to size without losing pending or cleanup metadata',async()=>{
 const task=await assigned('Attachment DTO task');const rows=[];
 // Seed actual physical metadata states as the trusted fixture owner. Storage
 // byte validation/attestation is exercised by the separate operations suite.
 for(const [index,status,cleanup]of [[1,'ready',false],[2,'pending',false],[3,'deleting',true],[4,'deleted',false]]){
  const result=await db.query(`INSERT INTO public.nam_task_attachments(workspace_id,task_id,name,mime,byte_size,sha256,storage_path,status,created_by,cleanup_error,attested_at,attested_by,deleted_at) VALUES($1,$2,$3,'text/plain',$4,$5,$6,$7,$8,$9,CASE WHEN $7='ready' THEN now() END,CASE WHEN $7='ready' THEN $8::uuid END,CASE WHEN $7='deleted' THEN now() END) RETURNING id`,[ids.w,task.id,`state-${status}.txt`,index*123,String(index).repeat(64),`${ids.w}/fixture/state-${index}.txt`,status,ids.sales,cleanup]);rows.push({id:result.rows[0].id,status,size:index*123,cleanup});
 }
 const result=await call(context(ids.sales),`tasks/${task.id}`);assert.equal(result.status,200);assert.equal(result.body.attachments.length,3);
 for(const expected of rows.filter(row=>row.status!=='deleted')){const dto=result.body.attachments.find(file=>file.id===expected.id);assert(dto);assert.equal(dto.size,expected.size);assert.equal(dto.status,expected.status);assert.equal(dto.cleanupPending,expected.status!=='ready'||expected.cleanup);assert(!Object.hasOwn(dto,'byte_size'));assert(!Object.hasOwn(dto,'storage_path'));assert(!Object.hasOwn(dto,'workspace_id'));assert(!Object.hasOwn(dto,'attested_by'));}
 const columnCanary=await context(ids.sales).supabase.from('nam_task_attachments').select('id,size').eq('task_id',task.id);assert.equal(columnCanary.error?.code,'42703','the query adapter must let PostgreSQL reject nonexistent columns');
});
test('task detail and attachment metadata remain denied to unauthorized identities and workspaces',async()=>{
 const task=await assigned('Private API task');for(const user of [ids.artist,ids.outsider,ids.suspended])await assert.rejects(()=>call(context(user),`tasks/${task.id}`),error=>error.status===404);assert.equal((await call(context(ids.founder,{aal:'aal1'}),`tasks/${task.id}`)).status,200);const factor='30000000-0000-4000-8000-000000000077';await db.query('INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,$3)',[factor,ids.founder,'verified']);try{await assert.rejects(()=>call(context(ids.founder,{aal:'aal1'}),`tasks/${task.id}`),error=>error.status===404);}finally{await db.query('DELETE FROM auth.mfa_factors WHERE id=$1',[factor]);}await assert.rejects(()=>call(context(ids.founder,{workspace:ids.otherW}),`tasks/${task.id}`),error=>error.status===404);
});
test('task list, subtask completion and notification DTOs execute their real selected columns',async()=>{
 const task=await assigned('Detail child record task'),sales=context(ids.sales);let detail=(await call(sales,`tasks/${task.id}/subtasks`,'POST',{title:'Prepare the review'})).body;assert.equal(detail.subtasks.length,1);await assert.rejects(()=>call(sales,`tasks/${task.id}`,'PATCH',{expectedVersion:detail.version,changes:{status:'Done'}}),error=>error.status===409);
 detail=(await call(sales,`tasks/${task.id}/subtasks`,'POST',{id:detail.subtasks[0].id,completed:true})).body;detail=(await call(sales,`tasks/${task.id}`,'PATCH',{expectedVersion:detail.version,changes:{status:'Done'}})).body;assert.equal(detail.status,'Done');assert.equal(detail.subtasks[0].completed,true);
 const page=(await call(sales,'tasks?page=1&page_size=10&search=Detail%20child')).body;assert.equal(page.total,1);assert.equal(page.items[0].id,task.id);const notifications=(await call(sales,'notifications')).body;assert(notifications.some(n=>n.task_id===task.id));
});
test('deleted-record list selects real schema fields and founder restoration returns usable detail',async()=>{
 const task=await assigned('Deleted detail API task'),founder=context(),sales=context(ids.sales);const deleted=await call(founder,`tasks/${task.id}`,'DELETE',{expectedVersion:task.version});assert.equal(deleted.body.ok,true);await assert.rejects(()=>call(sales,`tasks/${task.id}`),error=>error.status===404);await assert.rejects(()=>call(sales,'tasks/deleted'),error=>error.status===403);
 const records=(await call(founder,'tasks/deleted')).body;assert(records.some(t=>t.id===task.id&&t.deleted_at&&t.number));const restored=(await call(founder,`tasks/${task.id}/restore`,'POST',{})).body;assert.equal(restored.id,task.id);assert.equal(restored.deleted_at,null);assert(Array.isArray(restored.attachments));assert.equal((await call(sales,`tasks/${task.id}`)).body.title,'Deleted detail API task');
});
