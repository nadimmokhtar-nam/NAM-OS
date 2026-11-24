-- Run in an isolated Supabase test database AFTER the migration. Requires
-- pgTAP installed in extensions. Rolled back: never run against production.
begin;
select plan(8);
select ok((select relrowsecurity from pg_class where oid='public.nam_tasks'::regclass),'Task RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.nam_memberships'::regclass),'Membership RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.nam_course_versions'::regclass),'Published version RLS enabled');
select ok(not has_table_privilege('anon','public.nam_tasks','SELECT'),'Anonymous cannot read tasks');
select ok(not has_table_privilege('authenticated','public.nam_memberships','UPDATE'),'Members cannot promote themselves');
select ok(not has_table_privilege('authenticated','public.nam_tasks','UPDATE'),'Task direct update denied');
select ok(not has_function_privilege('anon','public.nam_save_task(uuid,uuid,integer,jsonb)','EXECUTE'),'Anonymous cannot execute task writes');
select ok(not has_table_privilege('authenticated','public.nam_course_versions','UPDATE'),'Published versions immutable through Data API');
select * from finish();
rollback;
-- These structural tests are insufficient for launch. Add real auth-user
-- fixtures and allow/deny tests for every role, inactive and cross-workspace
-- identity, AAL1 vs AAL2, record ownership, malicious RPC changes, course
-- enrollment revocation, duplicates and concurrent updates before release.
