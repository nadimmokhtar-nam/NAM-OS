-- Extend the explicit business-data allowlist without exporting Auth, secrets
-- or binary media. The founder-only authorization remains unchanged.
begin;
create or replace function public.nam_export_business(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare export_table text; rows jsonb; result jsonb:='{}';
begin
 if not public.nam_founder(w) then raise exception 'Founder access is required' using errcode='42501'; end if;
 insert into public.nam_operations_events(workspace_id,actor_id,kind,detail) values(w,auth.uid(),'business_exported',jsonb_build_object('attachment_bytes',false,'video_bytes',false));
 -- Only named business tables may be exported. Auth, credentials, connection
 -- secrets, job payloads and sessions are intentionally absent from this list.
 foreach export_table in array array['nam_workspaces','nam_memberships','nam_tasks','nam_task_events','nam_task_comments','nam_task_subtasks','nam_notifications','nam_courses','nam_course_versions','nam_lessons','nam_enrollments','nam_lesson_progress','nam_course_draft_lessons','nam_course_completions','nam_academy_completion_events','nam_academy_events','nam_academy_assignments','nam_academy_submissions','nam_academy_submission_events','nam_sales_activities','nam_sales_reports','nam_sales_targets','nam_sales_events','nam_integration_records','nam_integration_owner_map','nam_operations_events','nam_course_modules','nam_course_version_modules','nam_course_resources','nam_course_version_resources','nam_section_grants','nam_access_events','nam_projects','nam_project_members','nam_project_events','nam_academy_videos','nam_course_version_videos'] loop
  if pg_catalog.to_regclass('public.'||export_table) is null then continue; end if;
  if export_table='nam_workspaces' then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where t.id=$1',export_table) into rows using w;
  elsif export_table='nam_integration_records' then
   select coalesce(jsonb_agg(to_jsonb(r)-'credential_fingerprint'),'[]'::jsonb) into rows from public.nam_integration_records r where r.workspace_id=w;
  elsif exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=export_table and c.column_name='workspace_id') then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where t.workspace_id=$1',export_table) into rows using w;
  elsif export_table in ('nam_task_events','nam_task_comments','nam_task_subtasks') then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t join public.nam_tasks parent on parent.id=t.task_id where parent.workspace_id=$1',export_table) into rows using w;
  elsif export_table='nam_lesson_progress' then
   select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into rows from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id where l.workspace_id=w;
  else continue;
  end if;
  result:=result||jsonb_build_object(export_table,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into rows from public.nam_task_attachments a where a.workspace_id=w;
 return jsonb_build_object('format','NAM OS business data export','version',4,'exportedAt',now(),'attachmentBytesIncluded',false,'videoBytesIncluded',false,'data',result||jsonb_build_object('nam_task_attachments',rows));
end $$;

commit;
