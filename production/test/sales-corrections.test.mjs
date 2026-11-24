import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,asUser,ids} from './database.mjs';
import {withVerifiedFactor} from './optional-mfa.mjs';

async function rpc(db,name,args){const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query('select to_jsonb(public.'+name+'('+placeholders+')) as result',args)).rows[0].result;}
test('sales target corrections preserve ownership, revisions and before/after history',async()=>{
 const db=await database();try{
 const input={owner_id:ids.sales,metric:'Meetings held',period:'2026-11',target:5};
 const first=await asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,input]));assert.equal(first.version,1);
 await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,target:8}])),e=>e.code==='40001');
 const changed=await asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,target:8,expectedVersion:1}]),{aal:'aal1'});assert.equal(changed.version,2);assert.equal(changed.id,first.id);assert.equal(changed.created_by,ids.founder);
 await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,target:99,expectedVersion:1}])),e=>e.code==='40001');
 const same=await asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,target:8,expectedVersion:2}]));assert.equal(same.version,2);
 const rows=await asUser(db,ids.sales,()=>db.query('select id,target,version from nam_sales_targets'));assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].target,8);
 const events=await asUser(db,ids.founder,()=>db.query('select details,actor_id from nam_sales_events where record_id=$1 order by id',[first.id]));assert.equal(events.rows.length,2);assert.deepEqual(events.rows.map(e=>[e.details.before,e.details.after,e.details.version]),[[null,5,1],[5,8,2]]);assert(events.rows.every(e=>e.actor_id===ids.founder));
 await withVerifiedFactor(db,ids.founder,()=>assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,target:9,expectedVersion:2}]),{aal:'aal1'}),e=>e.code==='42501'));
 for(const [user,options] of [[ids.sales,{}],[ids.artist,{}],[ids.outsider,{}]])await assert.rejects(asUser(db,user,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,target:9,expectedVersion:2}]),options),e=>e.code==='42501');
 for(const change of [{target:0},{target:-1},{target:1.5},{owner_id:ids.artist},{owner_id:ids.suspended},{expectedVersion:null},{period:'2026-00'}])await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,...change}])));
 await assert.rejects(asUser(db,ids.founder,()=>rpc(db,'nam_set_sales_target',[ids.w,{...input,period:'2026-12',expectedVersion:1}])),e=>e.code==='40001');
 assert.equal((await asUser(db,ids.artist,()=>db.query('select id from nam_sales_targets'))).rows.length,0);
 }finally{await db.close();}
});

test('manual activity correction and deletion retain trusted audit attribution and deny stale edits',async()=>{
 const db=await database();try{
 const input={type:'Reply',context:'Fixture',outcome:'Follow up',note:'',occurred_on:'2026-11-24'};
 const first=await asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,null,null,input,'correction-fixture']));
 const edited=await asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,first.id,1,{type:'Meeting held',context:'Updated context',outcome:'Booked',note:'New notes',occurred_on:'2026-11-25'},null]));assert.equal(edited.owner_id,ids.sales);assert.equal(edited.version,2);assert.equal(edited.occurred_on,'2026-11-25');assert.equal(edited.note,'New notes');
 await assert.rejects(asUser(db,ids.artist,()=>rpc(db,'nam_save_sales_activity',[ids.w,first.id,2,{note:'Unauthorized'},null])),e=>e.code==='42501');
 await assert.rejects(asUser(db,ids.outsider,()=>rpc(db,'nam_save_sales_activity',[ids.w,first.id,2,{note:'Other workspace'},null])),e=>e.code==='42501');
 await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,first.id,1,{deleted:true},null])),e=>e.code==='40001');
 const removed=await asUser(db,ids.founder,()=>rpc(db,'nam_save_sales_activity',[ids.w,first.id,2,{deleted:true},null]));assert(removed.deleted_at);assert.equal(removed.version,3);
 assert.equal((await asUser(db,ids.sales,()=>db.query('select id from nam_sales_activities'))).rows.length,0);
 const events=await asUser(db,ids.sales,()=>db.query('select kind,actor_id from nam_sales_events where record_id=$1 order by id',[first.id]));assert.deepEqual(events.rows.map(e=>e.kind),['activity_created','activity_updated','activity_deleted']);assert.equal(events.rows.at(-1).actor_id,ids.founder);
 await assert.rejects(asUser(db,ids.sales,()=>rpc(db,'nam_save_sales_activity',[ids.w,first.id,3,{note:'Resurrect'},null])),e=>e.code==='42501');
 }finally{await db.close();}
});
