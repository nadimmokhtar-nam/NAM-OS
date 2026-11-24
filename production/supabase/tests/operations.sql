-- Isolated staging database only, after migrations 001-005; requires pgTAP.
-- Structural gates are not a substitute for signed-user Storage/API tests.
begin;
select plan(10);
select ok((select relrowsecurity from pg_class where oid='public.nam_task_attachments'::regclass),'Attachment metadata RLS enabled');
select ok(not (select public from storage.buckets where id='nam-task-attachments'),'Attachment bucket is private');
select is((select file_size_limit from storage.buckets where id='nam-task-attachments'),2097152::bigint,'Storage enforces two MiB files');
select ok(not has_table_privilege('authenticated','public.nam_task_attachments','INSERT'),'Direct attachment metadata insert denied');
select ok(not has_table_privilege('authenticated','public.nam_task_attachments','UPDATE'),'Direct attachment metadata update denied');
select ok(not has_table_privilege('anon','public.nam_task_attachments','SELECT'),'Anonymous attachment metadata denied');
select ok(not has_function_privilege('anon','public.nam_reserve_attachment(uuid,uuid,text,text,integer,text)','EXECUTE'),'Anonymous reservations denied');
select ok(not has_function_privilege('anon','public.nam_export_business(uuid)','EXECUTE'),'Anonymous business export denied');
select ok(has_function_privilege('authenticated','public.nam_remove_attachment(uuid,uuid,text)','EXECUTE'),'Cleanup uses scoped RPC');
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'nam_attachment_%' and cmd='UPDATE'),'No overwrite policy for immutable objects');
select * from finish();
rollback;
-- Still required before release: real founder AAL2/sales/freelancer/inactive/
-- cross-workspace JWT fixtures; denied file reads after task reassignment/delete;
-- direct Storage MIME/size and RPC manipulation; concurrent quota reservations;
-- lost responses, cleanup retries, revoked memberships and backup/restore of
-- actual private Storage objects. These checks have NOT been executed locally.
