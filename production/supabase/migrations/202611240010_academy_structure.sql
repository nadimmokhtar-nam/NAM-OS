-- First-release Academy modules and downloadable written resources.
-- TXT resources are authored text, not arbitrary uploaded files or public URLs.
begin;
create table public.nam_course_modules(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,course_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),position integer not null check(position>0),
 unique(course_id,position) deferrable initially deferred,
 foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id) on delete cascade);
alter table public.nam_course_draft_lessons add column module_id uuid references public.nam_course_modules(id);
create table public.nam_course_version_modules(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,course_version_id uuid not null,source_module_id uuid not null,
 title text not null,position integer not null,unique(course_version_id,source_module_id),unique(course_version_id,position),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id));
alter table public.nam_lessons add column module_id uuid references public.nam_course_version_modules(id);
create table public.nam_course_resources(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,course_id uuid not null,
 lesson_id uuid references public.nam_course_draft_lessons(id) on delete set null,
 title text not null check(length(trim(title)) between 1 and 200),body text not null check(length(trim(body)) between 1 and 50000),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id) on delete cascade);
create table public.nam_course_version_resources(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,course_version_id uuid not null,source_resource_id uuid not null,source_lesson_id uuid,
 title text not null,body text not null,created_at timestamptz not null default now(),unique(course_version_id,source_resource_id),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id));
create index nam_academy_resource_course on public.nam_course_resources(workspace_id,course_id);
create index nam_academy_version_resource on public.nam_course_version_resources(workspace_id,course_version_id);
alter table public.nam_course_modules enable row level security;
alter table public.nam_course_version_modules enable row level security;
alter table public.nam_course_resources enable row level security;
alter table public.nam_course_version_resources enable row level security;
create policy academy_module_draft_read on public.nam_course_modules for select to authenticated using(public.nam_founder(workspace_id));
create policy academy_resource_draft_read on public.nam_course_resources for select to authenticated using(public.nam_founder(workspace_id));
create policy academy_module_published_read on public.nam_course_version_modules for select to authenticated using(exists(select 1 from public.nam_course_versions v where v.id=course_version_id and v.workspace_id=nam_course_version_modules.workspace_id));
create policy academy_resource_published_read on public.nam_course_version_resources for select to authenticated using(exists(select 1 from public.nam_course_versions v where v.id=course_version_id and v.workspace_id=nam_course_version_resources.workspace_id));

-- Publication transaction captures structure/resources before copying lessons.
-- Binary objects do not exist in this feature: learner downloads are generated
-- from the immutable, enrollment-protected published text snapshot.
create function public.nam_academy_snapshot_structure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.nam_course_modules m where m.workspace_id=new.workspace_id and m.course_id=new.course_id) and exists(select 1 from public.nam_course_draft_lessons l where l.workspace_id=new.workspace_id and l.course_id=new.course_id and l.module_id is null) then raise exception 'Assign each lesson to a module before publishing.' using errcode='22023';end if;
 insert into public.nam_course_version_modules(workspace_id,course_version_id,source_module_id,title,position)
 select new.workspace_id,new.id,m.id,m.title,m.position from public.nam_course_modules m where m.workspace_id=new.workspace_id and m.course_id=new.course_id;
 insert into public.nam_course_version_resources(workspace_id,course_version_id,source_resource_id,source_lesson_id,title,body)
 select new.workspace_id,new.id,r.id,r.lesson_id,r.title,r.body from public.nam_course_resources r where r.workspace_id=new.workspace_id and r.course_id=new.course_id;
 return new;
end $$;
create trigger nam_academy_snapshot_structure after insert on public.nam_course_versions for each row execute function public.nam_academy_snapshot_structure();
create function public.nam_academy_snapshot_lesson_module() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select p.id into new.module_id from public.nam_course_draft_lessons l join public.nam_course_version_modules p on p.source_module_id=l.module_id and p.course_version_id=new.course_version_id and p.workspace_id=new.workspace_id where l.id=new.source_lesson_id and l.workspace_id=new.workspace_id;
 return new;
end $$;
create trigger nam_academy_snapshot_lesson_module before insert on public.nam_lessons for each row execute function public.nam_academy_snapshot_lesson_module();

create function public.nam_academy_structure(w uuid,c_id uuid,op text,expected_revision integer,changes jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.nam_courses;mid uuid;lid uuid;rid uuid;n integer;i integer;ids uuid[];allowed text[];
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501';end if;
 select * into c from public.nam_courses t where t.id=c_id and t.workspace_id=w for update;
 if not found then raise exception 'Course not found' using errcode='P0002';end if;
 if expected_revision is distinct from c.revision then raise exception 'This course changed elsewhere. Reload before saving.' using errcode='40001';end if;
 if c.archived then raise exception 'Restore the course before editing its structure.' using errcode='22023';end if;
 allowed:=case op when 'module' then array['id','title'] when 'remove-module' then array['id'] when 'reorder-modules' then array['module_ids'] when 'assign-module' then array['lesson_id','module_id'] when 'resource' then array['id','title','body','lesson_id'] when 'remove-resource' then array['id'] else null end;
 if allowed is null or not public.nam_academy_keys(changes,allowed) then raise exception 'Unsupported course structure fields.' using errcode='22023';end if;
 if op='module' then
  if jsonb_typeof(changes->'title') is distinct from 'string' then raise exception 'A module title is required.' using errcode='22023';end if;
  if changes?'id' then
   update public.nam_course_modules set title=trim(changes->>'title') where id=(changes->>'id')::uuid and workspace_id=w and course_id=c.id;
   if not found then raise exception 'Module not found' using errcode='P0002';end if;
  else
   select count(*) into n from public.nam_course_modules m where m.workspace_id=w and m.course_id=c.id;
   if n>=100 then raise exception 'A course can have at most 100 modules.' using errcode='22023';end if;
   insert into public.nam_course_modules(workspace_id,course_id,title,position) values(w,c.id,trim(changes->>'title'),n+1);
  end if;
 elsif op='remove-module' then
  mid:=(changes->>'id')::uuid;
  if exists(select 1 from public.nam_course_draft_lessons l where l.workspace_id=w and l.course_id=c.id and l.module_id=mid) then raise exception 'Move or remove this module’s lessons before deleting the module.' using errcode='40001';end if;
  delete from public.nam_course_modules where id=mid and workspace_id=w and course_id=c.id;
  if not found then raise exception 'Module not found' using errcode='P0002';end if;
  update public.nam_course_modules m set position=z.position from (select m2.id,row_number() over(order by m2.position)::integer as position from public.nam_course_modules m2 where m2.workspace_id=w and m2.course_id=c.id) z where m.id=z.id;
 elsif op='reorder-modules' then
  if jsonb_typeof(changes->'module_ids') is distinct from 'array' then raise exception 'Supply the module order.' using errcode='22023';end if;
  select coalesce(array_agg(x::uuid),array[]::uuid[]) into ids from jsonb_array_elements_text(changes->'module_ids') x;
  select count(*) into n from public.nam_course_modules m where m.workspace_id=w and m.course_id=c.id;
  if cardinality(ids)<>n or (select count(distinct x) from unnest(ids) x)<>n or exists(select 1 from unnest(ids) x where not exists(select 1 from public.nam_course_modules m where m.id=x and m.workspace_id=w and m.course_id=c.id)) then raise exception 'Supply each module exactly once.' using errcode='22023';end if;
  i:=0;foreach mid in array ids loop i:=i+1;update public.nam_course_modules set position=i where id=mid and workspace_id=w and course_id=c.id;end loop;
 elsif op='assign-module' then
  lid:=(changes->>'lesson_id')::uuid;mid:=nullif(changes->>'module_id','')::uuid;
  if mid is not null and not exists(select 1 from public.nam_course_modules m where m.id=mid and m.workspace_id=w and m.course_id=c.id) then raise exception 'Module not found' using errcode='P0002';end if;
  update public.nam_course_draft_lessons set module_id=mid where id=lid and workspace_id=w and course_id=c.id;
  if not found then raise exception 'Lesson not found' using errcode='P0002';end if;
 elsif op='resource' then
  if jsonb_typeof(changes->'title') is distinct from 'string' or jsonb_typeof(changes->'body') is distinct from 'string' then raise exception 'Provide a text resource title and content.' using errcode='22023';end if;
  lid:=nullif(changes->>'lesson_id','')::uuid;
  if lid is not null and not exists(select 1 from public.nam_course_draft_lessons l where l.id=lid and l.workspace_id=w and l.course_id=c.id) then raise exception 'Lesson not found' using errcode='P0002';end if;
  if changes?'id' then
   update public.nam_course_resources set title=trim(changes->>'title'),body=changes->>'body',lesson_id=lid,updated_at=now() where id=(changes->>'id')::uuid and workspace_id=w and course_id=c.id;
   if not found then raise exception 'Resource not found' using errcode='P0002';end if;
  else
   select count(*) into n from public.nam_course_resources r where r.workspace_id=w and r.course_id=c.id;
   if n>=30 then raise exception 'A course can have at most 30 written resources.' using errcode='22023';end if;
   insert into public.nam_course_resources(workspace_id,course_id,lesson_id,title,body) values(w,c.id,lid,trim(changes->>'title'),changes->>'body');
  end if;
 elsif op='remove-resource' then
  delete from public.nam_course_resources where id=(changes->>'id')::uuid and workspace_id=w and course_id=c.id;
  if not found then raise exception 'Resource not found' using errcode='P0002';end if;
 end if;
 -- Group reading order by module, retaining relative order within each group.
 update public.nam_course_draft_lessons l set position=z.position from (
  select l2.id,row_number() over(order by coalesce(m.position,2147483647),l2.position)::integer as position from public.nam_course_draft_lessons l2 left join public.nam_course_modules m on m.id=l2.module_id and m.workspace_id=w where l2.workspace_id=w and l2.course_id=c.id) z where l.id=z.id;
 update public.nam_courses set publication_status='draft',revision=revision+1,updated_at=now() where id=c.id and workspace_id=w;
 insert into public.nam_academy_events(workspace_id,course_id,actor_id,kind,detail) values(w,c.id,auth.uid(),op,'Working course structure updated');
 return public.nam_academy_admin_course(w,c.id);
end $$;

-- Read material metadata after the base function has already checked founder
-- or enrolled learner access. Resource bodies are fetched only on download.
create function public.nam_academy_content(w uuid,c_id uuid,publication_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.nam_course_versions v where v.id=publication_id and v.course_id=c_id and v.workspace_id=w) then raise exception 'Course publication not found' using errcode='P0002';end if;
 return jsonb_build_object('modules',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('lesson_count',(select count(*) from public.nam_lessons l where l.course_version_id=publication_id and l.module_id=m.id and l.workspace_id=w)) order by m.position) from public.nam_course_version_modules m where m.course_version_id=publication_id and m.workspace_id=w),'[]'::jsonb),
 'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'course_id',c_id,'format','text/plain','lesson_id',l.id,'file_name',r.title||'.txt') order by r.created_at,r.id) from public.nam_course_version_resources r left join public.nam_lessons l on l.course_version_id=publication_id and l.source_lesson_id=r.source_lesson_id and l.workspace_id=w where r.course_version_id=publication_id and r.workspace_id=w),'[]'::jsonb));
end $$;
create function public.nam_academy_draft_content(w uuid,c_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501';end if;
 return jsonb_build_object('modules',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('lesson_count',(select count(*) from public.nam_course_draft_lessons l where l.module_id=m.id and l.workspace_id=w and l.course_id=c_id)) order by m.position) from public.nam_course_modules m where m.workspace_id=w and m.course_id=c_id),'[]'::jsonb),
 'resources',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('format','text/plain','file_name',r.title||'.txt') order by r.created_at,r.id) from public.nam_course_resources r where r.workspace_id=w and r.course_id=c_id),'[]'::jsonb));
end $$;
revoke all on public.nam_course_modules,public.nam_course_version_modules,public.nam_course_resources,public.nam_course_version_resources from public,anon,authenticated;
grant select on public.nam_course_modules,public.nam_course_version_modules,public.nam_course_resources,public.nam_course_version_resources to authenticated;
revoke all on function public.nam_academy_structure(uuid,uuid,text,integer,jsonb),public.nam_academy_content(uuid,uuid,uuid),public.nam_academy_draft_content(uuid,uuid),public.nam_academy_snapshot_structure(),public.nam_academy_snapshot_lesson_module() from public,anon;
grant execute on function public.nam_academy_structure(uuid,uuid,text,integer,jsonb),public.nam_academy_content(uuid,uuid,uuid),public.nam_academy_draft_content(uuid,uuid) to authenticated;
-- Existing DTO functions are extended below without changing function IDs.

create or replace function public.nam_academy_course(w uuid,c_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.nam_courses;e public.nam_enrollments;v public.nam_course_versions;total integer;done integer;result jsonb;
begin
 if not public.nam_section(w,'academy') then raise exception 'Access denied' using errcode='42501';end if;
 select t.id,t.workspace_id,t.archived into c.id,c.workspace_id,c.archived from public.nam_courses t where t.id=c_id and t.workspace_id=w and not t.archived;
 if not found then raise exception 'Course not found' using errcode='P0002';end if;
 select * into e from public.nam_enrollments t where t.workspace_id=w and t.course_id=c.id and t.user_id=auth.uid() and t.revoked_at is null;
 if not found then raise exception 'Course not found' using errcode='P0002';end if;
 select * into v from public.nam_course_versions t where t.id=e.course_version_id and t.workspace_id=w;
 select count(*) into total from public.nam_lessons l where l.course_version_id=v.id and l.workspace_id=w;
 select count(*) into done from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id where l.course_version_id=v.id and l.workspace_id=w and p.user_id=auth.uid();
 result:=jsonb_build_object('id',c.id,'course_id',c.id,'version',v.version,'publication_id',v.id,'title',v.title,'area',v.area,'summary',v.summary,'mandatory',e.mandatory,'published_at',v.published_at,'total',total,'completed',done,
 'completion',case when total>0 and done=total then (select to_jsonb(r)||jsonb_build_object('member_id',r.user_id,'course_id',c.id,'course_version',v.version) from public.nam_course_completions r where r.course_version_id=v.id and r.user_id=auth.uid() and r.workspace_id=w) else null end,
 'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'course_id',c.id,'course_version',v.version,'position',l.position,'title',l.title,'body',l.body,'completed_at',p.completed_at) order by l.position) from public.nam_lessons l left join public.nam_lesson_progress p on p.lesson_id=l.id and p.user_id=auth.uid() where l.course_version_id=v.id and l.workspace_id=w),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'course_id',c.id,'course_version',v.version,'title',a.title,'instructions',a.instructions,'created_at',a.created_at,'submission_id',s.id,'submission_body',s.body,'submission_status',s.status,'submission_revision',s.revision,'submitted_at',s.submitted_at,'reviewed_at',s.reviewed_at,'feedback',s.feedback) order by a.created_at,a.id) from public.nam_academy_assignments a left join public.nam_academy_submissions s on s.assignment_id=a.id and s.user_id=auth.uid() where a.workspace_id=w and a.course_version_id=v.id),'[]'::jsonb));
 result:=result||public.nam_academy_content(w,c.id,v.id);
 result:=jsonb_set(result,'{lessons}',coalesce((select jsonb_agg(item.value||jsonb_build_object('module_id',l.module_id,'module_title',m.title) order by coalesce(m.position,2147483647),l.position) from jsonb_array_elements(result->'lessons') item(value) join public.nam_lessons l on l.id=(item.value->>'id')::uuid and l.workspace_id=w left join public.nam_course_version_modules m on m.id=l.module_id and m.workspace_id=w),'[]'::jsonb));
 return result;
end $$;

create or replace function public.nam_academy_admin_course(w uuid,c_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.nam_courses;
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501';end if;
 select * into c from public.nam_courses t where t.id=c_id and t.workspace_id=w;
 if not found then raise exception 'Course not found' using errcode='P0002';end if;
 return to_jsonb(c)||public.nam_academy_draft_content(w,c.id)||jsonb_build_object('version',coalesce((select max(v.version) from public.nam_course_versions v where v.course_id=c.id and v.workspace_id=w),0),
 'lessons',coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from public.nam_course_draft_lessons l where l.course_id=c.id and l.workspace_id=w),'[]'::jsonb),
 'publications',coalesce((select jsonb_agg(to_jsonb(v) order by v.version desc) from public.nam_course_versions v where v.course_id=c.id and v.workspace_id=w),'[]'::jsonb),
 'enrollments',coalesce((select jsonb_agg(jsonb_build_object('member_id',e.user_id,'course_id',c.id,'course_version',v.version,'mandatory',e.mandatory,'name',coalesce(m.name,e.user_id::text),'role',m.role) order by m.name) from public.nam_enrollments e join public.nam_course_versions v on v.id=e.course_version_id left join public.nam_memberships m on m.workspace_id=w and m.user_id=e.user_id where e.course_id=c.id and e.workspace_id=w and e.revoked_at is null),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(public.nam_academy_assignment(w,a.id) order by a.created_at,a.id) from public.nam_academy_assignments a join public.nam_course_versions v on v.id=a.course_version_id where v.course_id=c.id and a.workspace_id=w),'[]'::jsonb),
 'completion_records',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('member_id',r.user_id,'course_id',c.id,'course_version',v.version,'name',coalesce(m.name,r.user_id::text)) order by r.completed_at desc) from public.nam_course_completions r join public.nam_course_versions v on v.id=r.course_version_id left join public.nam_memberships m on m.workspace_id=w and m.user_id=r.user_id where v.course_id=c.id and r.workspace_id=w),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(z) order by z.id desc) from (select * from public.nam_academy_events a where a.workspace_id=w and a.course_id=c.id order by a.id desc limit 100) z),'[]'::jsonb));
end $$;
commit;
