-- Private course video on the existing Supabase Storage service. No existing
-- publications, enrollments, progress, buckets or files are rewritten.
begin;
create table public.nam_academy_videos (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),
 course_id uuid references public.nam_courses(id) on delete set null,
 source_lesson_id uuid references public.nam_course_draft_lessons(id) on delete set null,
 title text not null check(length(trim(title)) between 1 and 200),
 file_name text not null check(length(file_name) between 1 and 150 and file_name !~ '[/\\\x00-\x1f]'),
 mime text not null check(mime in ('video/mp4','video/webm')),
 byte_size bigint not null check(byte_size between 1 and 52428800),
 caption_vtt text not null default '' check(length(caption_vtt)<=100000 and (caption_vtt='' or caption_vtt like 'WEBVTT%')),
 storage_path text not null unique,status text not null default 'pending' check(status in ('pending','ready')),
 expected_sha256 text not null check(expected_sha256 ~ '^[a-f0-9]{64}$'),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),request_key text not null,
 create_payload jsonb not null,created_at timestamptz not null default now(),verified_at timestamptz,
 unique(workspace_id,id),unique(workspace_id,created_by,request_key),
 check((status='ready')=(verified_at is not null and sha256 is not null))
);
create index nam_video_working_lesson on public.nam_academy_videos(workspace_id,course_id,source_lesson_id);
create table public.nam_course_version_videos (
 workspace_id uuid not null,course_version_id uuid not null,source_lesson_id uuid not null,video_id uuid not null,
 primary key(course_version_id,source_lesson_id),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id),
 foreign key(workspace_id,video_id) references public.nam_academy_videos(workspace_id,id)
);
create index nam_video_publication_access on public.nam_course_version_videos(video_id,course_version_id);
create function public.nam_video_access(w uuid,vid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_section(w,'academy') and (public.nam_founder(w) or exists(
  select 1 from public.nam_academy_videos a
  join public.nam_course_version_videos vv on vv.video_id=a.id and vv.workspace_id=a.workspace_id
  join public.nam_course_versions cv on cv.id=vv.course_version_id and cv.workspace_id=w
  join public.nam_courses c on c.id=cv.course_id and c.workspace_id=w and not c.archived
  join public.nam_enrollments e on e.course_version_id=cv.id and e.workspace_id=w and e.user_id=(select auth.uid()) and e.revoked_at is null
  where a.id=vid and a.workspace_id=w and a.status='ready'))
$$;
alter table public.nam_academy_videos enable row level security;
alter table public.nam_course_version_videos enable row level security;
create policy academy_videos_read on public.nam_academy_videos for select to authenticated using(public.nam_video_access(workspace_id,id));
create policy academy_video_publications_read on public.nam_course_version_videos for select to authenticated using(exists(select 1 from public.nam_course_versions cv where cv.id=course_version_id and cv.workspace_id=nam_course_version_videos.workspace_id));
revoke all on public.nam_academy_videos,public.nam_course_version_videos from public,anon,authenticated;
grant select on public.nam_academy_videos,public.nam_course_version_videos to authenticated;

-- The Free-plan-compatible 50 MiB file limit is enforced by the bucket too.
-- Do not change the access settings of any existing bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('nam-academy-videos','nam-academy-videos',false,52428800,array['video/mp4','video/webm']);
create function public.nam_video_storage_access(object_path text,operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_academy_videos a where a.storage_path=object_path and
  case operation when 'read' then public.nam_video_access(a.workspace_id,a.id)
   when 'insert' then a.status='pending' and a.created_by=(select auth.uid()) and public.nam_founder(a.workspace_id)
   else false end)
$$;
create policy academy_video_objects_read on storage.objects for select to authenticated using(bucket_id='nam-academy-videos' and public.nam_video_storage_access(name,'read'));
create policy academy_video_objects_insert on storage.objects for insert to authenticated with check(bucket_id='nam-academy-videos' and public.nam_video_storage_access(name,'insert'));
-- No UPDATE or DELETE policy: uploaded objects and published references cannot
-- be replaced. Removing a working-copy link retains the underlying history.

create function public.nam_reserve_academy_video(w uuid,c_id uuid,l_id uuid,expected_revision integer,payload jsonb,retry_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.nam_courses; a public.nam_academy_videos; identifier uuid:=gen_random_uuid();
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' or jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('title','file_name','mime','byte_size','caption_vtt','sha256')) then raise exception 'Invalid upload request' using errcode='22023';end if;
 select * into c from public.nam_courses where id=c_id and workspace_id=w for update;
 if not found or c.archived then raise exception 'Editable course not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 select * into a from public.nam_academy_videos where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
 if found then
  if a.create_payload<>payload or a.course_id is distinct from c_id or a.source_lesson_id is distinct from l_id then raise exception 'Upload retry key belongs to another request' using errcode='40001';end if;
  return to_jsonb(a)||jsonb_build_object('course_revision',c.revision);
 end if;
 if c.revision is distinct from expected_revision then raise exception 'Course changed elsewhere. Reload before uploading' using errcode='40001';end if;
 if not exists(select 1 from public.nam_course_draft_lessons l where l.id=l_id and l.course_id=c_id and l.workspace_id=w) then raise exception 'Working lesson not found' using errcode='P0002';end if;
 if jsonb_typeof(payload->'title') is distinct from 'string' or jsonb_typeof(payload->'file_name') is distinct from 'string' or jsonb_typeof(payload->'mime') is distinct from 'string' or jsonb_typeof(payload->'byte_size') is distinct from 'number' or (payload?'caption_vtt' and jsonb_typeof(payload->'caption_vtt') is distinct from 'string') then raise exception 'Invalid video fields' using errcode='22023';end if;
 if (select count(*) from public.nam_academy_videos where workspace_id=w and status='pending')>=10 or
  (select count(*) from public.nam_academy_videos where workspace_id=w and course_id=c_id and status='pending')>=3 or
  (select coalesce(sum(byte_size),0) from public.nam_academy_videos where workspace_id=w)+(payload->>'byte_size')::bigint>536870912 then raise exception 'Private video storage safeguard reached' using errcode='54000';end if;
 insert into public.nam_academy_videos(id,workspace_id,course_id,source_lesson_id,title,file_name,mime,byte_size,caption_vtt,expected_sha256,storage_path,created_by,request_key,create_payload)
 values(identifier,w,c_id,l_id,trim(payload->>'title'),payload->>'file_name',payload->>'mime',(payload->>'byte_size')::bigint,coalesce(payload->>'caption_vtt',''),payload->>'sha256',w::text||'/'||identifier::text||case when payload->>'mime'='video/mp4' then '.mp4' else '.webm' end,auth.uid(),retry_key,payload) returning * into a;
 update public.nam_courses set revision=revision+1,publication_status='draft',updated_at=now() where id=c_id returning * into c;
 insert into public.nam_academy_events(workspace_id,course_id,actor_id,kind,detail) values(w,c_id,auth.uid(),'video_reserved','Private video upload reserved.');
 return to_jsonb(a)||jsonb_build_object('course_revision',c.revision);
end $$;

-- Only trusted server verification can make uploaded bytes available. The
-- service key never handles ordinary learner reads or browser uploads.
create function public.nam_attest_academy_video(w uuid,vid uuid,expected_revision integer,verified_actor uuid,verified_session uuid,verified_aal2 boolean,content_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.nam_academy_videos;c public.nam_courses;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted verification required' using errcode='42501';end if;
 perform 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=verified_actor and m.active and m.role='founder' for share;
 if not found then raise exception 'Current founder access required' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=verified_actor and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found then raise exception 'Account unavailable' using errcode='42501';end if;
 perform 1 from auth.sessions s where s.id=verified_session and s.user_id=verified_actor and (s.not_after is null or s.not_after>now()) for share;
 if not found then raise exception 'Original upload session has ended' using errcode='42501';end if;
 if exists(select 1 from auth.mfa_factors f where f.user_id=verified_actor and f.status='verified') and verified_aal2 is distinct from true then raise exception 'Current elected-factor verification required' using errcode='42501';end if;
 if content_sha256 is null or content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid verification digest' using errcode='22023';end if;
 select * into a from public.nam_academy_videos where workspace_id=w and id=vid;
 if not found or a.created_by<>verified_actor then raise exception 'Upload not found' using errcode='P0002';end if;
 if content_sha256<>a.expected_sha256 then raise exception 'Stored bytes do not match the selected video' using errcode='40001';end if;
 select * into c from public.nam_courses where workspace_id=w and id=a.course_id for update;
 if not found or c.archived then raise exception 'Editable course not found' using errcode='P0002';end if;
 select * into a from public.nam_academy_videos where workspace_id=w and id=vid for update;
 if a.status='ready' then
  if a.sha256<>content_sha256 then raise exception 'Verified bytes changed' using errcode='40001';end if;
  return to_jsonb(a)||jsonb_build_object('course_revision',c.revision);
 end if;
 if c.revision is distinct from expected_revision then raise exception 'Course changed while uploading. Review the latest draft before retrying verification' using errcode='40001';end if;
 if not exists(select 1 from public.nam_course_draft_lessons l where l.id=a.source_lesson_id and l.course_id=c.id and l.workspace_id=w) then raise exception 'Working lesson no longer exists' using errcode='P0002';end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='nam-academy-videos' and o.name=a.storage_path and o.owner_id=verified_actor::text and
  case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint=a.byte_size else false end and o.metadata->>'mimetype'=a.mime) then raise exception 'Private upload is incomplete' using errcode='40001';end if;
 update public.nam_academy_videos set source_lesson_id=null where workspace_id=w and source_lesson_id=a.source_lesson_id and id<>a.id and status='ready';
 update public.nam_academy_videos set status='ready',sha256=content_sha256,verified_at=now() where id=a.id returning * into a;
 update public.nam_courses set revision=revision+1,publication_status='draft',updated_at=now() where id=c.id returning * into c;
 insert into public.nam_academy_events(workspace_id,course_id,actor_id,kind,detail) values(w,c.id,verified_actor,'video_verified','Private lesson video verified.');
 return to_jsonb(a)||jsonb_build_object('course_revision',c.revision);
end $$;

create function public.nam_unlink_academy_video(w uuid,vid uuid,expected_revision integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.nam_academy_videos;c public.nam_courses;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 select * into a from public.nam_academy_videos where workspace_id=w and id=vid;
 if not found or a.source_lesson_id is null then raise exception 'Working video not found' using errcode='P0002';end if;
 select * into c from public.nam_courses where workspace_id=w and id=a.course_id for update;
 if not found or c.revision is distinct from expected_revision then raise exception 'Course changed elsewhere. Reload before removing the working video' using errcode='40001';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 update public.nam_academy_videos set source_lesson_id=null where id=a.id;
 update public.nam_courses set revision=revision+1,publication_status='draft',updated_at=now() where id=c.id;
 insert into public.nam_academy_events(workspace_id,course_id,actor_id,kind,detail) values(w,c.id,auth.uid(),'video_unlinked','Working video removed; published history and private object retained.');
 return c.id;
end $$;

create function public.nam_snapshot_academy_videos() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.nam_academy_videos a where a.workspace_id=new.workspace_id and a.course_id=new.course_id and a.source_lesson_id is not null and a.status='pending') then raise exception 'Verify or remove pending videos before publishing' using errcode='40001';end if;
 insert into public.nam_course_version_videos(workspace_id,course_version_id,source_lesson_id,video_id)
 select new.workspace_id,new.id,a.source_lesson_id,a.id from public.nam_academy_videos a
 join public.nam_course_draft_lessons l on l.id=a.source_lesson_id and l.course_id=new.course_id and l.workspace_id=new.workspace_id
 where a.workspace_id=new.workspace_id and a.course_id=new.course_id and a.status='ready';
 return new;
end $$;
create trigger academy_video_snapshot after insert on public.nam_course_versions for each row execute function public.nam_snapshot_academy_videos();

alter function public.nam_academy_course(uuid,uuid) rename to nam_academy_course_written;
revoke all on function public.nam_academy_course_written(uuid,uuid) from public,anon,authenticated,service_role;
create function public.nam_academy_course(w uuid,c_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=public.nam_academy_course_written(w,c_id);
 return c||jsonb_build_object('videos',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'mime',a.mime,'size',a.byte_size,'lesson_id',l.id,'has_captions',a.caption_vtt<>''))
  from public.nam_course_version_videos vv join public.nam_academy_videos a on a.id=vv.video_id and a.workspace_id=w
  join public.nam_lessons l on l.source_lesson_id=vv.source_lesson_id and l.course_version_id=vv.course_version_id and l.workspace_id=w
  where vv.workspace_id=w and vv.course_version_id=(c->>'publication_id')::uuid and public.nam_video_access(w,a.id)),'[]'::jsonb));
end $$;
alter function public.nam_academy_admin_course(uuid,uuid) rename to nam_academy_admin_course_written;
revoke all on function public.nam_academy_admin_course_written(uuid,uuid) from public,anon,authenticated,service_role;
create function public.nam_academy_admin_course(w uuid,c_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 c:=public.nam_academy_admin_course_written(w,c_id);
 return c||jsonb_build_object('videos',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'file_name',a.file_name,'mime',a.mime,'size',a.byte_size,'status',a.status,'lesson_id',a.source_lesson_id,'has_captions',a.caption_vtt<>'') order by a.created_at)
  from public.nam_academy_videos a where a.workspace_id=w and a.course_id=c_id and a.source_lesson_id is not null),'[]'::jsonb));
end $$;

revoke all on function public.nam_video_access(uuid,uuid),public.nam_video_storage_access(text,text),public.nam_reserve_academy_video(uuid,uuid,uuid,integer,jsonb,text),public.nam_attest_academy_video(uuid,uuid,integer,uuid,uuid,boolean,text),public.nam_unlink_academy_video(uuid,uuid,integer),public.nam_snapshot_academy_videos(),public.nam_academy_course(uuid,uuid),public.nam_academy_admin_course(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.nam_video_access(uuid,uuid),public.nam_video_storage_access(text,text),public.nam_reserve_academy_video(uuid,uuid,uuid,integer,jsonb,text),public.nam_unlink_academy_video(uuid,uuid,integer),public.nam_academy_course(uuid,uuid),public.nam_academy_admin_course(uuid,uuid) to authenticated;
grant execute on function public.nam_attest_academy_video(uuid,uuid,integer,uuid,uuid,boolean,text) to service_role;
commit;
