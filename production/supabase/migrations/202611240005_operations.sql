-- Private attachments, bounded reservations and audited business exports.
-- Storage is private and every ordinary call uses the signed-in user's JWT.
-- Provisional engineering limits: 2 MiB/file, 100 retained+pending files and
-- 20 MiB/task, 512 MiB/workspace, 100 pending uploads/workspace. Each pending or
-- deleting reservation is charged the full 2 MiB until actual Storage metadata
-- is verified/removed, so underdeclared direct uploads cannot evade quotas.
-- Revisit these
-- with NAM before general rollout; they are not a studio retention policy.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('nam-task-attachments','nam-task-attachments',false,2097152,array['application/pdf','image/png','image/jpeg','text/plain'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
create unique index if not exists nam_tasks_workspace_attachment_key on public.nam_tasks(workspace_id,id);

create table public.nam_task_attachments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),
 task_id uuid not null references public.nam_tasks(id),name text not null check(length(name) between 1 and 150 and name !~ '[[:cntrl:]/\\]' and left(name,1)<>'.' and position('..' in name)=0),
 mime text not null check(mime in ('application/pdf','image/png','image/jpeg','text/plain')),
 byte_size integer not null check(byte_size between 1 and 2097152),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 storage_path text not null unique,status text not null default 'pending' check(status in ('pending','ready','deleting','deleted')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 ready_at timestamptz,deleted_at timestamptz,cleanup_error boolean not null default false,
 foreign key(workspace_id,task_id) references public.nam_tasks(workspace_id,id));
create unique index nam_attachment_content on public.nam_task_attachments(workspace_id,task_id,sha256) where status<>'deleted';
create index nam_attachment_task on public.nam_task_attachments(workspace_id,task_id,status);
create table public.nam_operations_events(id bigint generated always as identity primary key,workspace_id uuid not null references public.nam_workspaces(id),actor_id uuid not null references auth.users(id),kind text not null,detail jsonb not null default '{}',created_at timestamptz not null default now());
alter table public.nam_task_attachments enable row level security;
alter table public.nam_operations_events enable row level security;
create policy attachment_metadata_read on public.nam_task_attachments for select to authenticated
using(status<>'deleted' and (public.nam_task_access(task_id) or (status='deleting' and public.nam_founder(workspace_id))));
create policy operations_events_read on public.nam_operations_events for select to authenticated using(public.nam_founder(workspace_id));

-- Exact metadata path matching avoids casting untrusted object-name segments.
-- There is deliberately no UPDATE policy: uploaded objects are immutable.
create function public.nam_attachment_storage_access(object_path text,operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_task_attachments a where a.storage_path=object_path and public.nam_role(a.workspace_id) is not null and case operation
 when 'read' then (a.status='ready' and public.nam_task_access(a.task_id)) or
   (a.status in ('pending','deleting') and public.nam_task_access(a.task_id) and (a.created_by=(select auth.uid()) or public.nam_founder(a.workspace_id))) or
   (a.status='deleting' and public.nam_founder(a.workspace_id))
 when 'insert' then a.status='pending' and a.created_by=(select auth.uid()) and public.nam_task_access(a.task_id)
 when 'delete' then (a.status in ('pending','deleting') and a.created_by=(select auth.uid()) and public.nam_task_access(a.task_id)) or
   (a.status='deleting' and public.nam_founder(a.workspace_id))
 else false end)
$$;
create policy nam_attachment_object_select on storage.objects for select to authenticated
using(bucket_id='nam-task-attachments' and public.nam_attachment_storage_access(name,'read'));
create policy nam_attachment_object_insert on storage.objects for insert to authenticated
with check(bucket_id='nam-task-attachments' and owner_id=(select auth.uid()::text) and public.nam_attachment_storage_access(name,'insert'));
create policy nam_attachment_object_delete on storage.objects for delete to authenticated
using(bucket_id='nam-task-attachments' and public.nam_attachment_storage_access(name,'delete'));

create function public.nam_reserve_attachment(w uuid,tid uuid,file_name text,file_mime text,file_size integer,content_sha256 text)
returns public.nam_task_attachments language plpgsql security definer set search_path='' as $$
declare task public.nam_tasks; result public.nam_task_attachments; ext text; file_count bigint; bytes_used bigint; pending_count bigint;
begin
 if auth.uid() is null then raise exception 'Sign in to upload files' using errcode='42501'; end if;
 if file_name is null or length(trim(file_name)) not between 1 and 150 or file_name ~ '[[:cntrl:]/\\]' or left(file_name,1)='.' or right(file_name,1)='.' or position('..' in file_name)>0 then raise exception 'Choose a simple file name without paths' using errcode='22023'; end if;
 if file_size is null or file_size not between 1 and 2097152 or content_sha256 is null or content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid attachment size or fingerprint' using errcode='22023'; end if;
 ext:=case file_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'text/plain' then 'txt' end;
 if ext is null or not (lower(file_name) like '%.'||ext or (file_mime='image/jpeg' and lower(file_name) like '%.jpeg')) then raise exception 'File extension must match PDF, PNG, JPEG or plain text type' using errcode='22023'; end if;
 -- Serializes quota accounting and duplicate reservations in this workspace.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text,5005));
 select * into task from public.nam_tasks t where t.id=tid and t.workspace_id=w for update;
 if not found or not public.nam_task_access(tid) then raise exception 'Task not found' using errcode='P0002'; end if;
 select * into result from public.nam_task_attachments a where a.workspace_id=w and a.task_id=tid and a.sha256=content_sha256 and a.status<>'deleted';
 if found then
  if result.status='pending' and result.created_by<>auth.uid() and not public.nam_founder(w) then raise exception 'An upload is already pending. Ask the owner to retry or remove it.' using errcode='40001'; end if;
  return result;
 end if;
 select count(*),coalesce(sum(case when status in ('pending','deleting') then 2097152 else byte_size end),0) into file_count,bytes_used from public.nam_task_attachments a where a.workspace_id=w and a.task_id=tid and a.status<>'deleted';
 if file_count>=100 or bytes_used+2097152>20971520 then raise exception 'Current storage safeguard: 100 files and 20 MiB per task. Pending uploads reserve 2 MiB each. Remove or finish an attachment before adding another.' using errcode='54000'; end if;
 select coalesce(sum(case when status in ('pending','deleting') then 2097152 else byte_size end),0),count(*) filter(where status='pending') into bytes_used,pending_count from public.nam_task_attachments a where a.workspace_id=w and a.status<>'deleted';
 if bytes_used+2097152>536870912 or pending_count>=100 then raise exception 'Workspace storage safeguard reached. Finish or remove pending uploads before retrying.' using errcode='54000'; end if;
 result.id:=gen_random_uuid();
 insert into public.nam_task_attachments(id,workspace_id,task_id,name,mime,byte_size,sha256,storage_path,created_by)
 values(result.id,w,tid,trim(file_name),file_mime,file_size,content_sha256,w::text||'/'||result.id::text||'/'||content_sha256||'.'||ext,auth.uid()) returning * into result;
 return result;
end $$;

create function public.nam_finish_attachment(w uuid,attachment_id uuid) returns public.nam_task_attachments
language plpgsql security definer set search_path='' as $$
declare a public.nam_task_attachments;
begin
 select * into a from public.nam_task_attachments x where x.id=attachment_id and x.workspace_id=w;
 if not found then raise exception 'Attachment not found' using errcode='P0002'; end if;
 -- Lock the parent before the attachment, matching task mutation ordering, so
 -- assignment/deletion cannot change between authorization and commit.
 perform 1 from public.nam_tasks t where t.id=a.task_id and t.workspace_id=w for update;
 select * into a from public.nam_task_attachments x where x.id=attachment_id and x.workspace_id=w for update;
 if not found or not public.nam_task_access(a.task_id) then raise exception 'Attachment not found' using errcode='P0002'; end if;
 if a.status='ready' then return a; end if;
 if a.status<>'pending' or (a.created_by<>auth.uid() and not public.nam_founder(w)) then raise exception 'Upload cannot be finished' using errcode='42501'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='nam-task-attachments' and o.name=a.storage_path and o.owner_id=a.created_by::text and
  case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint=a.byte_size else false end and o.metadata->>'mimetype'=a.mime) then raise exception 'Private upload is incomplete. Retry the upload.' using errcode='40001'; end if;
 update public.nam_task_attachments set status='ready',ready_at=now(),cleanup_error=false where id=a.id returning * into a;
 insert into public.nam_task_events(task_id,actor_id,kind,body) values(a.task_id,auth.uid(),'attachment',jsonb_build_object('message','Added attachment: '||a.name));
 return a;
end $$;

-- A failed cleanup retains the reservation/quota; successful cleanup is
-- confirmed against Storage metadata before a reservation can be released.
create function public.nam_remove_attachment(w uuid,attachment_id uuid,phase text) returns public.nam_task_attachments
language plpgsql security definer set search_path='' as $$
declare a public.nam_task_attachments;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text,5005));
 select * into a from public.nam_task_attachments x where x.id=attachment_id and x.workspace_id=w;
 if not found then raise exception 'Attachment not found' using errcode='P0002'; end if;
 perform 1 from public.nam_tasks t where t.id=a.task_id and t.workspace_id=w for update;
 select * into a from public.nam_task_attachments x where x.id=attachment_id and x.workspace_id=w for update;
 if not found or a.status='deleted' then raise exception 'Attachment not found' using errcode='P0002'; end if;
 if not public.nam_task_access(a.task_id) and not (public.nam_founder(w) and public.nam_task_access(a.task_id,true)) then raise exception 'Attachment not found' using errcode='P0002'; end if;
 if a.status='pending' and a.created_by<>auth.uid() and not public.nam_founder(w) then raise exception 'Only the uploader can cancel a pending upload' using errcode='42501'; end if;
 if phase='prepare' then
  update public.nam_task_attachments set status='deleting' where id=a.id returning * into a;
 elsif phase='failed' then
  update public.nam_task_attachments set cleanup_error=true where id=a.id returning * into a;
 elsif phase='complete' then
  if exists(select 1 from storage.objects o where o.bucket_id='nam-task-attachments' and o.name=a.storage_path) then raise exception 'Storage cleanup is still pending. Retry removal.' using errcode='40001'; end if;
  update public.nam_task_attachments set status='deleted',deleted_at=now(),cleanup_error=false where id=a.id returning * into a;
  insert into public.nam_task_events(task_id,actor_id,kind,body) values(a.task_id,auth.uid(),'attachment',jsonb_build_object('message','Removed attachment: '||a.name));
 else raise exception 'Unknown cleanup phase' using errcode='22023'; end if;
 return a;
end $$;

create function public.nam_export_business(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare export_table text; rows jsonb; result jsonb:='{}';
begin
 if not public.nam_founder(w) then raise exception 'Founder access and two-factor authentication are required' using errcode='42501'; end if;
 insert into public.nam_operations_events(workspace_id,actor_id,kind,detail) values(w,auth.uid(),'business_exported',jsonb_build_object('attachment_bytes',false));
 -- Only named business tables may be exported. Auth, credentials, connection
 -- secrets, job payloads and sessions are intentionally absent from this list.
 foreach export_table in array array['nam_workspaces','nam_memberships','nam_tasks','nam_task_events','nam_task_comments','nam_task_subtasks','nam_notifications','nam_courses','nam_course_versions','nam_lessons','nam_enrollments','nam_lesson_progress','nam_course_draft_lessons','nam_course_completions','nam_academy_completion_events','nam_academy_events','nam_academy_assignments','nam_academy_submissions','nam_academy_submission_events','nam_sales_activities','nam_sales_reports','nam_sales_targets','nam_sales_events','nam_integration_records','nam_integration_owner_map','nam_operations_events'] loop
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
 return jsonb_build_object('format','NAM OS business data export','version',3,'exportedAt',now(),'attachmentBytesIncluded',false,'data',result||jsonb_build_object('nam_task_attachments',rows));
end $$;

revoke all on public.nam_task_attachments,public.nam_operations_events from anon,authenticated;
grant select on public.nam_task_attachments,public.nam_operations_events to authenticated;
revoke all on function public.nam_attachment_storage_access(text,text),public.nam_reserve_attachment(uuid,uuid,text,text,integer,text),public.nam_finish_attachment(uuid,uuid),public.nam_remove_attachment(uuid,uuid,text),public.nam_export_business(uuid) from public,anon;
grant execute on function public.nam_attachment_storage_access(text,text),public.nam_reserve_attachment(uuid,uuid,text,text,integer,text),public.nam_finish_attachment(uuid,uuid),public.nam_remove_attachment(uuid,uuid,text),public.nam_export_business(uuid) to authenticated;
commit;
