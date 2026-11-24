-- NAM OS PostgreSQL foundation, not the complete production migration.
-- Run against an empty staging project first. No sample people/client data.
begin;
create table public.nam_workspaces(id uuid primary key default gen_random_uuid(), name text not null);
create table public.nam_memberships(
 workspace_id uuid references public.nam_workspaces(id), user_id uuid references auth.users(id),
 name text not null, role text not null check(role in ('founder','sales_manager','sales','production_manager','artist','freelancer')),
 active boolean not null default true, primary key(workspace_id,user_id));
create index nam_member_user on public.nam_memberships(user_id,workspace_id) where active;

-- Membership roles are provisioned through a trusted administrative path. Never
-- copy role values from raw_user_meta_data or permit self-joining/upgrading.
create function public.nam_role(w uuid) returns text language sql stable security definer set search_path=''
as $$ select m.role from public.nam_memberships m where m.workspace_id=w and m.user_id=(select auth.uid()) and m.active $$;
create function public.nam_founder(w uuid) returns boolean language sql stable security definer set search_path=''
as $$ select coalesce(public.nam_role(w)='founder' and (select auth.jwt()->>'aal')='aal2',false) $$;
create function public.nam_section(w uuid,s text) returns boolean language sql stable security definer set search_path=''
as $$ select coalesce(case public.nam_role(w)
 when 'founder' then s in ('sales','academy','projects','library','team','operations') and (select auth.jwt()->>'aal')='aal2'
 when 'sales_manager' then s in ('sales','academy','operations')
 when 'sales' then s in ('sales','academy','operations')
 when 'production_manager' then s in ('projects','academy','library','operations')
 when 'artist' then s in ('projects','academy','library','operations')
 when 'freelancer' then s in ('projects','academy','library','operations') else false end,false) $$;

create table public.nam_tasks(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.nam_workspaces(id),
 title text not null check(length(trim(title)) between 1 and 200), description text not null default '' check(length(description)<=10000),
 section text not null check(section in ('sales','academy','projects','library','team','operations')),
 status text not null default 'Todo' check(status in ('Backlog','Todo','In progress','Blocked','Done','Canceled')),
 priority text not null default 'Normal' check(priority in ('Low','Normal','High','Urgent')), due_date date,
 owner_id uuid not null, created_by uuid not null references auth.users(id), version integer not null default 1,
 archived boolean not null default false, deleted_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(workspace_id,owner_id) references public.nam_memberships(workspace_id,user_id));
create index nam_task_owner on public.nam_tasks(workspace_id,owner_id,section,due_date) where deleted_at is null;
create table public.nam_task_events(
 id bigint generated always as identity primary key, task_id uuid not null references public.nam_tasks(id),
 actor_id uuid not null references auth.users(id), kind text not null, body jsonb not null, created_at timestamptz not null default now());

alter table public.nam_workspaces enable row level security;
alter table public.nam_memberships enable row level security;
alter table public.nam_tasks enable row level security;
alter table public.nam_task_events enable row level security;
create policy workspaces_read on public.nam_workspaces for select to authenticated using(public.nam_role(id) is not null);
create policy membership_read on public.nam_memberships for select to authenticated using(active and (user_id=(select auth.uid()) or public.nam_founder(workspace_id)));
create policy tasks_read on public.nam_tasks for select to authenticated using(deleted_at is null and public.nam_section(workspace_id,section) and (owner_id=(select auth.uid()) or public.nam_founder(workspace_id)));
create policy task_events_read on public.nam_task_events for select to authenticated using(exists(select 1 from public.nam_tasks t where t.id=task_id));

-- Direct writes are not granted. This function owns field-level authorization,
-- owner eligibility, optimistic versions and trusted audit attribution.
create function public.nam_save_task(w uuid,task_id uuid,expected_version integer,changes jsonb) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
declare old public.nam_tasks; result public.nam_tasks; next_owner uuid; next_section text; next_status text; founder boolean;
begin
 if auth.uid() is null or jsonb_typeof(changes)<>'object' then raise exception 'Access denied' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(changes) as fields(key) where fields.key not in ('title','description','section','owner_id','status','priority','due_date','archived')) then raise exception 'Unsupported field'; end if;
 founder:=public.nam_founder(w);
 if task_id is not null then
  select * into old from public.nam_tasks t where t.id=task_id and t.workspace_id=w and t.deleted_at is null for update;
  if not found or not public.nam_section(w,old.section) or not (founder or old.owner_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
  if expected_version is distinct from old.version then raise exception 'Task changed elsewhere' using errcode='40001'; end if;
 end if;
 next_owner:=coalesce((changes->>'owner_id')::uuid,old.owner_id,auth.uid());
 next_section:=coalesce(changes->>'section',old.section);
 next_status:=coalesce(changes->>'status',old.status,'Todo');
 if not public.nam_section(w,next_section) then raise exception 'Section denied' using errcode='42501'; end if;
 if not founder and (next_owner<>auth.uid() or (old.id is not null and next_section<>old.section)) then raise exception 'Assignment denied' using errcode='42501'; end if;
 if not exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=next_owner and m.active and
  (m.role='founder' or (m.role in ('sales','sales_manager') and next_section in ('sales','academy','operations')) or
  (m.role in ('artist','production_manager','freelancer') and next_section in ('projects','academy','library','operations')))) then raise exception 'Owner ineligible'; end if;
 if old.id is null then
  insert into public.nam_tasks(workspace_id,title,description,section,status,priority,due_date,owner_id,created_by,completed_at)
  values(w,trim(changes->>'title'),coalesce(changes->>'description',''),next_section,next_status,coalesce(changes->>'priority','Normal'),nullif(changes->>'due_date','')::date,next_owner,auth.uid(),case when next_status='Done' then now() end) returning * into result;
 else
  update public.nam_tasks set title=coalesce(trim(changes->>'title'),old.title),description=coalesce(changes->>'description',old.description),section=next_section,owner_id=next_owner,status=next_status,
   priority=coalesce(changes->>'priority',old.priority),due_date=case when changes?'due_date' then nullif(changes->>'due_date','')::date else old.due_date end,
   archived=coalesce((changes->>'archived')::boolean,old.archived),version=old.version+1,updated_at=now(),completed_at=case when next_status='Done' then coalesce(old.completed_at,now()) end
  where id=old.id returning * into result;
 end if;
 insert into public.nam_task_events(task_id,actor_id,kind,body) values(result.id,auth.uid(),case when old.id is null then 'created' else 'updated' end,changes);
 return result;
end $$;

create table public.nam_courses(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),title text not null,area text not null check(area in ('sales','3d','post_production')),archived boolean not null default false,unique(workspace_id,id));
create table public.nam_course_versions(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,course_id uuid not null,version integer not null check(version>0),title text not null,summary text not null default '',published_at timestamptz not null default now(),unique(workspace_id,id),unique(course_id,version),foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id));
create table public.nam_lessons(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,course_version_id uuid not null,title text not null,body text not null,position integer not null check(position>0),unique(workspace_id,id),unique(course_version_id,position),foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id));
create table public.nam_enrollments(workspace_id uuid not null,course_version_id uuid not null,user_id uuid not null,mandatory boolean not null default false,revoked_at timestamptz,primary key(course_version_id,user_id),foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id),foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id));
create table public.nam_lesson_progress(user_id uuid not null references auth.users(id),lesson_id uuid not null references public.nam_lessons(id),completed_at timestamptz not null default now(),primary key(user_id,lesson_id));

alter table public.nam_courses enable row level security;
alter table public.nam_course_versions enable row level security;
alter table public.nam_lessons enable row level security;
alter table public.nam_enrollments enable row level security;
alter table public.nam_lesson_progress enable row level security;
create policy enrollments_read on public.nam_enrollments for select to authenticated using(public.nam_section(workspace_id,'academy') and (user_id=(select auth.uid()) or public.nam_founder(workspace_id)));
create policy versions_read on public.nam_course_versions for select to authenticated using(public.nam_section(workspace_id,'academy') and (public.nam_founder(workspace_id) or exists(select 1 from public.nam_enrollments e where e.course_version_id=id and e.user_id=(select auth.uid()) and e.revoked_at is null)));
create policy courses_read on public.nam_courses for select to authenticated using(public.nam_section(workspace_id,'academy') and (public.nam_founder(workspace_id) or exists(select 1 from public.nam_course_versions v where v.course_id=nam_courses.id)));
create policy lessons_read on public.nam_lessons for select to authenticated using(exists(select 1 from public.nam_course_versions v where v.id=course_version_id));
create policy progress_read on public.nam_lesson_progress for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.nam_lessons l where l.id=lesson_id));

-- Public schema default grants vary by project. Explicitly revoke both roles.
revoke all on public.nam_workspaces,public.nam_memberships,public.nam_tasks,public.nam_task_events,public.nam_courses,public.nam_course_versions,public.nam_lessons,public.nam_enrollments,public.nam_lesson_progress from anon,authenticated;
grant select on public.nam_workspaces,public.nam_memberships,public.nam_tasks,public.nam_task_events,public.nam_courses,public.nam_course_versions,public.nam_lessons,public.nam_enrollments,public.nam_lesson_progress to authenticated;
revoke all on function public.nam_role(uuid),public.nam_founder(uuid),public.nam_section(uuid,text),public.nam_save_task(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.nam_role(uuid),public.nam_founder(uuid),public.nam_section(uuid,text),public.nam_save_task(uuid,uuid,integer,jsonb) to authenticated;
commit;
