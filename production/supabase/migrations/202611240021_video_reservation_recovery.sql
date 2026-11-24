-- Removing a working-copy link must free its active upload slot. Retain every
-- metadata row and private object, and keep all reserved bytes against the
-- storage cap because an issued signed-upload capability may still be valid.
begin;
create or replace function public.nam_reserve_academy_video(w uuid,c_id uuid,l_id uuid,expected_revision integer,payload jsonb,retry_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.nam_courses; a public.nam_academy_videos; identifier uuid:=gen_random_uuid();
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 -- Serialize the shared workspace quota across different course rows.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nam-academy-video:'||w::text,0));
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
 if (select count(*) from public.nam_academy_videos where workspace_id=w and status='pending' and source_lesson_id is not null)>=10 or
  (select count(*) from public.nam_academy_videos where workspace_id=w and course_id=c_id and status='pending' and source_lesson_id is not null)>=3 or
  (select coalesce(sum(byte_size),0) from public.nam_academy_videos where workspace_id=w)+(payload->>'byte_size')::bigint>536870912 then raise exception 'Private video storage safeguard reached' using errcode='54000';end if;
 insert into public.nam_academy_videos(id,workspace_id,course_id,source_lesson_id,title,file_name,mime,byte_size,caption_vtt,expected_sha256,storage_path,created_by,request_key,create_payload)
 values(identifier,w,c_id,l_id,trim(payload->>'title'),payload->>'file_name',payload->>'mime',(payload->>'byte_size')::bigint,coalesce(payload->>'caption_vtt',''),payload->>'sha256',w::text||'/'||identifier::text||case when payload->>'mime'='video/mp4' then '.mp4' else '.webm' end,auth.uid(),retry_key,payload) returning * into a;
 update public.nam_courses set revision=revision+1,publication_status='draft',updated_at=now() where id=c_id returning * into c;
 insert into public.nam_academy_events(workspace_id,course_id,actor_id,kind,detail) values(w,c_id,auth.uid(),'video_reserved','Private video upload reserved.');
 return to_jsonb(a)||jsonb_build_object('course_revision',c.revision);
end $$;

commit;
