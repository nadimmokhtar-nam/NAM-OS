import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,ids} from './database.mjs';
const template=await readFile(new URL('../supabase/bootstrap-owner.sql',import.meta.url),'utf8');
const configured=email=>template.replace('00000000-0000-0000-0000-000000000000',ids.founder).replace('REPLACE_WITH_CONFIRMED_OWNER_EMAIL',email);
async function reject(db,sql,pattern){await assert.rejects(db.exec(sql),pattern);await db.exec('rollback');}

test('Owner bootstrap fails closed and provisions only an existing verified identity',async()=>{const db=await database();try{
 await db.exec('truncate public.nam_workspaces cascade');
 await reject(db,template,/Replace the owner UUID\/email placeholders/);
 await reject(db,configured('wrong-owner@policy-test.invalid'),/existing confirmed, unbanned identity/);
 assert.equal((await db.query('select count(*)::integer as n from nam_workspaces')).rows[0].n,0);
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids.founder]);
 await reject(db,configured('founder@policy-test.invalid'),/existing confirmed, unbanned identity/);
 await db.query("update auth.users set email_confirmed_at=now(),banned_until=now()+interval '1 day' where id=$1",[ids.founder]);
 await reject(db,configured('founder@policy-test.invalid'),/existing confirmed, unbanned identity/);
 await db.query('update auth.users set banned_until=null where id=$1',[ids.founder]);
 await db.exec(configured('founder@policy-test.invalid'));
 const rows=(await db.query('select * from nam_memberships')).rows;assert.equal(rows.length,1);assert.equal(rows[0].user_id,ids.founder);assert.equal(rows[0].role,'founder');assert.equal(rows[0].active,true);
 assert.equal((await db.query("select count(*)::integer as n from nam_identity_events where kind='initial_owner_provisioned'")).rows[0].n,1);
 await reject(db,configured('founder@policy-test.invalid'),/Workspace already provisioned/);
 assert.equal((await db.query('select count(*)::integer as n from nam_memberships')).rows[0].n,1);
 }finally{await db.close();}});
