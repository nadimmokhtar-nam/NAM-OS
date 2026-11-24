-- Disposable Supabase database only; run after migrations. Real authenticated
-- identities exercise RLS/RPC paths; all fixtures are rolled back.
begin;
set local search_path=public,extensions;
select plan(16);
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','founder@nam-test.invalid'),
 ('10000000-0000-0000-0000-000000000002','sales@nam-test.invalid'),
 ('10000000-0000-0000-0000-000000000003','artist@nam-test.invalid');
insert into public.nam_workspaces(id,name) values('20000000-0000-0000-0000-000000000001','Test studio'),('20000000-0000-0000-0000-000000000002','Other studio');
insert into public.nam_memberships(workspace_id,user_id,name,role) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Founder','founder'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Sales','sales'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','Artist','freelancer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select lives_ok($q$select public.nam_create_task('20000000-0000-0000-0000-000000000001','{"title":"Sales follow-up","section":"sales","owner_id":"10000000-0000-0000-0000-000000000002"}','create-test-key')$q$,'Founder can assign eligible sales task');
select lives_ok($q$select public.nam_create_task('20000000-0000-0000-0000-000000000001','{"title":"Sales follow-up","section":"sales","owner_id":"10000000-0000-0000-0000-000000000002"}','create-test-key')$q$,'Retry same request safely');
select is((select count(*)::integer from public.nam_tasks),1,'Retry creates one task');
select throws_ok($q$select public.nam_create_task('20000000-0000-0000-0000-000000000001','{"title":"Different request","section":"sales"}','create-test-key')$q$,'40001',null,'Retry key conflict rejected');
select throws_ok($q$select public.nam_create_task('20000000-0000-0000-0000-000000000002','{"title":"Cross workspace","section":"sales"}',null)$q$,'42501',null,'Cannot create across workspace');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::integer from public.nam_tasks),0,'Freelancer cannot read sales task');
select throws_ok($q$select public.nam_create_task('20000000-0000-0000-0000-000000000001','{"title":"Sales work","section":"sales"}',null)$q$,'42501',null,'Freelancer cannot create sales work');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::integer from public.nam_tasks),1,'Sales sees own task');
select is((select count(*)::integer from public.nam_notifications),1,'Assignment notification belongs to sales');
select lives_ok($q$select public.nam_task_action('20000000-0000-0000-0000-000000000001',(select id from public.nam_tasks limit 1),'subtask','{"title":"Prepare notes"}')$q$,'Owner adds subtask');
select throws_ok($q$select public.nam_save_task('20000000-0000-0000-0000-000000000001',(select id from public.nam_tasks limit 1),1,'{"status":"Done"}')$q$,'40001',null,'Open subtasks require explicit parent confirmation');
select lives_ok($q$select public.nam_save_task('20000000-0000-0000-0000-000000000001',(select id from public.nam_tasks limit 1),1,'{"status":"Done","confirmOpenSubtasks":true}')$q$,'Explicit parent confirmation works');
select throws_ok($q$select public.nam_save_task('20000000-0000-0000-0000-000000000001',(select id from public.nam_tasks limit 1),1,'{"status":"Todo"}')$q$,'40001',null,'Stale edits cannot overwrite completed task');
select throws_ok($q$select public.nam_save_task('20000000-0000-0000-0000-000000000001',(select id from public.nam_tasks limit 1),2,'{"owner_id":"10000000-0000-0000-0000-000000000001"}')$q$,'42501',null,'Representative cannot reassign to founder');
select throws_ok($q$update public.nam_memberships set role='founder'$q$,'42501',null,'Direct role escalation denied');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::integer from public.nam_tasks),0,'Founder without MFA cannot read team task');
select * from finish();
rollback;
