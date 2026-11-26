import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {profiles} from './support.mjs';

function literal(value){return "'"+String(value).replaceAll("'","''")+"'";}
function psql(sql){const result=spawnSync('docker',['--host=unix:///var/run/docker.sock','exec','-i','supabase_db_nam-os-qa','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:sql,encoding:'utf8'});if(result.status!==0)throw Error('The disposable local load fixture could not be prepared or cleaned. No hosted database was contacted.');}
export async function loadFixture(){
 const fixture=await profiles(),marker='[QA load '+randomUUID()+']',founder=fixture.users.find(u=>u.key==='founder');
 const owners=fixture.users.map((user,i)=>`(${i},${literal(user.id)}::uuid,${literal(['sales','sales_manager'].includes(user.role)?'sales':user.role==='founder'?'team':'projects')})`).join(',');
 psql(`insert into public.nam_tasks(workspace_id,title,description,section,status,owner_id,created_by)
 select ${literal(fixture.workspace)}::uuid,${literal(marker)}||' Task '||n,repeat('Synthetic context. ',57),o.section,'Todo',o.id,${literal(founder.id)}::uuid
 from generate_series(1,10000) n join (values ${owners}) o(i,id,section) on o.i=(n-1)%8;`);
 return {marker,async cleanup(){psql(`update public.nam_tasks set deleted_at=now(),updated_at=now() where workspace_id=${literal(fixture.workspace)}::uuid and created_by=${literal(founder.id)}::uuid and position(${literal(marker)} in title)=1 and deleted_at is null;`);}};
}
