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
   case when not c.archived and e.course_version_id=v.id then (select count(*) from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id and l.workspace_id=w where l.course_version_id=v.id and p.user_id=a.user_id) else 0 end as completed,
   case when not c.archived and e.course_version_id=v.id and exists(select 1 from public.nam_lessons l where l.workspace_id=w and l.course_version_id=v.id) and not exists(select 1 from public.nam_lessons l where l.workspace_id=w and l.course_version_id=v.id and not exists(select 1 from public.nam_lesson_progress p where p.lesson_id=l.id and p.user_id=a.user_id)) then (select to_jsonb(r) from public.nam_course_completions r where r.workspace_id=w and r.course_version_id=v.id and r.user_id=a.user_id) else null end as completion
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
declare
 p_workspace alias for $1;p_operation alias for $2;p_path_id alias for $3;
 p_expected_revision alias for $4;p_changes alias for $5;p_command_key alias for $6;
 v_path public.nam_learning_paths;v_course public.nam_courses;v_assignment public.nam_learning_path_assignments;v_previous public.nam_learning_path_commands;
 v_payload jsonb;v_result jsonb;v_allowed text[];v_topics text[];v_item jsonb;v_course_ids uuid[];v_count integer;v_position integer;v_learner_id uuid;v_assignment_id uuid;v_command_key uuid:=p_command_key;
begin
 -- Share the task/access administration lock order before any business lock.
 -- This pins the exact active membership, account and JWT session through commit.
 perform public.nam_task_schedule_lock(p_workspace);
 if not public.nam_founder(p_workspace) then raise exception 'Founder access required' using errcode='42501';end if;
 if v_command_key is null or p_path_id is null then raise exception 'A command and record identifier are required' using errcode='22023';end if;
 v_allowed:=case p_operation when 'create' then array['title','summary','topics','courses'] when 'edit' then array['title','summary','topics','courses'] when 'archive' then array['archived'] when 'assign' then array['member_id','mandatory'] when 'revoke' then array['assignment_id'] when 'classify' then array['topics'] else null end;
 if v_allowed is null or not public.nam_academy_keys(p_changes,v_allowed) then raise exception 'Unsupported learning path fields' using errcode='22023';end if;
 v_payload:=jsonb_build_object('op',p_operation,'id',p_path_id,'revision',p_expected_revision,'changes',p_changes);
 -- Transaction-scoped command lock makes concurrent/lost-response retries
 -- deterministic. Reusing a key for a different payload never repeats effects.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||':'||v_command_key::text,0));
 if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
 select * into v_previous from public.nam_learning_path_commands q_x where q_x.workspace_id=p_workspace and q_x.command_key=v_command_key;
 if found then
  if v_previous.actor_id<>auth.uid() or v_previous.payload<>v_payload then raise exception 'This request key was already used for another change.' using errcode='40001';end if;
  if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
  return v_previous.result;
 end if;
 if p_operation='classify' then
  select * into v_course from public.nam_courses q_x where q_x.workspace_id=p_workspace and q_x.id=p_path_id for update;
  if not found then raise exception 'Course not found' using errcode='P0002';end if;
  if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
  if v_course.revision is distinct from p_expected_revision then raise exception 'The course changed. Reload before classifying it.' using errcode='40001';end if;
  if v_course.archived then raise exception 'Restore the course before editing its subjects.' using errcode='22023';end if;
 else
  if p_operation='create' then
   if p_expected_revision is not null then raise exception 'New paths have no revision.' using errcode='22023';end if;
   if (select count(*) from public.nam_learning_paths q_x where q_x.workspace_id=p_workspace)>=1000 then raise exception 'This workspace already has 1000 learning paths.' using errcode='22023';end if;
   insert into public.nam_learning_paths(id,workspace_id,title,summary,created_by) values(p_path_id,p_workspace,trim(p_changes->>'title'),coalesce(p_changes->>'summary',''),auth.uid()) returning * into v_path;
   if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
  else
   select * into v_path from public.nam_learning_paths q_x where q_x.workspace_id=p_workspace and q_x.id=p_path_id for update;
   if not found then raise exception 'Path not found' using errcode='P0002';end if;
   if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
   if v_path.revision is distinct from p_expected_revision then raise exception 'The path changed. Reload before saving or assigning it.' using errcode='40001';end if;
  end if;
 end if;
 if p_operation in ('create','edit','classify') then
  if jsonb_typeof(p_changes->'topics') is distinct from 'array' or jsonb_array_length(p_changes->'topics')>8 then raise exception 'Choose up to eight Academy subjects.' using errcode='22023';end if;
  select coalesce(array_agg(q_x),array[]::text[]) into v_topics from jsonb_array_elements_text(p_changes->'topics') q_x;
  if cardinality(v_topics)<>(select count(distinct q_x) from unnest(v_topics) q_x) or exists(select 1 from unnest(v_topics) q_x where not exists(select 1 from public.nam_academy_topics q_t where q_t.code=q_x)) then raise exception 'Choose each Academy subject once.' using errcode='22023';end if;
 end if;
 if p_operation='classify' then
  delete from public.nam_course_topics q_t where q_t.workspace_id=p_workspace and q_t.course_id=v_course.id;
  insert into public.nam_course_topics(workspace_id,course_id,topic) select p_workspace,v_course.id,q_x from unnest(v_topics) q_x;
  update public.nam_courses set revision=revision+1,publication_status='draft',updated_at=now() where id=v_course.id and workspace_id=p_workspace returning * into v_course;
  v_result:=jsonb_build_object('id',v_course.id,'revision',v_course.revision,'topics',to_jsonb(v_topics));
 elsif p_operation in ('create','edit') then
  if jsonb_typeof(p_changes->'title') is distinct from 'string' or (p_changes?'summary' and jsonb_typeof(p_changes->'summary')<>'string') or jsonb_typeof(p_changes->'courses') is distinct from 'array' or jsonb_array_length(p_changes->'courses')>100 then raise exception 'Provide a title and up to 100 published courses.' using errcode='22023';end if;
  if v_path.archived then raise exception 'Restore the path before editing it.' using errcode='22023';end if;
  select coalesce(array_agg((q_x->>'course_id')::uuid),array[]::uuid[]) into v_course_ids from jsonb_array_elements(p_changes->'courses') q_x;
  if cardinality(v_course_ids)<>(select count(distinct q_x) from unnest(v_course_ids) q_x) then raise exception 'Include each course once.' using errcode='22023';end if;
  -- Publication identity is always explicit. Latest is never inferred.
  for v_item in select value from jsonb_array_elements(p_changes->'courses') loop
   if not public.nam_academy_keys(v_item,array['course_id','publication_id']) or not v_item?'course_id' or not v_item?'publication_id' then raise exception 'Provide an exact course publication.' using errcode='22023';end if;
   if not exists(select 1 from public.nam_course_versions q_z join public.nam_courses q_x on q_x.workspace_id=p_workspace and q_x.id=q_z.course_id and not q_x.archived where q_z.workspace_id=p_workspace and q_z.course_id=(v_item->>'course_id')::uuid and q_z.id=(v_item->>'publication_id')::uuid) then raise exception 'A selected publication is unavailable. Reload the course choices.' using errcode='22023';end if;
  end loop;
  delete from public.nam_learning_path_courses q_x where q_x.workspace_id=p_workspace and q_x.path_id=v_path.id;
  v_position:=0;for v_item in select value from jsonb_array_elements(p_changes->'courses') loop
   v_position:=v_position+1;insert into public.nam_learning_path_courses(workspace_id,path_id,course_id,course_version_id,position) values(p_workspace,v_path.id,(v_item->>'course_id')::uuid,(v_item->>'publication_id')::uuid,v_position);
  end loop;
  delete from public.nam_learning_path_topics q_x where q_x.workspace_id=p_workspace and q_x.path_id=v_path.id;
  insert into public.nam_learning_path_topics(workspace_id,path_id,topic) select p_workspace,v_path.id,q_x from unnest(v_topics) q_x;
  update public.nam_learning_paths set title=trim(p_changes->>'title'),summary=coalesce(p_changes->>'summary',''),revision=revision+case when p_operation='create' then 0 else 1 end,updated_at=now() where id=v_path.id and workspace_id=p_workspace returning * into v_path;
  v_result:=jsonb_build_object('id',v_path.id,'revision',v_path.revision);
 elsif p_operation='archive' then
  if jsonb_typeof(p_changes->'archived') is distinct from 'boolean' then raise exception 'Choose an archive state.' using errcode='22023';end if;
  update public.nam_learning_paths set archived=(p_changes->>'archived')::boolean,revision=revision+1,updated_at=now() where id=v_path.id and workspace_id=p_workspace returning * into v_path;
  v_result:=jsonb_build_object('id',v_path.id,'revision',v_path.revision,'archived',v_path.archived);
 elsif p_operation='assign' then
  if v_path.archived then raise exception 'Restore the path before assigning it.' using errcode='22023';end if;
  if jsonb_typeof(p_changes->'member_id') is distinct from 'string' or (p_changes?'mandatory' and jsonb_typeof(p_changes->'mandatory')<>'boolean') then raise exception 'Choose a studio member and required state.' using errcode='22023';end if;
  v_learner_id:=(p_changes->>'member_id')::uuid;
  perform 1 from public.nam_memberships q_m where q_m.workspace_id=p_workspace and q_m.user_id=v_learner_id for share;
  perform 1 from public.nam_section_grants q_g where q_g.workspace_id=p_workspace and q_g.user_id=v_learner_id and q_g.section='academy' for share;
  if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
  if not public.nam_member_section(p_workspace,v_learner_id,'academy') then raise exception 'This member has no current Academy access.' using errcode='42501';end if;
  if exists(select 1 from public.nam_learning_path_assignments q_x where q_x.workspace_id=p_workspace and q_x.path_id=v_path.id and q_x.user_id=v_learner_id and q_x.revoked_at is null) then raise exception 'This learner already has this path. Revoke the existing path before assigning a new revision.' using errcode='40001';end if;
  select count(*) into v_count from public.nam_learning_path_courses q_x where q_x.workspace_id=p_workspace and q_x.path_id=v_path.id;
  if v_count=0 then raise exception 'Add a published course before assigning the path.' using errcode='22023';end if;
  -- The same locks used by native course enrollment prevent a concurrent edit
  -- from switching a publication between the conflict check and enrollment.
  perform 1 from public.nam_courses q_x where q_x.workspace_id=p_workspace and q_x.id in(select q_path_course.course_id from public.nam_learning_path_courses q_path_course where q_path_course.workspace_id=p_workspace and q_path_course.path_id=v_path.id) order by q_x.id for update;
  if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
  if exists(select 1 from public.nam_learning_path_courses q_path_course join public.nam_courses q_x on q_x.id=q_path_course.course_id and q_x.workspace_id=p_workspace where q_path_course.workspace_id=p_workspace and q_path_course.path_id=v_path.id and q_x.archived) then raise exception 'A course in this path is archived. Update the path first.' using errcode='40001';end if;
  if exists(select 1 from public.nam_learning_path_courses q_path_course join public.nam_enrollments q_e on q_e.workspace_id=p_workspace and q_e.course_id=q_path_course.course_id and q_e.user_id=v_learner_id and q_e.revoked_at is null where q_path_course.workspace_id=p_workspace and q_path_course.path_id=v_path.id and q_e.course_version_id<>q_path_course.course_version_id) then raise exception 'This learner is enrolled in a different course publication. Review that enrollment explicitly before assigning this path; existing enrollment and progress were retained.' using errcode='40001';end if;
  insert into public.nam_learning_path_assignments(workspace_id,path_id,user_id,path_revision,title,summary,topics,mandatory,assigned_by)
   values(p_workspace,v_path.id,v_learner_id,v_path.revision,v_path.title,v_path.summary,coalesce((select array_agg(q_t.topic order by q_t.topic) from public.nam_learning_path_topics q_t where q_t.workspace_id=p_workspace and q_t.path_id=v_path.id),'{}'),coalesce((p_changes->>'mandatory')::boolean,false),auth.uid()) returning id into v_assignment_id;
  insert into public.nam_learning_path_assignment_courses(workspace_id,assignment_id,course_id,course_version_id,position) select p_workspace,v_assignment_id,q_path_course.course_id,q_path_course.course_version_id,q_path_course.position from public.nam_learning_path_courses q_path_course where q_path_course.workspace_id=p_workspace and q_path_course.path_id=v_path.id;
  for v_item in select jsonb_build_object('course_id',q_path_course.course_id,'version',q_v.version,'mandatory',coalesce(q_e.mandatory,false) or coalesce((p_changes->>'mandatory')::boolean,false)) from public.nam_learning_path_courses q_path_course join public.nam_course_versions q_v on q_v.id=q_path_course.course_version_id and q_v.course_id=q_path_course.course_id and q_v.workspace_id=p_workspace left join public.nam_enrollments q_e on q_e.workspace_id=p_workspace and q_e.course_id=q_path_course.course_id and q_e.user_id=v_learner_id and q_e.revoked_at is null where q_path_course.workspace_id=p_workspace and q_path_course.path_id=v_path.id order by q_path_course.course_id loop
   perform public.nam_academy_admin(p_workspace,'enroll',(v_item->>'course_id')::uuid,null,jsonb_build_object('member_id',v_learner_id,'course_version',(v_item->>'version')::integer,'mandatory',(v_item->>'mandatory')::boolean));
  end loop;
  v_result:=jsonb_build_object('id',v_path.id,'revision',v_path.revision,'assignment_id',v_assignment_id,'member_id',v_learner_id);
 elsif p_operation='revoke' then
  if jsonb_typeof(p_changes->'assignment_id') is distinct from 'string' then raise exception 'Choose a path assignment.' using errcode='22023';end if;
  update public.nam_learning_path_assignments q_x set revoked_at=now() where q_x.workspace_id=p_workspace and q_x.path_id=v_path.id and q_x.id=(p_changes->>'assignment_id')::uuid and q_x.revoked_at is null returning * into v_assignment;
  if not found then raise exception 'Active path assignment not found' using errcode='P0002';end if;
  if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
  v_assignment_id:=v_assignment.id;
  -- Course enrollments can also serve another path or a direct assignment.
  -- Removing a path never revokes those independent access records.
  v_result:=jsonb_build_object('id',v_path.id,'assignment_id',v_assignment.id,'revoked',true);
 end if;
 if not public.nam_founder(p_workspace) then raise exception 'Founder access changed' using errcode='42501';end if;
 insert into public.nam_learning_path_events(workspace_id,path_id,assignment_id,actor_id,kind,detail) values(p_workspace,case when p_operation='classify' then null else v_path.id end,v_assignment_id,auth.uid(),p_operation,v_result);
 insert into public.nam_learning_path_commands(workspace_id,command_key,actor_id,payload,result) values(p_workspace,v_command_key,auth.uid(),v_payload,v_result);
 return v_result;
end $$;

revoke all on public.nam_academy_topics,public.nam_course_topics,public.nam_course_version_topics,public.nam_learning_paths,public.nam_learning_path_topics,public.nam_learning_path_courses,public.nam_learning_path_assignments,public.nam_learning_path_assignment_courses,public.nam_learning_path_events,public.nam_learning_path_commands from public,anon,authenticated;
grant select on public.nam_academy_topics,public.nam_course_topics,public.nam_course_version_topics,public.nam_learning_paths,public.nam_learning_path_topics,public.nam_learning_path_courses,public.nam_learning_path_assignments,public.nam_learning_path_assignment_courses,public.nam_learning_path_events to authenticated;
revoke all on function public.nam_academy_snapshot_topics(),public.nam_learning_path_assignment_data(uuid,uuid),public.nam_academy_topics_list(uuid),public.nam_learning_paths_list(uuid,boolean,integer,integer),public.nam_learning_path_read(uuid,uuid,boolean,integer),public.nam_learning_path_catalog(uuid,integer,integer),public.nam_learning_path_publications(uuid,uuid,integer,integer),public.nam_learning_path_command(uuid,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.nam_academy_topics_list(uuid),public.nam_learning_paths_list(uuid,boolean,integer,integer),public.nam_learning_path_read(uuid,uuid,boolean,integer),public.nam_learning_path_catalog(uuid,integer,integer),public.nam_learning_path_publications(uuid,uuid,integer,integer),public.nam_learning_path_command(uuid,text,uuid,integer,jsonb,uuid) to authenticated;
commit;
