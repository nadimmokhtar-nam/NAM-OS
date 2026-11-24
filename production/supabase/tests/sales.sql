-- Isolated staging database only, after all migrations (including assurance007)
-- and pgTAP setup.
-- Transaction fixtures are rolled back. This file has NOT been executed here.
begin;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.nam_sales_activities'::regclass),'Activity RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.nam_integration_records'::regclass),'Connected record RLS enabled');
select ok(not has_table_privilege('anon','public.nam_sales_reports','SELECT'),'Anonymous cannot read reports');
select ok(not has_table_privilege('authenticated','public.nam_sales_targets','UPDATE'),'Targets cannot be changed directly');
select ok(not has_column_privilege('authenticated','public.nam_integration_state','lease_token','SELECT'),'Lease token is private');
select ok(not has_column_privilege('authenticated','public.nam_integration_state','credential_fingerprint','SELECT'),'Credential fingerprint is private');

insert into auth.users(id,email,aud,role) values
 ('11111111-1111-4111-8111-111111111111','founder@sales-fixture.invalid','authenticated','authenticated'),
 ('22222222-2222-4222-8222-222222222222','sales@sales-fixture.invalid','authenticated','authenticated'),
 ('33333333-3333-4333-8333-333333333333','artist@sales-fixture.invalid','authenticated','authenticated'),
 ('44444444-4444-4444-8444-444444444444','other@sales-fixture.invalid','authenticated','authenticated');
insert into public.nam_workspaces(id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sales fixture'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other fixture');
insert into public.nam_memberships(workspace_id,user_id,name,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Founder','founder'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','Sales','sales'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','Artist','artist'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','Other founder','founder');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.nam_begin_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',repeat('a',64))$$,'42501',null,'Founder AAL1 cannot manage connections');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.nam_save_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'{"type":"Research","context":"Fixture","outcome":"Reviewed","occurred_on":"2026-11-24"}','fixture-founder')$$,'Founder can record own activity');
select lives_ok($$select set_config('test.sales.lease',public.nam_begin_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',repeat('a',64))::text,true)$$,'Founder AAL2 acquires durable lease');
select throws_ok($$select public.nam_begin_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',repeat('a',64))$$,'55000',null,'Simultaneous sync cannot acquire same source');
select lives_ok($$select public.nam_finish_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',current_setting('test.sales.lease')::uuid,'[{"kind":"call","external_id":"1","external_owner_id":"14","title":"Owner fourteen"},{"kind":"call","external_id":"2","external_owner_id":"15","title":"Owner fifteen"}]','{"period":"Fixture"}','[]')$$,'Snapshot commit is accepted under its lease');
select lives_ok($$select public.nam_map_integration_owner('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall','14','22222222-2222-4222-8222-222222222222')$$,'Founder maps provider owner to sales member');
select is((select count(*)::integer from public.nam_integration_records),2,'Founder sees both mapped and unmapped records');

select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::integer from public.nam_integration_records),1,'Representative sees only explicitly mapped records');
select is((select count(*)::integer from public.nam_integration_records where external_owner_id='15'),0,'Guessing an unmapped external owner grants no access');
select is((select count(*)::integer from public.nam_sales_activities),0,'Representative cannot read founder activities');
select throws_ok($$select public.nam_begin_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','attio',repeat('b',64))$$,'42501',null,'Representative cannot sync workspace credentials');
select throws_ok($$select public.nam_map_integration_owner('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall','15','22222222-2222-4222-8222-222222222222')$$,'42501',null,'Representative cannot grant themselves another owner');
select throws_ok($$select public.nam_save_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'{"owner_id":"11111111-1111-4111-8111-111111111111","type":"Reply","context":"Fixture","outcome":"Forged","occurred_on":"2026-11-24"}','forged-owner')$$,'P0001',null,'Forged owner fields are rejected by the database');
select lives_ok($$select public.nam_save_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'{"type":"Meeting held","context":"Fixture","outcome":"Next step booked","occurred_on":"2026-11-24"}','fixture-sales')$$,'Representative can create own activity');
select lives_ok($$select public.nam_save_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'{"type":"Meeting held","context":"Fixture","outcome":"Next step booked","occurred_on":"2026-11-24"}','fixture-sales')$$,'A repeated request key reuses its record');
select is((select count(*)::integer from public.nam_sales_activities),1,'Idempotent retry did not duplicate the activity');
select lives_ok($$select public.nam_submit_sales_report('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"week_start":"2026-11-23","outcomes":"Fixture results","blockers":"","next_week":"Fixture priorities"}')$$,'Representative submits own weekly report');
select throws_ok($$select public.nam_set_sales_target('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"owner_id":"22222222-2222-4222-8222-222222222222","metric":"Outreach","period":"2026-11","target":5}')$$,'42501',null,'Representative cannot choose their own targets');

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::integer from public.nam_integration_records where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),0,'A founder in another workspace cannot read NAM connections');
select throws_ok($$select public.nam_begin_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','attio',repeat('b',64))$$,'42501',null,'Another workspace founder cannot sync NAM');

select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::integer from public.nam_integration_records),0,'Artist cannot read connected sales');
select is((select count(*)::integer from public.nam_sales_reports),0,'Artist cannot read sales reports');
select throws_ok($$select public.nam_save_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'{"type":"Research","context":"Fixture","outcome":"Denied","occurred_on":"2026-11-24"}','fixture-artist')$$,'42501',null,'Artist cannot create a sales activity');

select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select set_config('test.sales.lease',public.nam_begin_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',repeat('a',64))::text,true)$$,'A subsequent sync gets a new lease');
select throws_ok($$select public.nam_finish_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',current_setting('test.sales.lease')::uuid,'null','{}','[]')$$,'P0001',null,'Invalid snapshot cannot replace successful data');
select lives_ok($$select public.nam_fail_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',current_setting('test.sales.lease')::uuid,'unavailable','Provider unavailable',null)$$,'Provider failure is recorded');
select is((select count(*)::integer from public.nam_integration_records),2,'Failed sync retained the prior successful snapshot');
select lives_ok($$select set_config('test.sales.lease',public.nam_begin_integration_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','justcall',repeat('b',64))::text,true)$$,'Changed credentials acquire an isolated connection');
select is((select count(*)::integer from public.nam_integration_owner_map),0,'Credential change revoked previous owner grants');
select is((select count(*)::integer from public.nam_integration_records),0,'Old-credential snapshot is hidden until new sync succeeds');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,secret) values('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','totp','verified','JBSWY3DPEHPK3PXP');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::integer from public.nam_sales_activities),0,'Verified-factor representative cannot read sales at AAL1');
select is((select count(*)::integer from public.nam_integration_state),0,'Verified-factor representative cannot read integration state at AAL1');
select throws_ok($$select public.nam_save_sales_activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'{"type":"Research","context":"Fixture","outcome":"Denied until MFA","occurred_on":"2026-11-24"}','fixture-assurance')$$,'42501',null,'Verified-factor representative cannot write sales at AAL1');
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::integer from public.nam_sales_activities),1,'Verified-factor representative regains own sales read at AAL2');
select * from finish();
rollback;
