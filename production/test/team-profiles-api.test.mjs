import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,ids} from './database.mjs';
import {context,loadServerModule} from './support/runtime.mjs';
import {withVerifiedFactor} from './optional-mfa.mjs';

const {dispatchTeamProfiles}=await loadServerModule('lib/api/team-profiles.ts');
function request(path,method='GET',input,key='team-api-stable-request'){
 return new Request('https://nam.example/api/'+path,{method,...(input?{headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(input)}:{})});
}
const dispatch=(ctx,path,method='GET',input,key)=>dispatchTeamProfiles(ctx,path.split('/'),request(path,method,input,key));

test('team API reads and saves through the current user RPC, with CAS and exact retry',async t=>{
 const db=await database();t.after(()=>db.close());const ctx=await context(db,ids.sales,{aal:'aal2'});
 await db.query('delete from nam_section_grants where workspace_id=$1 and user_id=$2',[ids.w,ids.sales]);
 let response=await dispatch(ctx,'team/profile');assert.equal(response.headers.get('Cache-Control'),'private, no-store');const profile=await response.json();assert.equal(profile.id,ids.sales);assert.equal(profile.revision,0);
 const body={expectedRevision:0,changes:{name:'Sales colleague',job_title:'Account manager'}};
 response=await dispatch(ctx,'team/profile','PATCH',body);const saved=await response.json();assert.equal(saved.revision,1);assert.equal(saved.job_title,'Account manager');
 assert.deepEqual(await (await dispatch(ctx,'team/profile','PATCH',body)).json(),saved);
 assert.equal((await db.query('select count(*)::int as n from nam_team_events')).rows[0].n,1);
 await assert.rejects(dispatch(ctx,'team/preferences','PATCH',{expectedRevision:0,changes:{assignment:true,due:false,overdue:true}},'new-preferences-key'),e=>e.status===409&&e.code==='TEAM_CONFLICT');
 assert.equal((await db.query('select count(*)::int as n from nam_section_grants where user_id=$1',[ids.sales])).rows[0].n,0);
});

test('team API rejects unsupported fields/events, forged targets, malformed filters and missing retry keys',async t=>{
 const db=await database();t.after(()=>db.close());const ctx=await context(db,ids.sales,{aal:'aal2'}),founder=await context(db,ids.founder,{aal:'aal2'});
 for(const changes of [{name:'Name',job_title:'',role:'founder'},{name:'Name',job_title:'',department_id:ids.w},{name:'Name',job_title:'',phone:'personal'},{name:'Line\nbreak',job_title:''}])await assert.rejects(dispatch(ctx,'team/profile','PATCH',{expectedRevision:0,changes}),e=>e.status===400);
 for(const changes of [{assignment:true,due:true,overdue:true,email:true},{assignment:'true',due:true,overdue:true},{assignment:true,due:true}])await assert.rejects(dispatch(ctx,'team/preferences','PATCH',{expectedRevision:0,changes}),e=>e.status===400);
 await assert.rejects(dispatch(ctx,'team/profile','PATCH',{expectedRevision:0,target_id:ids.founder,changes:{name:'Name',job_title:''}}),e=>e.status===400);
 await assert.rejects(dispatch(ctx,'team/profile','PATCH',{expectedRevision:'0',changes:{name:'Name',job_title:''}}),e=>e.status===400);
 const missingKey=request('team/profile','PATCH',{expectedRevision:0,changes:{name:'Name',job_title:''}});missingKey.headers.delete('Idempotency-Key');await assert.rejects(dispatchTeamProfiles(ctx,['team','profile'],missingKey),e=>e.status===400);
 for(const path of ['team/directory?page=0','team/directory?page=1&page=2','team/directory?search='+('x'.repeat(101)),'team/departments?archived=true','team/profile?role=founder']){
  const [base]=path.split('?');await assert.rejects(dispatchTeamProfiles(founder,base.split('/'),request(path)),e=>e.status===400);
 }
 await assert.rejects(dispatch(founder,'team/members/forged-id/department','PATCH',{expectedRevision:0,changes:{department_id:null}}),e=>e.status===400);
 assert.equal((await db.query('select count(*)::int as n from nam_team_events')).rows[0].n,0);
 assert.equal(await dispatch(ctx,'sales/activities'),null);
});

test('Founder metadata routes enforce live authority and do not replace existing invitation/access controls',async t=>{
 const db=await database();t.after(()=>db.close());const sales=await context(db,ids.sales,{aal:'aal2'}),founder=await context(db,ids.founder,{aal:'aal2'});
 for(const path of ['team/directory','team/departments'])await assert.rejects(dispatch(sales,path),e=>e.status===403);
 assert.equal((await dispatch(await context(db,ids.founder,{aal:'aal1'}),'team/directory')).status,200);
 await withVerifiedFactor(db,ids.founder,async()=>{await assert.rejects(dispatch(await context(db,ids.founder,{aal:'aal1'}),'team/directory'),e=>e.status===403);});
 const created=await (await dispatch(founder,'team/departments','POST',{changes:{name:'Sales',archived:false}},'create-department-api')).json();
 const member=await (await dispatch(founder,'team/members/'+ids.sales+'/department','PATCH',{expectedRevision:0,changes:{department_id:created.id}},'assign-department-api')).json();assert.equal(member.department.id,created.id);
 const page=await (await dispatch(founder,'team/directory')).json();assert(page.items.some(row=>row.id===ids.sales&&row.department.name==='Sales'));assert(page.items.every(row=>!('notifications' in row)));
 const access=(await db.query('select role,active from nam_memberships where workspace_id=$1 and user_id=$2',[ids.w,ids.sales])).rows[0];assert.deepEqual(access,{role:'sales',active:true});
 await assert.rejects(dispatch(founder,'team/departments','DELETE'),e=>e.status===405);
});

test('slow team request bodies cannot carry a revoked session into a metadata mutation',async t=>{
 const db=await database();t.after(()=>db.close());const ctx=await context(db,ids.sales,{aal:'aal2'});let stream;
 const body=new ReadableStream({start(controller){stream=controller;}}),request=new Request('https://nam.example/api/team/preferences',{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':'revoked-team-body'},body,duplex:'half'});
 const pending=dispatchTeamProfiles(ctx,['team','preferences'],request);await Promise.resolve();await db.query('delete from auth.sessions where id=$1',[ids.sales]);
 stream.enqueue(new TextEncoder().encode(JSON.stringify({expectedRevision:0,changes:{assignment:false,due:false,overdue:false}})));stream.close();await assert.rejects(pending,e=>e.status===403);
 assert.equal((await db.query('select count(*)::int as n from nam_member_profiles')).rows[0].n,0);assert.equal((await db.query('select count(*)::int as n from nam_team_events')).rows[0].n,0);
});
