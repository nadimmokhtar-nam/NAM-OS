-- Additive production records. Existing tasks, dates, permissions and history
-- remain authoritative. Explicit project membership shares only the brief;
-- it never grants access to another artist's task or private attachments.
begin;
create table public.nam_projects (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.nam_workspaces(id),
 title text not null check(length(trim(title)) between 1 and 200),
 brief text not null default '' check(length(brief)<=10000),
 outcome text not null default '' check(length(outcome)<=5000),
 reference_url text not null default '' check(length(reference_url)<=2000 and (reference_url='' or reference_url ~ '^https://[^[:space:]]+$')),
 due_date date check(due_date is null or due_date between date '0001-01-01' and date '9999-12-31'),
 lead_id uuid not null, version integer not null default 1 check(version>0),
 archived boolean not null default false,
 created_by uuid not null references auth.users(id),
 request_key text, create_payload jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,created_by,request_key),
 foreign key(workspace_id,lead_id) references public.nam_memberships(workspace_id,user_id)
);
create table public.nam_project_members (
 workspace_id uuid not null, project_id uuid not null, user_id uuid not null,
 primary key(project_id,user_id),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id),
 foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id)
);
create index nam_project_member_user on public.nam_project_members(workspace_id,user_id,project_id);
create table public.nam_project_events (
 id bigint generated always as identity primary key,
 workspace_id uuid not null, project_id uuid not null,
 actor_id uuid not null references auth.users(id),
 version integer not null, changes jsonb not null, created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id)
);

create function public.nam_project_member(w uuid,pid uuid,member_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_member_section(w,member_id,'projects') and exists(
  select 1 from public.nam_projects p where p.id=pid and p.workspace_id=w and
  (exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=member_id and m.active and m.role='founder')
   or exists(select 1 from public.nam_project_members pm where pm.workspace_id=w and pm.project_id=pid and pm.user_id=member_id)))
$$;
create function public.nam_project_access(w uuid,pid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_section(w,'projects') and public.nam_project_member(w,pid,(select auth.uid()))
$$;
alter table public.nam_projects enable row level security;
alter table public.nam_project_members enable row level security;
alter table public.nam_project_events enable row level security;
create policy projects_read on public.nam_projects for select to authenticated using(public.nam_project_access(workspace_id,id));
create policy project_members_read on public.nam_project_members for select to authenticated using(public.nam_founder(workspace_id));
create policy project_events_read on public.nam_project_events for select to authenticated using(public.nam_founder(workspace_id));
revoke all on public.nam_projects,public.nam_project_members,public.nam_project_events from public,anon,authenticated;
grant select(id,workspace_id,title,brief,outcome,reference_url,due_date,lead_id,version,archived,created_by,created_at,updated_at) on public.nam_projects to authenticated;
grant select on public.nam_project_members,public.nam_project_events to authenticated;

create function public.nam_save_project(w uuid,pid uuid,expected_version integer,changes jsonb,retry_key text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_projects; result public.nam_projects; members jsonb; target uuid; lead uuid;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if jsonb_typeof(changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(changes) f(k) where k not in ('title','brief','outcome','reference_url','due_date','lead_id','member_ids','archived')) then raise exception 'Invalid project fields' using errcode='22023';end if;
 if pid is null and retry_key is not null then
  if retry_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid retry key' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||auth.uid()::text||'project:'||retry_key,0));
  select * into previous from public.nam_projects where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
  if found then
   if previous.create_payload<>changes then raise exception 'This retry key belongs to another project request' using errcode='40001';end if;
   return previous.id;
  end if;
 end if;
 if pid is not null then
  select * into previous from public.nam_projects where workspace_id=w and id=pid for update;
  if not found then raise exception 'Project not found' using errcode='P0002';end if;
  if expected_version is distinct from previous.version then raise exception 'Project changed elsewhere. Reload before saving' using errcode='40001';end if;
 end if;
 -- Recheck after waiting for a project/create lock, including optional MFA.
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if pid is null or changes?'title' then
  if jsonb_typeof(changes->'title') is distinct from 'string' or length(trim(changes->>'title')) not between 1 and 200 then raise exception 'A project name is required' using errcode='22023';end if;
 end if;
 if (changes?'brief' and jsonb_typeof(changes->'brief') is distinct from 'string') or (changes?'outcome' and jsonb_typeof(changes->'outcome') is distinct from 'string') or (changes?'reference_url' and jsonb_typeof(changes->'reference_url') is distinct from 'string') or (changes?'archived' and jsonb_typeof(changes->'archived') is distinct from 'boolean') then raise exception 'Invalid project fields' using errcode='22023';end if;
 lead:=coalesce((changes->>'lead_id')::uuid,previous.lead_id,auth.uid());
 if not public.nam_member_section(w,lead,'projects') then raise exception 'Choose an eligible project lead' using errcode='22023';end if;
 if changes?'member_ids' then
  members:=changes->'member_ids';
  if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members)>100 then raise exception 'Invalid project participants' using errcode='22023';end if;
  for target in select value::uuid from jsonb_array_elements_text(members) loop
   if not public.nam_member_section(w,target,'projects') then raise exception 'A participant does not have production access' using errcode='22023';end if;
  end loop;
 end if;
 if pid is null then
  insert into public.nam_projects(workspace_id,title,brief,outcome,reference_url,due_date,lead_id,created_by,request_key,create_payload)
  values(w,trim(changes->>'title'),coalesce(changes->>'brief',''),coalesce(changes->>'outcome',''),coalesce(changes->>'reference_url',''),nullif(changes->>'due_date','')::date,lead,auth.uid(),retry_key,changes) returning * into result;
 else
  update public.nam_projects set title=coalesce(trim(changes->>'title'),previous.title),brief=coalesce(changes->>'brief',previous.brief),outcome=coalesce(changes->>'outcome',previous.outcome),reference_url=coalesce(changes->>'reference_url',previous.reference_url),
   due_date=case when changes?'due_date' then nullif(changes->>'due_date','')::date else previous.due_date end,
   lead_id=lead,archived=coalesce((changes->>'archived')::boolean,previous.archived),version=previous.version+1,updated_at=now()
  where id=pid returning * into result;
 end if;
 if members is not null then delete from public.nam_project_members where project_id=result.id;
  insert into public.nam_project_members(workspace_id,project_id,user_id) select distinct w,result.id,value::uuid from jsonb_array_elements_text(members);
 end if;
 insert into public.nam_project_members(workspace_id,project_id,user_id) values(w,result.id,lead) on conflict do nothing;
 insert into public.nam_project_events(workspace_id,project_id,actor_id,version,changes) values(w,result.id,auth.uid(),result.version,changes);
 return result.id;
end $$;

alter table public.nam_tasks add column project_id uuid;
alter table public.nam_tasks add column production_stage text check(production_stage is null or production_stage in ('Brief','Modelling','Materials','Lighting','Internal review','Client review','Revisions','Delivery'));
alter table public.nam_tasks add foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id);
alter table public.nam_tasks add constraint nam_production_task_context check((project_id is null and production_stage is null) or (project_id is not null and section='projects'));
create index nam_task_project_page on public.nam_tasks(workspace_id,project_id,owner_id,due_date) where deleted_at is null;

-- Delegate the existing permission/version/idempotency/audit machinery. The
-- private legacy implementation cannot be called to bypass context validation.
alter function public.nam_save_task(uuid,uuid,integer,jsonb) rename to nam_save_task_core;
revoke all on function public.nam_save_task_core(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function public.nam_save_task(w uuid,task_id uuid,expected_version integer,changes jsonb) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
declare previous public.nam_tasks; result public.nam_tasks; pid uuid; stage text; next_owner uuid; next_section text;
begin
 if jsonb_typeof(changes) is distinct from 'object' then raise exception 'Invalid task fields' using errcode='22023';end if;
 if task_id is not null then
  select * into previous from public.nam_tasks t where t.id=task_id and t.workspace_id=w and t.deleted_at is null for update;
  if not found or not public.nam_task_access(task_id) then raise exception 'Task not found' using errcode='P0002';end if;
 end if;
 pid:=case when changes?'project_id' then nullif(changes->>'project_id','')::uuid else previous.project_id end;
 stage:=case when changes?'production_stage' then nullif(changes->>'production_stage','') else previous.production_stage end;
 next_owner:=coalesce((changes->>'owner_id')::uuid,previous.owner_id,auth.uid());
 next_section:=coalesce(changes->>'section',previous.section);
 if pid is null then stage:=null;
 elsif next_section is distinct from 'projects' then raise exception 'Only production tasks can belong to projects' using errcode='22023';
 elsif changes?'project_id' or changes?'production_stage' or changes?'owner_id' or previous.id is null then
  perform 1 from public.nam_projects p where p.workspace_id=w and p.id=pid for share;
  if not found or not public.nam_project_access(w,pid) or not public.nam_project_member(w,pid,next_owner) then raise exception 'Explicit project access is required for both owner and editor' using errcode='42501';end if;
  if exists(select 1 from public.nam_projects where id=pid and archived) and (previous.project_id is distinct from pid or previous.owner_id is distinct from next_owner) then raise exception 'Restore this project before adding work' using errcode='22023';end if;
 end if;
 if stage is not null and stage not in ('Brief','Modelling','Materials','Lighting','Internal review','Client review','Revisions','Delivery') then raise exception 'Choose a production stage' using errcode='22023';end if;
 -- Clear context first when moving an existing task out of production. The
 -- enclosing transaction rolls back this update if any core validation fails.
 if previous.id is not null and pid is null then update public.nam_tasks set project_id=null,production_stage=null where id=previous.id;end if;
 result:=public.nam_save_task_core(w,task_id,expected_version,changes-array['project_id','production_stage']);
 update public.nam_tasks set project_id=pid,production_stage=stage where id=result.id returning * into result;
 if changes?'project_id' or changes?'production_stage' then
  insert into public.nam_task_events(task_id,actor_id,kind,body) values(result.id,auth.uid(),'production_context',changes-array['title','description','section','owner_id','status','priority','due_date','archived','confirmOpenSubtasks']);
 end if;
 return result;
end $$;

create function public.nam_project_list(w uuid,include_archived boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(result) order by result.due_date nulls last,result.title),'[]'::jsonb) from (
  select p.id,p.title,p.due_date,p.lead_id,p.version,p.archived,
   count(t.id) as deliverables,count(t.id) filter(where t.status='Done') as completed,
   count(t.id) filter(where t.status='Blocked') as blocked,
   count(t.id) filter(where t.status not in ('Done','Canceled') and t.due_date<(now() at time zone 'Europe/Paris')::date) as overdue
  from public.nam_projects p left join public.nam_tasks t on t.workspace_id=p.workspace_id and t.project_id=p.id and t.deleted_at is null and not t.archived
  where p.workspace_id=w and p.archived=include_archived group by p.id,p.title,p.due_date,p.lead_id,p.version,p.archived
  order by p.due_date nulls last,p.title limit 200
 ) result
$$;
create function public.nam_project_detail(w uuid,pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('id',p.id,'title',p.title,'brief',p.brief,'outcome',p.outcome,'reference_url',p.reference_url,'due_date',p.due_date,'lead_id',p.lead_id,'version',p.version,'archived',p.archived,
  'member_ids',case when public.nam_founder(w) then coalesce((select jsonb_agg(pm.user_id) from public.nam_project_members pm where pm.project_id=p.id),'[]'::jsonb) else jsonb_build_array(auth.uid()) end)
 into result from public.nam_projects p where p.id=pid and p.workspace_id=w;
 if result is null then raise exception 'Project not found' using errcode='P0002';end if;
 return result;
end $$;
revoke all on function public.nam_project_member(uuid,uuid,uuid),public.nam_project_access(uuid,uuid),public.nam_save_project(uuid,uuid,integer,jsonb,text),public.nam_save_task(uuid,uuid,integer,jsonb),public.nam_project_list(uuid,boolean),public.nam_project_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.nam_project_access(uuid,uuid),public.nam_save_project(uuid,uuid,integer,jsonb,text),public.nam_save_task(uuid,uuid,integer,jsonb),public.nam_project_list(uuid,boolean),public.nam_project_detail(uuid,uuid) to authenticated;
commit;
