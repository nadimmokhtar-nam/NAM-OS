-- Complete the named business-data export after the expanded workspaces.
-- Commands, credentials, identity state and media bytes are never a backup DTO.
begin;
create or replace function public.nam_export_business(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare export_table text;rows jsonb;result jsonb:='{}'::jsonb;
 omit_columns text[]:=array['credential_fingerprint','last_success_fingerprint','request_fingerprint','fingerprint','request_key','retry_key','create_payload','command_key','command_payload'];
begin
 if public.nam_founder(w) is distinct from true then raise exception 'Current Founder access is required' using errcode='42501';end if;
 -- Pin the exact managed identity. A queued export must not continue after a
 -- committed account/session revocation, including the global subject catalog.
 perform 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=auth.uid() and m.active and m.role='founder' for share;
 if not found then raise exception 'Current Founder membership is required' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found then raise exception 'Current account is required' using errcode='42501';end if;
 perform 1 from auth.sessions s where s.user_id=auth.uid() and s.id=case when (auth.jwt()->>'session_id')~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then (auth.jwt()->>'session_id')::uuid end and (s.not_after is null or s.not_after>now()) for share;
 if not found or public.nam_founder(w) is distinct from true then raise exception 'Current assured Founder session is required' using errcode='42501';end if;
 insert into public.nam_operations_events(workspace_id,actor_id,kind,detail)
 values(w,auth.uid(),'business_exported',jsonb_build_object('export_version',9,'attachment_bytes',false,'video_bytes',false,'render_bytes',false,'resource_bytes',false));

 -- An explicit allowlist is intentional. In particular, task request keys,
 -- schedule requests, Academy commands, Sales follow-up requests, Team request
 -- fingerprints, Home announcement requests, jobs and auth tables stay private.
 foreach export_table in array array[
  'nam_workspaces','nam_memberships','nam_tasks','nam_task_events','nam_task_comments','nam_task_subtasks','nam_notifications',
  'nam_courses','nam_course_versions','nam_lessons','nam_enrollments','nam_lesson_progress','nam_course_draft_lessons','nam_course_completions','nam_academy_completion_events','nam_academy_events','nam_academy_assignments','nam_academy_submissions','nam_academy_submission_events',
  'nam_sales_activities','nam_sales_reports','nam_sales_targets','nam_sales_events','nam_integration_records','nam_integration_owner_map','nam_operations_events',
  'nam_course_modules','nam_course_version_modules','nam_course_resources','nam_course_version_resources','nam_section_grants','nam_access_events',
  'nam_projects','nam_project_members','nam_project_events','nam_academy_videos','nam_course_version_videos','nam_deliverables','nam_deliverable_events','nam_render_versions','nam_render_comments',
  'nam_client_contacts','nam_client_project_access','nam_client_review_requests','nam_client_review_items','nam_client_review_recipients','nam_client_review_decisions','nam_project_phases','nam_project_phase_events',
  'nam_project_resources','nam_project_resource_events','nam_task_dependencies',
  'nam_academy_topics','nam_course_topics','nam_course_version_topics','nam_learning_paths','nam_learning_path_topics','nam_learning_path_courses','nam_learning_path_assignments','nam_learning_path_assignment_courses','nam_learning_path_events',
  'nam_sales_followup_links','nam_sales_revenue_targets','nam_sales_revenue_target_events','nam_departments','nam_member_profiles','nam_team_events',
  'nam_project_revision_rounds','nam_project_revision_items','nam_project_deliveries','nam_project_delivery_events','nam_project_milestones','nam_project_milestone_events',
  'nam_home_announcements','nam_home_announcement_events'
 ] loop
  -- The last named Home tables are introduced by the following additive
  -- migration. Missing named modules are skipped, never discovered broadly.
  if pg_catalog.to_regclass('public.'||export_table) is null then continue;end if;
  if export_table='nam_workspaces' then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)-$2::text[]),''[]''::jsonb) from public.%I t where t.id=$1',export_table) into rows using w,omit_columns;
  elsif export_table='nam_academy_topics' then
   -- This one catalog is global. It is not a tenant table and must not fall
   -- through an unscoped generic SELECT. The same live Founder guard applies.
   if public.nam_founder(w) is distinct from true then raise exception 'Current Founder access is required' using errcode='42501';end if;
   select coalesce(jsonb_agg(to_jsonb(t) order by t.position,t.code),'[]'::jsonb) into rows from public.nam_academy_topics t;
  elsif export_table='nam_integration_records' then
   select coalesce(jsonb_agg(to_jsonb(r)-omit_columns),'[]'::jsonb) into rows from public.nam_integration_records r where r.workspace_id=w;
  elsif export_table='nam_sales_followup_links' then
   -- Provider credential bindings authorize a link internally; they are not
   -- business data, just as on the source snapshot above.
   select coalesce(jsonb_agg(to_jsonb(l)-omit_columns),'[]'::jsonb) into rows from public.nam_sales_followup_links l where l.workspace_id=w;
  elsif exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=export_table and c.column_name='workspace_id') then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)-$2::text[]),''[]''::jsonb) from public.%I t where t.workspace_id=$1',export_table) into rows using w,omit_columns;
  elsif export_table in ('nam_task_events','nam_task_comments','nam_task_subtasks') then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)-$2::text[]),''[]''::jsonb) from public.%I t join public.nam_tasks p on p.id=t.task_id where p.workspace_id=$1',export_table) into rows using w,omit_columns;
  elsif export_table='nam_lesson_progress' then
   select coalesce(jsonb_agg(to_jsonb(p)-omit_columns),'[]'::jsonb) into rows from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id where l.workspace_id=w;
  else
   -- A newly changed schema must get an explicit tenant/catalog branch before
   -- it can be exported, even if its name was already allowlisted.
   raise exception 'Business export scope is unavailable for %',export_table using errcode='55000';
  end if;
  result:=result||jsonb_build_object(export_table,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(a)-omit_columns),'[]'::jsonb) into rows from public.nam_task_attachments a where a.workspace_id=w;
 -- Elected MFA may change independently during a long metadata export.
 if public.nam_founder(w) is distinct from true then raise exception 'Founder assurance changed during export' using errcode='42501';end if;
 return jsonb_build_object('format','NAM OS business data export','version',9,'exportedAt',now(),
  'attachmentBytesIncluded',false,'videoBytesIncluded',false,'renderBytesIncluded',false,'resourceBytesIncluded',false,
  'data',result||jsonb_build_object('nam_task_attachments',rows));
end $$;
revoke all on function public.nam_export_business(uuid) from public,anon,authenticated,service_role;
grant execute on function public.nam_export_business(uuid) to authenticated;
commit;
