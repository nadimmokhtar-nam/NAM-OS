-- Academy subjects and Founder-managed learning paths. Existing areas, course
-- publications, enrollments, completion history and private video are retained.
begin;

create table public.nam_academy_topics(
 code text primary key,title text not null,position integer not null unique);
insert into public.nam_academy_topics(code,title,position) values
 ('interior','Interior',1),('exterior','Exterior',2),
 ('lighting_composition','Lighting & composition',3),('materials_texturing','Materials & texturing',4),
 ('post_production','Post-production',5),('ai_workflows','AI workflows',6),
 ('nam_standards_sops','NAM standards & SOPs',7),('onboarding','Onboarding',8);
create table public.nam_course_topics(
 workspace_id uuid not null,course_id uuid not null,topic text not null references public.nam_academy_topics(code),
 primary key(course_id,topic),foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id) on delete cascade);
create table public.nam_course_version_topics(
 workspace_id uuid not null,course_version_id uuid not null,topic text not null references public.nam_academy_topics(code),
 primary key(course_version_id,topic),foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id));
-- Existing publications are intentionally unclassified. A classification change
-- affects the working copy and is captured on the next explicit publication.
create function public.nam_academy_snapshot_topics() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.nam_course_version_topics(workspace_id,course_version_id,topic)
 select new.workspace_id,new.id,t.topic from public.nam_course_topics t where t.workspace_id=new.workspace_id and t.course_id=new.course_id;
 return new;
end $$;
create trigger nam_academy_snapshot_topics after insert on public.nam_course_versions for each row execute function public.nam_academy_snapshot_topics();

create table public.nam_learning_paths(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),
 title text not null check(length(trim(title)) between 1 and 200),summary text not null default '' check(length(summary)<=3000),
 revision integer not null default 1 check(revision>0),archived boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id));
create table public.nam_learning_path_topics(
 workspace_id uuid not null,path_id uuid not null,topic text not null references public.nam_academy_topics(code),
 primary key(path_id,topic),foreign key(workspace_id,path_id) references public.nam_learning_paths(workspace_id,id));
create table public.nam_learning_path_courses(
 workspace_id uuid not null,path_id uuid not null,course_id uuid not null,course_version_id uuid not null,position integer not null check(position between 1 and 100),
 primary key(path_id,course_id),unique(path_id,position) deferrable initially deferred,
 foreign key(workspace_id,path_id) references public.nam_learning_paths(workspace_id,id),
 foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id));
create table public.nam_learning_path_assignments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,path_id uuid not null,user_id uuid not null,path_revision integer not null,
 title text not null,summary text not null,topics text[] not null default '{}',mandatory boolean not null default false,
 assigned_by uuid not null references auth.users(id),assigned_at timestamptz not null default now(),revoked_at timestamptz,
 unique(workspace_id,id),foreign key(workspace_id,path_id) references public.nam_learning_paths(workspace_id,id),
 foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id));
create unique index nam_learning_path_one_assignment on public.nam_learning_path_assignments(workspace_id,path_id,user_id) where revoked_at is null;
create index nam_learning_path_member on public.nam_learning_path_assignments(workspace_id,user_id,assigned_at desc,id) where revoked_at is null;
create table public.nam_learning_path_assignment_courses(
 workspace_id uuid not null,assignment_id uuid not null,course_id uuid not null,course_version_id uuid not null,position integer not null,
 primary key(assignment_id,course_id),unique(assignment_id,position),
 foreign key(workspace_id,assignment_id) references public.nam_learning_path_assignments(workspace_id,id),
 foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id));
create table public.nam_learning_path_events(
 id bigint generated always as identity primary key,workspace_id uuid not null,path_id uuid,assignment_id uuid,
 actor_id uuid not null references auth.users(id),kind text not null,detail jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(workspace_id,path_id) references public.nam_learning_paths(workspace_id,id),
 foreign key(workspace_id,assignment_id) references public.nam_learning_path_assignments(workspace_id,id));
create table public.nam_learning_path_commands(
 workspace_id uuid not null references public.nam_workspaces(id),command_key uuid not null,actor_id uuid not null references auth.users(id),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(workspace_id,command_key));

alter table public.nam_academy_topics enable row level security;
alter table public.nam_course_topics enable row level security;
alter table public.nam_course_version_topics enable row level security;
alter table public.nam_learning_paths enable row level security;
alter table public.nam_learning_path_topics enable row level security;
alter table public.nam_learning_path_courses enable row level security;
alter table public.nam_learning_path_assignments enable row level security;
alter table public.nam_learning_path_assignment_courses enable row level security;
alter table public.nam_learning_path_events enable row level security;
alter table public.nam_learning_path_commands enable row level security;
create policy academy_subject_read on public.nam_academy_topics for select to authenticated using(exists(select 1 from public.nam_memberships m where m.user_id=auth.uid() and public.nam_section(m.workspace_id,'academy')));
create policy academy_subject_draft_read on public.nam_course_topics for select to authenticated using(public.nam_founder(workspace_id));
create policy academy_subject_publication_read on public.nam_course_version_topics for select to authenticated using(exists(select 1 from public.nam_course_versions v where v.id=course_version_id and v.workspace_id=nam_course_version_topics.workspace_id));
create policy learning_path_founder_read on public.nam_learning_paths for select to authenticated using(public.nam_founder(workspace_id));
create policy learning_path_topic_founder_read on public.nam_learning_path_topics for select to authenticated using(public.nam_founder(workspace_id));
create policy learning_path_course_founder_read on public.nam_learning_path_courses for select to authenticated using(public.nam_founder(workspace_id));
create policy learning_assignment_read on public.nam_learning_path_assignments for select to authenticated using(public.nam_section(workspace_id,'academy') and (public.nam_founder(workspace_id) or (user_id=auth.uid() and revoked_at is null)));
create policy learning_assignment_course_read on public.nam_learning_path_assignment_courses for select to authenticated using(exists(select 1 from public.nam_learning_path_assignments a where a.id=assignment_id and a.workspace_id=nam_learning_path_assignment_courses.workspace_id));
create policy learning_path_event_read on public.nam_learning_path_events for select to authenticated using(public.nam_founder(workspace_id));
-- Commands have no client read/write policy. Only the transaction below can
-- inspect them; retries still require a current, managed Founder session.

-- Private DTO builder. Progress is valid only for the exact still-active course
-- enrollment. No synthetic completions, cross-version credit or practical-work
-- approvals are written by a path operation.
create function public.nam_learning_path_assignment_data(w uuid,a_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(a)||jsonb_build_object('member_id',a.user_id,'member_name',m.name,
 'courses',coalesce((select jsonb_agg(to_jsonb(z) order by z.position) from (
  select i.course_id,i.course_version_id as publication_id,i.position,v.version,v.title,v.area,
   coalesce((select jsonb_agg(t.topic order by t.topic) from public.nam_course_version_topics t where t.workspace_id=w and t.course_version_id=v.id),'[]'::jsonb) as topics,
   case when c.archived then 'course_archived' when e.course_version_id is null then 'enrollment_missing' when e.course_version_id<>v.id then 'enrollment_changed' else 'available' end as access_status,
   (select count(*) from public.nam_lessons l where l.workspace_id=w and l.course_version_id=v.id) as total,
   case when not c.archived and e.course_version_id=v.id then (select count(*) from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id and l.workspace_id=w where l.course_version_id=v.id and p.user_id=a.user_id and p.workspace_id=w) else 0 end as completed,
   case when not c.archived and e.course_version_id=v.id and exists(select 1 from public.nam_lessons l where l.workspace_id=w and l.course_version_id=v.id) and not exists(select 1 from public.nam_lessons l where l.workspace_id=w and l.course_version_id=v.id and not exists(select 1 from public.nam_lesson_progress p where p.workspace_id=w and p.lesson_id=l.id and p.user_id=a.user_id)) then (select to_jsonb(r) from public.nam_course_completions r where r.workspace_id=w and r.course_version_id=v.id and r.user_id=a.user_id) else null end as completion
  from public.nam_learning_path_assignment_courses i join public.nam_courses c on c.id=i.course_id and c.workspace_id=w join public.nam_course_versions v on v.id=i.course_version_id and v.course_id=i.course_id and v.workspace_id=w
  left join public.nam_enrollments e on e.workspace_id=w and e.course_id=i.course_id and e.user_id=a.user_id and e.revoked_at is null
  where i.workspace_id=w and i.assignment_id=a.id) z),'[]'::jsonb))
 from public.nam_learning_path_assignments a join public.nam_memberships m on m.workspace_id=w and m.user_id=a.user_id where a.id=a_id and a.workspace_id=w
$$;

create function public.nam_academy_topics_list(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.nam_section(w,'academy') then raise exception 'Academy access required' using errcode='42501';end if;
 return jsonb_build_object('topics',(select jsonb_agg(to_jsonb(t) order by t.position) from public.nam_academy_topics t),
 'course_topics',coalesce((select jsonb_object_agg(z.course_id::text,z.topics) from (select e.course_id,coalesce((select jsonb_agg(t.topic order by t.topic) from public.nam_course_version_topics t where t.workspace_id=w and t.course_version_id=e.course_version_id),'[]'::jsonb) as topics from public.nam_enrollments e join public.nam_courses c on c.workspace_id=w and c.id=e.course_id and not c.archived where e.workspace_id=w and e.user_id=auth.uid() and e.revoked_at is null order by e.course_id limit 1000) z),'{}'::jsonb),'course_limit',1000);
end $$;

create function public.nam_learning_paths_list(w uuid,admin_view boolean default false,page_size integer default 50,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;total integer;
begin
 if admin_view is null then raise exception 'Choose a path view' using errcode='22023';end if;
 if not public.nam_section(w,'academy') or (admin_view and not public.nam_founder(w)) then raise exception 'Academy access required' using errcode='42501';end if;
 if page_size is null or page_size<1 or page_size>100 or page_offset is null or page_offset<0 or page_offset>100000 then raise exception 'Invalid page' using errcode='22023';end if;
 if admin_view then
  select count(*) into total from public.nam_learning_paths p where p.workspace_id=w;
  select coalesce(jsonb_agg(to_jsonb(z) order by z.archived,z.title,z.id),'[]'::jsonb) into result from (select p.*,
   coalesce((select jsonb_agg(t.topic order by t.topic) from public.nam_learning_path_topics t where t.workspace_id=w and t.path_id=p.id),'[]'::jsonb) as topics,
   (select count(*) from public.nam_learning_path_courses i where i.workspace_id=w and i.path_id=p.id) as course_count,
   (select count(*) from public.nam_learning_path_assignments a where a.workspace_id=w and a.path_id=p.id and a.revoked_at is null) as assignment_count
   from public.nam_learning_paths p where p.workspace_id=w order by p.archived,p.title,p.id limit page_size offset page_offset) z;
 else
  select count(*) into total from public.nam_learning_path_assignments a where a.workspace_id=w and a.user_id=auth.uid() and a.revoked_at is null;
  select coalesce(jsonb_agg(public.nam_learning_path_assignment_data(w,z.id) order by z.mandatory desc,z.assigned_at,z.id),'[]'::jsonb) into result from (select a.id,a.mandatory,a.assigned_at from public.nam_learning_path_assignments a where a.workspace_id=w and a.user_id=auth.uid() and a.revoked_at is null order by a.mandatory desc,a.assigned_at,a.id limit page_size offset page_offset) z;
 end if;
 return jsonb_build_object('items',result,'total',total,'page_size',page_size,'offset',page_offset,'next_offset',case when page_offset+page_size<total then page_offset+page_size else null end);
end $$;

create function public.nam_learning_path_read(w uuid,p_id uuid,admin_view boolean default false,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;total integer;
begin
 if admin_view is null then raise exception 'Choose a path view' using errcode='22023';end if;
 if not public.nam_section(w,'academy') or (admin_view and not public.nam_founder(w)) then raise exception 'Academy access required' using errcode='42501';end if;
 if page_offset is null or page_offset<0 or page_offset>100000 then raise exception 'Invalid page' using errcode='22023';end if;
 if not admin_view then
  if not exists(select 1 from public.nam_learning_path_assignments a where a.workspace_id=w and a.id=p_id and a.user_id=auth.uid() and a.revoked_at is null) then raise exception 'Assigned path not found' using errcode='P0002';end if;
  return public.nam_learning_path_assignment_data(w,p_id);
 end if;
 select to_jsonb(p)||jsonb_build_object('topics',coalesce((select jsonb_agg(t.topic order by t.topic) from public.nam_learning_path_topics t where t.workspace_id=w and t.path_id=p.id),'[]'::jsonb),
 'courses',coalesce((select jsonb_agg(jsonb_build_object('course_id',i.course_id,'publication_id',v.id,'version',v.version,'title',v.title,'area',v.area,'position',i.position,'archived',c.archived) order by i.position) from public.nam_learning_path_courses i join public.nam_course_versions v on v.id=i.course_version_id and v.workspace_id=w join public.nam_courses c on c.id=i.course_id and c.workspace_id=w where i.workspace_id=w and i.path_id=p.id),'[]'::jsonb)) into result from public.nam_learning_paths p where p.id=p_id and p.workspace_id=w;
 if result is null then raise exception 'Path not found' using errcode='P0002';end if;
 select count(*) into total from public.nam_learning_path_assignments a where a.workspace_id=w and a.path_id=p_id and a.revoked_at is null;
 return result||jsonb_build_object('assignments',coalesce((select jsonb_agg(public.nam_learning_path_assignment_data(w,z.id) order by z.assigned_at desc,z.id) from (select a.id,a.assigned_at from public.nam_learning_path_assignments a where a.workspace_id=w and a.path_id=p_id and a.revoked_at is null order by a.assigned_at desc,a.id limit 50 offset page_offset) z),'[]'::jsonb),'assignment_total',total,'assignment_offset',page_offset,'assignment_next_offset',case when page_offset+50<total then page_offset+50 else null end,
 'events',coalesce((select jsonb_agg(to_jsonb(z) order by z.id desc) from (select e.id,e.kind,e.actor_id,e.assignment_id,e.detail,e.created_at from public.nam_learning_path_events e where e.workspace_id=w and e.path_id=p_id order by e.id desc limit 50) z),'[]'::jsonb));
end $$;

create function public.nam_learning_path_catalog(w uuid,page_size integer default 50,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;total integer;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if page_size is null or page_size<1 or page_size>100 or page_offset is null or page_offset<0 or page_offset>100000 then raise exception 'Invalid page' using errcode='22023';end if;
 select count(*) into total from public.nam_courses c where c.workspace_id=w and not c.archived;
 select coalesce(jsonb_agg(to_jsonb(z) order by z.title,z.id),'[]'::jsonb) into result from (select c.id,c.title,c.area,c.revision,c.publication_status,
  coalesce((select jsonb_agg(t.topic order by t.topic) from public.nam_course_topics t where t.workspace_id=w and t.course_id=c.id),'[]'::jsonb) as topics,
  coalesce((select jsonb_agg(to_jsonb(v) order by v.version desc) from (select v.id,v.version,v.title,v.area,v.published_at,coalesce((select jsonb_agg(t.topic order by t.topic) from public.nam_course_version_topics t where t.workspace_id=w and t.course_version_id=v.id),'[]'::jsonb) as topics from public.nam_course_versions v where v.workspace_id=w and v.course_id=c.id order by v.version desc limit 20) v),'[]'::jsonb) as publications,
  (select count(*)>20 from public.nam_course_versions v where v.workspace_id=w and v.course_id=c.id) as older_publications,
  (select case when count(*)>20 then 20 else null end from public.nam_course_versions v where v.workspace_id=w and v.course_id=c.id) as publication_next_offset
  from public.nam_courses c where c.workspace_id=w and not c.archived order by c.title,c.id limit page_size offset page_offset) z;
 return jsonb_build_object('items',result,'total',total,'page_size',page_size,'offset',page_offset,'next_offset',case when page_offset+page_size<total then page_offset+page_size else null end,'publication_limit',20);
end $$;

create function public.nam_learning_path_publications(w uuid,c_id uuid,page_size integer default 20,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;total integer;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if page_size is null or page_size<1 or page_size>100 or page_offset is null or page_offset<0 or page_offset>100000 then raise exception 'Invalid page' using errcode='22023';end if;
 if not exists(select 1 from public.nam_courses c where c.workspace_id=w and c.id=c_id and not c.archived) then raise exception 'Course not found' using errcode='P0002';end if;
 select count(*) into total from public.nam_course_versions v where v.workspace_id=w and v.course_id=c_id;
 select coalesce(jsonb_agg(to_jsonb(z) order by z.version desc),'[]'::jsonb) into result from (select v.id,v.version,v.title,v.area,v.published_at,
  coalesce((select jsonb_agg(t.topic order by t.topic) from public.nam_course_version_topics t where t.workspace_id=w and t.course_version_id=v.id),'[]'::jsonb) as topics
  from public.nam_course_versions v where v.workspace_id=w and v.course_id=c_id order by v.version desc limit page_size offset page_offset) z;
 return jsonb_build_object('items',result,'total',total,'page_size',page_size,'offset',page_offset,'next_offset',case when page_offset+page_size<total then page_offset+page_size else null end);
end $$;

create function public.nam_learning_path_command(w uuid,op text,p_id uuid,expected_revision integer,changes jsonb,command_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.nam_learning_paths;c public.nam_courses;v public.nam_course_versions;a public.nam_learning_path_assignments;previous public.nam_learning_path_commands;
 payload jsonb;result jsonb;allowed text[];topics text[];item jsonb;ids uuid[];n integer;i integer;learner uuid;assignment_id uuid;key_id uuid:=command_key;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 -- Serialize access administration with this mutation and recheck the same
 -- managed session/optional-MFA policy after acquiring its membership lock.
 perform 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=auth.uid() for share;
 if not public.nam_founder(w) then raise exception 'Founder access changed' using errcode='42501';end if;
 if key_id is null or p_id is null then raise exception 'A command and record identifier are required' using errcode='22023';end if;
 allowed:=case op when 'create' then array['title','summary','topics','courses'] when 'edit' then array['title','summary','topics','courses'] when 'archive' then array['archived'] when 'assign' then array['member_id','mandatory'] when 'revoke' then array['assignment_id'] when 'classify' then array['topics'] else null end;
 if allowed is null or not public.nam_academy_keys(changes,allowed) then raise exception 'Unsupported learning path fields' using errcode='22023';end if;
 payload:=jsonb_build_object('op',op,'id',p_id,'revision',expected_revision,'changes',changes);
 -- Transaction-scoped command lock makes concurrent/lost-response retries
 -- deterministic. Reusing a key for a different payload never repeats effects.
 perform pg_advisory_xact_lock(hashtextextended(w::text||':'||key_id::text,0));
 select * into previous from public.nam_learning_path_commands x where x.workspace_id=w and x.command_key=key_id;
 if found then
  if previous.actor_id<>auth.uid() or previous.payload<>payload then raise exception 'This request key was already used for another change.' using errcode='40001';end if;
  return previous.result;
 end if;
 if op='classify' then
  select * into c from public.nam_courses x where x.workspace_id=w and x.id=p_id for update;
  if not found then raise exception 'Course not found' using errcode='P0002';end if;
  if c.revision is distinct from expected_revision then raise exception 'The course changed. Reload before classifying it.' using errcode='40001';end if;
  if c.archived then raise exception 'Restore the course before editing its subjects.' using errcode='22023';end if;
 else
  if op='create' then
   if expected_revision is not null then raise exception 'New paths have no revision.' using errcode='22023';end if;
   if (select count(*) from public.nam_learning_paths x where x.workspace_id=w)>=1000 then raise exception 'This workspace already has 1000 learning paths.' using errcode='22023';end if;
   insert into public.nam_learning_paths(id,workspace_id,title,summary,created_by) values(p_id,w,trim(changes->>'title'),coalesce(changes->>'summary',''),auth.uid()) returning * into p;
  else
   select * into p from public.nam_learning_paths x where x.workspace_id=w and x.id=p_id for update;
   if not found then raise exception 'Path not found' using errcode='P0002';end if;
   if p.revision is distinct from expected_revision then raise exception 'The path changed. Reload before saving or assigning it.' using errcode='40001';end if;
  end if;
 end if;
 if op in ('create','edit','classify') then
  if jsonb_typeof(changes->'topics') is distinct from 'array' or jsonb_array_length(changes->'topics')>8 then raise exception 'Choose up to eight Academy subjects.' using errcode='22023';end if;
  select coalesce(array_agg(x),array[]::text[]) into topics from jsonb_array_elements_text(changes->'topics') x;
  if cardinality(topics)<>(select count(distinct x) from unnest(topics) x) or exists(select 1 from unnest(topics) x where not exists(select 1 from public.nam_academy_topics t where t.code=x)) then raise exception 'Choose each Academy subject once.' using errcode='22023';end if;
 end if;
 if op='classify' then
  delete from public.nam_course_topics t where t.workspace_id=w and t.course_id=c.id;
  insert into public.nam_course_topics(workspace_id,course_id,topic) select w,c.id,x from unnest(topics) x;
  update public.nam_courses set revision=revision+1,publication_status='draft',updated_at=now() where id=c.id and workspace_id=w returning * into c;
  result:=jsonb_build_object('id',c.id,'revision',c.revision,'topics',to_jsonb(topics));
 elsif op in ('create','edit') then
  if jsonb_typeof(changes->'title') is distinct from 'string' or (changes?'summary' and jsonb_typeof(changes->'summary')<>'string') or jsonb_typeof(changes->'courses') is distinct from 'array' or jsonb_array_length(changes->'courses')>100 then raise exception 'Provide a title and up to 100 published courses.' using errcode='22023';end if;
  if p.archived then raise exception 'Restore the path before editing it.' using errcode='22023';end if;
  select coalesce(array_agg((x->>'course_id')::uuid),array[]::uuid[]) into ids from jsonb_array_elements(changes->'courses') x;
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Include each course once.' using errcode='22023';end if;
  -- Publication identity is always explicit. Latest is never inferred.
  for item in select value from jsonb_array_elements(changes->'courses') loop
   if not public.nam_academy_keys(item,array['course_id','publication_id']) or not item?'course_id' or not item?'publication_id' then raise exception 'Provide an exact course publication.' using errcode='22023';end if;
   if not exists(select 1 from public.nam_course_versions z join public.nam_courses x on x.workspace_id=w and x.id=z.course_id and not x.archived where z.workspace_id=w and z.course_id=(item->>'course_id')::uuid and z.id=(item->>'publication_id')::uuid) then raise exception 'A selected publication is unavailable. Reload the course choices.' using errcode='22023';end if;
  end loop;
  delete from public.nam_learning_path_courses x where x.workspace_id=w and x.path_id=p.id;
  i:=0;for item in select value from jsonb_array_elements(changes->'courses') loop
   i:=i+1;insert into public.nam_learning_path_courses(workspace_id,path_id,course_id,course_version_id,position) values(w,p.id,(item->>'course_id')::uuid,(item->>'publication_id')::uuid,i);
  end loop;
  delete from public.nam_learning_path_topics x where x.workspace_id=w and x.path_id=p.id;
  insert into public.nam_learning_path_topics(workspace_id,path_id,topic) select w,p.id,x from unnest(topics) x;
  update public.nam_learning_paths set title=trim(changes->>'title'),summary=coalesce(changes->>'summary',''),revision=revision+case when op='create' then 0 else 1 end,updated_at=now() where id=p.id and workspace_id=w returning * into p;
  result:=jsonb_build_object('id',p.id,'revision',p.revision);
 elsif op='archive' then
  if jsonb_typeof(changes->'archived') is distinct from 'boolean' then raise exception 'Choose an archive state.' using errcode='22023';end if;
  update public.nam_learning_paths set archived=(changes->>'archived')::boolean,revision=revision+1,updated_at=now() where id=p.id and workspace_id=w returning * into p;
  result:=jsonb_build_object('id',p.id,'revision',p.revision,'archived',p.archived);
 elsif op='assign' then
  if p.archived then raise exception 'Restore the path before assigning it.' using errcode='22023';end if;
  if jsonb_typeof(changes->'member_id') is distinct from 'string' or (changes?'mandatory' and jsonb_typeof(changes->'mandatory')<>'boolean') then raise exception 'Choose a studio member and required state.' using errcode='22023';end if;
  learner:=(changes->>'member_id')::uuid;
  perform 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=learner for share;
  perform 1 from public.nam_section_grants g where g.workspace_id=w and g.user_id=learner and g.section='academy' for share;
  if not public.nam_member_section(w,learner,'academy') then raise exception 'This member has no current Academy access.' using errcode='42501';end if;
  if exists(select 1 from public.nam_learning_path_assignments x where x.workspace_id=w and x.path_id=p.id and x.user_id=learner and x.revoked_at is null) then raise exception 'This learner already has this path. Revoke the existing path before assigning a new revision.' using errcode='40001';end if;
  select count(*) into n from public.nam_learning_path_courses x where x.workspace_id=w and x.path_id=p.id;
  if n=0 then raise exception 'Add a published course before assigning the path.' using errcode='22023';end if;
  -- The same locks used by native course enrollment prevent a concurrent edit
  -- from switching a publication between the conflict check and enrollment.
  perform 1 from public.nam_courses x where x.workspace_id=w and x.id in(select i.course_id from public.nam_learning_path_courses i where i.workspace_id=w and i.path_id=p.id) order by x.id for update;
  if exists(select 1 from public.nam_learning_path_courses i join public.nam_courses x on x.id=i.course_id and x.workspace_id=w where i.workspace_id=w and i.path_id=p.id and x.archived) then raise exception 'A course in this path is archived. Update the path first.' using errcode='40001';end if;
  if exists(select 1 from public.nam_learning_path_courses i join public.nam_enrollments e on e.workspace_id=w and e.course_id=i.course_id and e.user_id=learner and e.revoked_at is null where i.workspace_id=w and i.path_id=p.id and e.course_version_id<>i.course_version_id) then raise exception 'This learner is enrolled in a different course publication. Review that enrollment explicitly before assigning this path; existing enrollment and progress were retained.' using errcode='40001';end if;
  insert into public.nam_learning_path_assignments(workspace_id,path_id,user_id,path_revision,title,summary,topics,mandatory,assigned_by)
   values(w,p.id,learner,p.revision,p.title,p.summary,coalesce((select array_agg(t.topic order by t.topic) from public.nam_learning_path_topics t where t.workspace_id=w and t.path_id=p.id),'{}'),coalesce((changes->>'mandatory')::boolean,false),auth.uid()) returning id into assignment_id;
  insert into public.nam_learning_path_assignment_courses(workspace_id,assignment_id,course_id,course_version_id,position) select w,assignment_id,i.course_id,i.course_version_id,i.position from public.nam_learning_path_courses i where i.workspace_id=w and i.path_id=p.id;
  for item in select jsonb_build_object('course_id',i.course_id,'version',v.version,'mandatory',coalesce(e.mandatory,false) or coalesce((changes->>'mandatory')::boolean,false)) from public.nam_learning_path_courses i join public.nam_course_versions v on v.id=i.course_version_id and v.course_id=i.course_id and v.workspace_id=w left join public.nam_enrollments e on e.workspace_id=w and e.course_id=i.course_id and e.user_id=learner and e.revoked_at is null where i.workspace_id=w and i.path_id=p.id order by i.course_id loop
   perform public.nam_academy_admin(w,'enroll',(item->>'course_id')::uuid,null,jsonb_build_object('member_id',learner,'course_version',(item->>'version')::integer,'mandatory',(item->>'mandatory')::boolean));
  end loop;
  result:=jsonb_build_object('id',p.id,'revision',p.revision,'assignment_id',assignment_id,'member_id',learner);
 elsif op='revoke' then
  if jsonb_typeof(changes->'assignment_id') is distinct from 'string' then raise exception 'Choose a path assignment.' using errcode='22023';end if;
  update public.nam_learning_path_assignments x set revoked_at=now() where x.workspace_id=w and x.path_id=p.id and x.id=(changes->>'assignment_id')::uuid and x.revoked_at is null returning * into a;
  if not found then raise exception 'Active path assignment not found' using errcode='P0002';end if;
  assignment_id:=a.id;
  -- Course enrollments can also serve another path or a direct assignment.
  -- Removing a path never revokes those independent access records.
  result:=jsonb_build_object('id',p.id,'assignment_id',a.id,'revoked',true);
 end if;
 insert into public.nam_learning_path_events(workspace_id,path_id,assignment_id,actor_id,kind,detail) values(w,case when op='classify' then null else p.id end,assignment_id,auth.uid(),op,result);
 insert into public.nam_learning_path_commands(workspace_id,command_key,actor_id,payload,result) values(w,key_id,auth.uid(),payload,result);
 return result;
end $$;

revoke all on public.nam_academy_topics,public.nam_course_topics,public.nam_course_version_topics,public.nam_learning_paths,public.nam_learning_path_topics,public.nam_learning_path_courses,public.nam_learning_path_assignments,public.nam_learning_path_assignment_courses,public.nam_learning_path_events,public.nam_learning_path_commands from public,anon,authenticated;
grant select on public.nam_academy_topics,public.nam_course_topics,public.nam_course_version_topics,public.nam_learning_paths,public.nam_learning_path_topics,public.nam_learning_path_courses,public.nam_learning_path_assignments,public.nam_learning_path_assignment_courses,public.nam_learning_path_events to authenticated;
revoke all on function public.nam_academy_snapshot_topics(),public.nam_learning_path_assignment_data(uuid,uuid),public.nam_academy_topics_list(uuid),public.nam_learning_paths_list(uuid,boolean,integer,integer),public.nam_learning_path_read(uuid,uuid,boolean,integer),public.nam_learning_path_catalog(uuid,integer,integer),public.nam_learning_path_publications(uuid,uuid,integer,integer),public.nam_learning_path_command(uuid,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.nam_academy_topics_list(uuid),public.nam_learning_paths_list(uuid,boolean,integer,integer),public.nam_learning_path_read(uuid,uuid,boolean,integer),public.nam_learning_path_catalog(uuid,integer,integer),public.nam_learning_path_publications(uuid,uuid,integer,integer),public.nam_learning_path_command(uuid,text,uuid,integer,jsonb,uuid) to authenticated;
commit;
