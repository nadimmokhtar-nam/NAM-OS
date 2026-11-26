-- Private, immutable render versions. Existing task files remain independent.
begin;
create table public.nam_render_versions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,deliverable_id uuid not null,
 number integer check(number>0),file_name text not null check(length(file_name) between 1 and 150 and file_name !~ '[/\\\x00-\x1f\x7f]'),
 mime text not null check(mime in ('image/jpeg','image/png')),byte_size bigint not null check(byte_size between 1 and 52428800),
 expected_sha256 text not null check(expected_sha256 ~ '^[a-f0-9]{64}$'),sha256 text,
 width integer,height integer,preview_size integer,preview_sha256 text,thumbnail_size integer,thumbnail_sha256 text,
 note text not null default '' check(length(note)<=2000),stage text,
 status text not null default 'pending' check(status in ('pending','ready','deleting','cancelled')),cleanup_error boolean not null default false,
 storage_path text not null unique,created_by uuid not null references auth.users(id),request_key text not null,create_payload jsonb not null,
 created_at timestamptz not null default now(),verified_at timestamptz,
 unique(workspace_id,id),unique(deliverable_id,number),unique(workspace_id,created_by,request_key),
 foreign key(workspace_id,project_id,deliverable_id) references public.nam_deliverables(workspace_id,project_id,id),
 check((status='ready')=(number is not null and verified_at is not null and sha256 is not null)),
 check(status<>'ready' or (num_nulls(width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,stage)=0 and width>0 and height>0 and width<=16384 and height<=16384 and width::bigint*height<=64000000 and sha256=expected_sha256 and preview_size between 1 and 8388608 and thumbnail_size between 1 and 1048576 and preview_sha256 ~ '^[a-f0-9]{64}$' and thumbnail_sha256 ~ '^[a-f0-9]{64}$'))
);
create index render_version_history on public.nam_render_versions(workspace_id,deliverable_id,number desc) where status='ready';
create index render_pending_owner on public.nam_render_versions(workspace_id,created_by,deliverable_id) where status in ('pending','deleting');
create function public.nam_render_write(w uuid,did uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_deliverable_access(w,did) and exists(select 1 from public.nam_deliverables d join public.nam_projects p on p.id=d.project_id and p.workspace_id=w where d.id=did and d.workspace_id=w and not d.archived and not p.archived and d.kind in ('still','panorama') and (public.nam_founder(w) or d.artist_id=auth.uid()))
$$;
create function public.nam_render_access(w uuid,rid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_render_versions r where r.workspace_id=w and r.id=rid and public.nam_deliverable_access(w,r.deliverable_id) and (r.status='ready' or public.nam_founder(w) or r.created_by=auth.uid()))
$$;
alter table public.nam_render_versions enable row level security;
create policy render_versions_read on public.nam_render_versions for select to authenticated using(public.nam_render_access(workspace_id,id));
revoke all on public.nam_render_versions from public,anon,authenticated;
grant select(id,workspace_id,project_id,deliverable_id,number,file_name,mime,byte_size,sha256,expected_sha256,width,height,preview_size,preview_sha256,thumbnail_size,thumbnail_sha256,note,stage,status,cleanup_error,storage_path,created_by,created_at,verified_at) on public.nam_render_versions to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('nam-render-versions','nam-render-versions',false,52428800,array['image/jpeg','image/png','image/webp']);
create function public.nam_render_storage_access(object_path text,operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_render_versions r where object_path in (r.storage_path,r.storage_path||'.preview.webp',r.storage_path||'.thumbnail.webp') and public.nam_render_access(r.workspace_id,r.id) and
  case operation when 'read' then r.status in ('pending','ready','deleting')
   when 'insert' then r.status='pending' and public.nam_render_write(r.workspace_id,r.deliverable_id) and (r.created_by=auth.uid() or public.nam_founder(r.workspace_id))
   when 'delete' then r.status='deleting' and (r.created_by=auth.uid() or public.nam_founder(r.workspace_id)) else false end)
$$;
create policy render_objects_read on storage.objects for select to authenticated using(bucket_id='nam-render-versions' and public.nam_render_storage_access(name,'read'));
create policy render_objects_insert on storage.objects for insert to authenticated with check(bucket_id='nam-render-versions' and public.nam_render_storage_access(name,'insert'));
create policy render_objects_delete on storage.objects for delete to authenticated using(bucket_id='nam-render-versions' and public.nam_render_storage_access(name,'delete'));
-- No UPDATE policy: a verified original or derivative can never be overwritten.

create function public.nam_reserve_render(w uuid,did uuid,expected_version integer,payload jsonb,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.nam_deliverables;r public.nam_render_versions;identifier uuid:=gen_random_uuid();pid uuid;
begin
 if not public.nam_render_write(w,did) then raise exception 'Image upload access required' using errcode='42501';end if;
 if retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' or jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('file_name','mime','byte_size','sha256','note')) then raise exception 'Invalid render upload' using errcode='22023';end if;
 -- Serialize reservations across images so simultaneous uploads cannot exceed
 -- the workspace's reserved-byte or pending-upload allowance.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||':render-storage',0));
 select project_id into pid from public.nam_deliverables where workspace_id=w and id=did;
 perform 1 from public.nam_projects where workspace_id=w and id=pid for share;
 select * into d from public.nam_deliverables where workspace_id=w and id=did for share;
 if not public.nam_render_write(w,did) then raise exception 'Image upload access changed' using errcode='42501';end if;
 select * into r from public.nam_render_versions where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
 if found then
  if r.deliverable_id<>did or r.create_payload<>payload then raise exception 'Retry key belongs to another upload' using errcode='40001';end if;
  return r.id;
 end if;
 if d.version is distinct from expected_version then raise exception 'Image changed before upload' using errcode='40001';end if;
 if jsonb_typeof(payload->'file_name') is distinct from 'string' or jsonb_typeof(payload->'mime') is distinct from 'string' or jsonb_typeof(payload->'byte_size') is distinct from 'number' or jsonb_typeof(payload->'sha256') is distinct from 'string' or (payload?'note' and jsonb_typeof(payload->'note') is distinct from 'string') then raise exception 'Invalid render metadata' using errcode='22023';end if;
 if (select count(*) from public.nam_render_versions where workspace_id=w and status in ('pending','deleting'))>=20 or (select count(*) from public.nam_render_versions where deliverable_id=did and status in ('pending','deleting'))>=3 or
  (select coalesce(sum(byte_size+9437184),0) from public.nam_render_versions where workspace_id=w and status<>'cancelled')+(payload->>'byte_size')::bigint+9437184>53687091200 then raise exception 'Render storage allowance reached' using errcode='54000';end if;
 insert into public.nam_render_versions(id,workspace_id,project_id,deliverable_id,file_name,mime,byte_size,expected_sha256,note,storage_path,created_by,request_key,create_payload)
 values(identifier,w,d.project_id,did,payload->>'file_name',payload->>'mime',(payload->>'byte_size')::bigint,payload->>'sha256',coalesce(payload->>'note',''),w::text||'/'||identifier::text||case when payload->>'mime'='image/png' then '.png' else '.jpg' end,auth.uid(),retry_key,payload);
 return identifier;
end $$;

create function public.nam_attest_render(w uuid,rid uuid,expected_version integer,verified_actor uuid,verified_session uuid,verified_aal2 boolean,verified_image jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.nam_render_versions;d public.nam_deliverables;member public.nam_memberships;next_number integer;
begin
 if coalesce(auth.role(),'')<>'service_role' or verified_actor is null or verified_session is null then raise exception 'Trusted render verification required' using errcode='42501';end if;
 select * into member from public.nam_memberships where workspace_id=w and user_id=verified_actor and active for share;
 if not found then raise exception 'Current membership required' using errcode='42501';end if;
 perform 1 from auth.users where id=verified_actor and email_confirmed_at is not null and (banned_until is null or banned_until<=now()) for share;
 if not found then raise exception 'Account unavailable' using errcode='42501';end if;
 perform 1 from auth.sessions where id=verified_session and user_id=verified_actor and (not_after is null or not_after>now()) for share;
 if not found then raise exception 'Original upload session ended' using errcode='42501';end if;
 if exists(select 1 from auth.mfa_factors where user_id=verified_actor and status='verified') and verified_aal2 is distinct from true then raise exception 'Elected factor verification required' using errcode='42501';end if;
 select * into r from public.nam_render_versions where workspace_id=w and id=rid;
 if not found then raise exception 'Render not found' using errcode='P0002';end if;
 perform 1 from public.nam_projects where workspace_id=w and id=r.project_id and not archived for share;
 if not found then raise exception 'Project is archived' using errcode='40001';end if;
 select * into d from public.nam_deliverables where workspace_id=w and id=r.deliverable_id and not archived for update;
 if not found or not public.nam_project_member(w,r.project_id,verified_actor) or not (member.role='founder' or d.artist_id=verified_actor) then raise exception 'Current image upload access required' using errcode='42501';end if;
 select * into r from public.nam_render_versions where workspace_id=w and id=rid for update;
 if verified_image->>'sha256' is distinct from r.expected_sha256 then raise exception 'Stored bytes differ from selected render' using errcode='40001';end if;
 if r.status='ready' then return r.id;end if;
 if r.status<>'pending' or d.version is distinct from expected_version then raise exception 'Image changed while uploading' using errcode='40001';end if;
 if verified_image->>'sha256' is distinct from r.expected_sha256 then raise exception 'Stored bytes differ from selected render' using errcode='40001';end if;
 if not exists(select 1 from storage.objects where bucket_id='nam-render-versions' and name=r.storage_path and owner_id=r.created_by::text and metadata->>'size'=r.byte_size::text and metadata->>'mimetype'=r.mime) or
  not exists(select 1 from storage.objects where bucket_id='nam-render-versions' and name=r.storage_path||'.preview.webp' and metadata->>'size'=verified_image->>'preview_size' and metadata->>'mimetype'='image/webp') or
  not exists(select 1 from storage.objects where bucket_id='nam-render-versions' and name=r.storage_path||'.thumbnail.webp' and metadata->>'size'=verified_image->>'thumbnail_size' and metadata->>'mimetype'='image/webp') then raise exception 'Stored render verification incomplete' using errcode='40001';end if;
 select coalesce(max(number),0)+1 into next_number from public.nam_render_versions where deliverable_id=d.id and status='ready';
 update public.nam_render_versions set status='ready',number=next_number,sha256=verified_image->>'sha256',width=(verified_image->>'width')::integer,height=(verified_image->>'height')::integer,preview_size=(verified_image->>'preview_size')::integer,preview_sha256=verified_image->>'preview_sha256',thumbnail_size=(verified_image->>'thumbnail_size')::integer,thumbnail_sha256=verified_image->>'thumbnail_sha256',stage=d.stage,verified_at=now() where id=rid;
 update public.nam_deliverables set version=version+1,updated_at=now() where id=d.id returning * into d;
 insert into public.nam_deliverable_events(workspace_id,deliverable_id,actor_id,version,changes) values(w,d.id,verified_actor,d.version,jsonb_build_object('render_version',next_number,'file_name',r.file_name,'render_id',rid));
 return rid;
end $$;

create function public.nam_cancel_render(w uuid,rid uuid,phase text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.nam_render_versions;
begin
 if not public.nam_render_access(w,rid) then raise exception 'Render not found' using errcode='P0002';end if;
 select * into r from public.nam_render_versions where workspace_id=w and id=rid for update;
 if r.created_by is distinct from auth.uid() and not public.nam_founder(w) then raise exception 'Own upload or founder required' using errcode='42501';end if;
 if r.status='ready' then raise exception 'Verified render history is immutable' using errcode='42501';end if;
 if phase not in ('prepare','failed','complete') then raise exception 'Invalid cleanup phase' using errcode='22023';end if;
 if r.status='cancelled' then return true;end if;
 if phase='prepare' then update public.nam_render_versions set status='deleting',cleanup_error=false where id=rid;
 elsif phase='failed' then update public.nam_render_versions set cleanup_error=true where id=rid and status='deleting';
 elsif r.status<>'deleting' or exists(select 1 from storage.objects where bucket_id='nam-render-versions' and name in (r.storage_path,r.storage_path||'.preview.webp',r.storage_path||'.thumbnail.webp')) then raise exception 'Private cleanup incomplete' using errcode='40001';
 else update public.nam_render_versions set status='cancelled',cleanup_error=false where id=rid;end if;
 return true;
end $$;

create function public.nam_render_page(w uuid,did uuid,before_number integer default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.nam_deliverable_access(w,did) then raise exception 'Image not found' using errcode='P0002';end if;
 if before_number is not null and before_number<1 then raise exception 'Invalid version page' using errcode='22023';end if;
 with rows as (select id,deliverable_id,number,file_name,mime,byte_size,width,height,note,stage,created_by,created_at,verified_at from public.nam_render_versions where workspace_id=w and deliverable_id=did and status='ready' and (before_number is null or number<before_number) order by number desc limit 20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(rows)) from rows),'[]'::jsonb),'total',(select count(*) from public.nam_render_versions where workspace_id=w and deliverable_id=did and status='ready'),'nextBefore',case when (select count(*) from rows)=20 then (select min(number) from rows) end,
 'pending',coalesce((select jsonb_agg(jsonb_build_object('id',id,'file_name',file_name,'mime',mime,'byte_size',byte_size,'status',status,'cleanup_error',cleanup_error,'created_by',created_by,'can_retry',public.nam_render_write(w,did),'created_at',created_at) order by created_at) from public.nam_render_versions where workspace_id=w and deliverable_id=did and status in ('pending','deleting')),'[]'::jsonb),'can_upload',public.nam_render_write(w,did)) into result;
 return result;
end $$;

-- Keep the existing, RLS-filtered inventory and add only its latest real render.
alter function public.nam_deliverable_page(uuid,uuid,jsonb) rename to nam_deliverable_page_records;
revoke all on function public.nam_deliverable_page_records(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.nam_deliverable_page_records(uuid,uuid,jsonb) to authenticated;
create or replace function public.nam_deliverable_page(w uuid,pid uuid,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;items jsonb;
begin
 result:=public.nam_deliverable_page_records(w,pid,filters);
 select coalesce(jsonb_agg(item||jsonb_build_object('latest_render_id',(select id from public.nam_render_versions where workspace_id=w and deliverable_id=(item->>'id')::uuid and status='ready' order by number desc limit 1),'render_total',(select count(*) from public.nam_render_versions where workspace_id=w and deliverable_id=(item->>'id')::uuid and status='ready'))),'[]'::jsonb) into items from jsonb_array_elements(result->'items') as rows(item);
 return jsonb_set(result,'{items}',items);
end $$;

create table public.nam_render_comments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,render_id uuid not null,author_id uuid not null references auth.users(id),number integer not null check(number>0),body text not null check(length(trim(body)) between 1 and 5000),
 point_x numeric,point_y numeric,request_key text not null,created_at timestamptz not null default now(),
 unique(workspace_id,author_id,request_key),unique(render_id,number),foreign key(workspace_id,render_id) references public.nam_render_versions(workspace_id,id),
 check((point_x is null and point_y is null) or (point_x between 0 and 1 and point_y between 0 and 1 and point_x is not null and point_y is not null))
);
alter table public.nam_render_comments enable row level security;
create policy render_comments_read on public.nam_render_comments for select to authenticated using(public.nam_render_access(workspace_id,render_id));
revoke all on public.nam_render_comments from public,anon,authenticated;
grant select(id,workspace_id,render_id,author_id,number,body,point_x,point_y,created_at) on public.nam_render_comments to authenticated;
create function public.nam_post_render_comment(w uuid,rid uuid,message text,x numeric,y numeric,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result public.nam_render_comments;r public.nam_render_versions;next_number integer;
begin
 if not public.nam_render_access(w,rid) then raise exception 'Render not found' using errcode='P0002';end if;
 if retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Retry key required' using errcode='22023';end if;
 select * into r from public.nam_render_versions where workspace_id=w and id=rid for update;
 if r.status<>'ready' or not exists(select 1 from public.nam_deliverables d join public.nam_projects p on p.id=d.project_id where d.id=r.deliverable_id and not d.archived and not p.archived) then raise exception 'An active verified render is required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||auth.uid()::text||retry_key||':render-comment',0));
 select * into result from public.nam_render_comments where workspace_id=w and author_id=auth.uid() and request_key=retry_key;
 if found then
  if result.render_id<>rid or result.body is distinct from trim(message) or result.point_x is distinct from x or result.point_y is distinct from y then raise exception 'Comment retry differs' using errcode='40001';end if;
  return result.id;
 end if;
 select coalesce(max(number),0)+1 into next_number from public.nam_render_comments where render_id=rid;
 insert into public.nam_render_comments(workspace_id,render_id,author_id,number,body,point_x,point_y,request_key) values(w,rid,auth.uid(),next_number,trim(message),x,y,retry_key) returning * into result;
 return result.id;
end $$;
revoke all on function public.nam_deliverable_page(uuid,uuid,jsonb),public.nam_render_write(uuid,uuid),public.nam_render_access(uuid,uuid),public.nam_render_storage_access(text,text),public.nam_reserve_render(uuid,uuid,integer,jsonb,text),public.nam_attest_render(uuid,uuid,integer,uuid,uuid,boolean,jsonb),public.nam_cancel_render(uuid,uuid,text),public.nam_render_page(uuid,uuid,integer),public.nam_post_render_comment(uuid,uuid,text,numeric,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.nam_render_write(uuid,uuid),public.nam_render_access(uuid,uuid),public.nam_render_storage_access(text,text),public.nam_reserve_render(uuid,uuid,integer,jsonb,text),public.nam_cancel_render(uuid,uuid,text),public.nam_render_page(uuid,uuid,integer),public.nam_post_render_comment(uuid,uuid,text,numeric,numeric,text) to authenticated;
grant execute on function public.nam_deliverable_page(uuid,uuid,jsonb) to authenticated;
grant execute on function public.nam_attest_render(uuid,uuid,integer,uuid,uuid,boolean,jsonb) to service_role;

create or replace function public.nam_export_business(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare export_table text; rows jsonb; result jsonb:='{}';
begin
 if not public.nam_founder(w) then raise exception 'Founder access is required' using errcode='42501'; end if;
 insert into public.nam_operations_events(workspace_id,actor_id,kind,detail) values(w,auth.uid(),'business_exported',jsonb_build_object('attachment_bytes',false,'video_bytes',false));
 -- Only named business tables may be exported. Auth, credentials, connection
 -- secrets, job payloads and sessions are intentionally absent from this list.
 foreach export_table in array array['nam_workspaces','nam_memberships','nam_tasks','nam_task_events','nam_task_comments','nam_task_subtasks','nam_notifications','nam_courses','nam_course_versions','nam_lessons','nam_enrollments','nam_lesson_progress','nam_course_draft_lessons','nam_course_completions','nam_academy_completion_events','nam_academy_events','nam_academy_assignments','nam_academy_submissions','nam_academy_submission_events','nam_sales_activities','nam_sales_reports','nam_sales_targets','nam_sales_events','nam_integration_records','nam_integration_owner_map','nam_operations_events','nam_course_modules','nam_course_version_modules','nam_course_resources','nam_course_version_resources','nam_section_grants','nam_access_events','nam_projects','nam_project_members','nam_project_events','nam_academy_videos','nam_course_version_videos','nam_deliverables','nam_deliverable_events','nam_render_versions','nam_render_comments'] loop
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
 return jsonb_build_object('format','NAM OS business data export','version',6,'exportedAt',now(),'attachmentBytesIncluded',false,'videoBytesIncluded',false,'renderBytesIncluded',false,'data',result||jsonb_build_object('nam_task_attachments',rows));
end $$;


commit;
