-- Professional profiles and departments are metadata, never an access scope.
-- Existing invitations, role templates, section grants and record RLS remain authoritative.
begin;
create table public.nam_departments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),
 name text not null check(length(btrim(name)) between 1 and 80),archived boolean not null default false,
 version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id));
create unique index nam_department_name on public.nam_departments(workspace_id,lower(btrim(name)));
create table public.nam_member_profiles(
 workspace_id uuid not null,user_id uuid not null,job_title text not null default '' check(length(job_title)<=100),
 department_id uuid,notification_assignment boolean not null default true,notification_due boolean not null default true,notification_overdue boolean not null default true,
 version integer not null default 0 check(version>=0),updated_at timestamptz not null default now(),primary key(workspace_id,user_id),
 foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id) on delete cascade,
 foreign key(workspace_id,department_id) references public.nam_departments(workspace_id,id));
create index nam_profile_department on public.nam_member_profiles(workspace_id,department_id,user_id);
create table public.nam_team_events(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.nam_workspaces(id),actor_id uuid not null references auth.users(id),
 target_user uuid references auth.users(id),department_id uuid references public.nam_departments(id),kind text not null check(kind in ('profile','notifications','department','member_department')),
 before_value jsonb not null,after_value jsonb not null,created_at timestamptz not null default now());
create index nam_team_event_page on public.nam_team_events(workspace_id,id desc);
-- Keep an exact result for an ambiguous transport retry. No browser can read/write this table.
create table public.nam_team_requests(
 workspace_id uuid not null,actor_id uuid not null,request_key text not null check(length(request_key) between 8 and 128),
 fingerprint jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(workspace_id,actor_id,request_key),
 foreign key(workspace_id,actor_id) references public.nam_memberships(workspace_id,user_id));
alter table public.nam_departments enable row level security;
alter table public.nam_member_profiles enable row level security;
alter table public.nam_team_events enable row level security;
alter table public.nam_team_requests enable row level security;
create policy team_departments_read on public.nam_departments for select to authenticated using(public.nam_assured() and public.nam_role(workspace_id) is not null and (public.nam_role(workspace_id)<>'founder' or public.nam_founder(workspace_id)) and (public.nam_founder(workspace_id) or exists(select 1 from public.nam_member_profiles p where p.workspace_id=nam_departments.workspace_id and p.user_id=(select auth.uid()) and p.department_id=nam_departments.id)));
create policy team_profiles_read on public.nam_member_profiles for select to authenticated using(public.nam_assured() and public.nam_role(workspace_id) is not null and (public.nam_role(workspace_id)<>'founder' or public.nam_founder(workspace_id)) and (user_id=(select auth.uid()) or public.nam_founder(workspace_id)));
create policy team_events_read on public.nam_team_events for select to authenticated using(public.nam_assured() and public.nam_role(workspace_id) is not null and (public.nam_role(workspace_id)<>'founder' or public.nam_founder(workspace_id)) and (target_user=(select auth.uid()) or public.nam_founder(workspace_id)));
revoke all on public.nam_departments,public.nam_member_profiles,public.nam_team_events,public.nam_team_requests from public,anon,authenticated,service_role;
grant select on public.nam_departments,public.nam_member_profiles,public.nam_team_events to authenticated;

-- Internal projection is callable only by the guarded metadata functions below.
create function public.nam_team_profile_value(w uuid,member_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',m.user_id,'name',m.name,'job_title',coalesce(p.job_title,''),'revision',coalesce(p.version,0),
  'department',case when d.id is not null then jsonb_build_object('id',d.id,'name',d.name,'archived',d.archived) else null end,
  'notifications',jsonb_build_object('assignment',coalesce(p.notification_assignment,true),'due',coalesce(p.notification_due,true),'overdue',coalesce(p.notification_overdue,true)))
 from public.nam_memberships m left join public.nam_member_profiles p using(workspace_id,user_id)
 left join public.nam_departments d on d.workspace_id=p.workspace_id and d.id=p.department_id
 where m.workspace_id=w and m.user_id=member_id
$$;
create function public.nam_team_profile(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.nam_assured() or public.nam_role(w) is null or (public.nam_role(w)='founder' and not public.nam_founder(w)) then raise exception 'Current assured membership required' using errcode='42501';end if;
 return public.nam_team_profile_value(w,auth.uid());
end $$;
create function public.nam_team_directory(w uuid,page integer default 1,search text default '',department uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;total bigint;
begin
 if not public.nam_section(w,'team') then raise exception 'Team section required' using errcode='42501';end if;
 if page is null or page<1 or page>100000 or search is null or length(search)>100 then raise exception 'Invalid directory page' using errcode='22023';end if;
 select count(*) into total from public.nam_memberships m left join public.nam_member_profiles p using(workspace_id,user_id)
 where m.workspace_id=w and m.active and (department is null or p.department_id=department) and (search='' or position(lower(search) in lower(m.name||' '||coalesce(p.job_title,'')))>0);
 select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]'::jsonb) into rows from (
  select m.user_id as id,m.name,m.role,coalesce(p.job_title,'') as job_title,coalesce(p.version,0) as revision,
   case when d.id is not null then jsonb_build_object('id',d.id,'name',d.name,'archived',d.archived) else null end as department
  from public.nam_memberships m left join public.nam_member_profiles p using(workspace_id,user_id) left join public.nam_departments d on d.workspace_id=p.workspace_id and d.id=p.department_id
  where m.workspace_id=w and m.active and (department is null or p.department_id=department) and (search='' or position(lower(search) in lower(m.name||' '||coalesce(p.job_title,'')))>0)
  order by m.name,m.user_id limit 50 offset (page-1)*50
 ) r;
 return jsonb_build_object('items',rows,'total',total,'page',page,'pageSize',50,'hasMore',page::bigint*50<total);
end $$;
create function public.nam_team_departments(w uuid,page integer default 1,include_archived boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;total bigint;
begin
 if not public.nam_founder(w) then raise exception 'Verified Founder required' using errcode='42501';end if;
 if page is null or page<1 or page>100000 or include_archived is null then raise exception 'Invalid department page' using errcode='22023';end if;
 select count(*) into total from public.nam_departments d where d.workspace_id=w and (include_archived or not d.archived);
 select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]'::jsonb) into rows from (
  select d.id,d.name,d.archived,d.version as revision,(select count(*) from public.nam_member_profiles p join public.nam_memberships m using(workspace_id,user_id) where p.workspace_id=w and p.department_id=d.id and m.active) as members
  from public.nam_departments d where d.workspace_id=w and (include_archived or not d.archived) order by d.name,d.id limit 50 offset (page-1)*50
 ) r;
 return jsonb_build_object('items',rows,'total',total,'page',page,'pageSize',50,'hasMore',page::bigint*50<total);
end $$;
create function public.nam_team_history(w uuid,page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;total bigint;
begin
 if not public.nam_assured() or public.nam_role(w) is null or (public.nam_role(w)='founder' and not public.nam_founder(w)) then raise exception 'Current assured membership required' using errcode='42501';end if;
 if page is null or page<1 or page>100000 then raise exception 'Invalid history page' using errcode='22023';end if;
 select count(*) into total from public.nam_team_events e where e.workspace_id=w and (public.nam_founder(w) or e.target_user=auth.uid());
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]'::jsonb) into rows from (
  select e.id,e.actor_id,e.target_user,e.department_id,e.kind,e.before_value,e.after_value,e.created_at from public.nam_team_events e
  where e.workspace_id=w and (public.nam_founder(w) or e.target_user=auth.uid()) order by e.id desc limit 50 offset (page-1)*50
 ) r;
 return jsonb_build_object('items',rows,'total',total,'page',page,'pageSize',50,'hasMore',page::bigint*50<total);
end $$;

create function public.nam_save_team_metadata(w uuid,operation text,target_id uuid,expected_version integer,payload jsonb,retry_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.nam_memberships;profile public.nam_member_profiles;dept public.nam_departments;fingerprint jsonb;prior public.nam_team_requests;before_value jsonb;result jsonb;changed boolean:=false;next_department uuid;
begin
 if not public.nam_assured() or public.nam_role(w) is null or (public.nam_role(w)='founder' and not public.nam_founder(w)) then raise exception 'Current assured membership required' using errcode='42501';end if;
 if operation is null or operation not in ('profile','notifications','department','member_department') then raise exception 'Unsupported team operation' using errcode='22023';end if;
 if operation in ('department','member_department') and not public.nam_founder(w) then raise exception 'Verified Founder required' using errcode='42501';end if;
 if operation in ('profile','notifications') and target_id is distinct from auth.uid() then raise exception 'Own profile only' using errcode='42501';end if;
 if expected_version is null or expected_version<0 or jsonb_typeof(payload) is distinct from 'object' or retry_key is null or retry_key!~'^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid metadata request' using errcode='22023';end if;
 fingerprint:=jsonb_build_object('operation',operation,'target',target_id,'version',expected_version,'payload',payload);
 perform pg_advisory_xact_lock(hashtextextended(w::text||':'||auth.uid()::text||':'||retry_key,0));
 -- Recheck after a possible lock wait; a replay never bypasses revocation.
 if not public.nam_assured() or public.nam_role(w) is null or (public.nam_role(w)='founder' and not public.nam_founder(w)) or (operation in ('department','member_department') and not public.nam_founder(w)) then raise exception 'Current metadata authority required' using errcode='42501';end if;
 select * into prior from public.nam_team_requests r where r.workspace_id=w and r.actor_id=auth.uid() and r.request_key=retry_key;
 if found then
  if prior.fingerprint is distinct from fingerprint then raise exception 'Retry key already used for another change' using errcode='40001';end if;
  return prior.result;
 end if;
 if operation='department' then
  if exists(select 1 from jsonb_object_keys(payload) f(key) where f.key not in ('name','archived')) or jsonb_typeof(payload->'name') is distinct from 'string' or length(btrim(payload->>'name')) not between 1 and 80 or (payload->>'name')~'[[:cntrl:]]' or jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception 'Invalid department fields' using errcode='22023';end if;
  if target_id is null then
   if expected_version<>0 then raise exception 'Invalid new department revision' using errcode='22023';end if;
   -- A bounded workspace vocabulary; archived rows remain available for history.
   perform pg_advisory_xact_lock(hashtextextended(w::text||':departments',0));
   if (select count(*) from public.nam_departments d where d.workspace_id=w)>=200 then raise exception 'Department limit reached' using errcode='22023';end if;
   insert into public.nam_departments(workspace_id,name,archived) values(w,btrim(payload->>'name'),(payload->>'archived')::boolean) returning * into dept;
   before_value:='null'::jsonb;changed:=true;
  else
   select * into dept from public.nam_departments d where d.workspace_id=w and d.id=target_id for update;
   if not found then raise exception 'Department not found' using errcode='P0002';end if;
   if expected_version<>dept.version then raise exception 'Department changed elsewhere' using errcode='40001';end if;
   before_value:=jsonb_build_object('id',dept.id,'name',dept.name,'archived',dept.archived,'revision',dept.version);
   changed:=dept.name is distinct from btrim(payload->>'name') or dept.archived is distinct from (payload->>'archived')::boolean;
   if changed then update public.nam_departments set name=btrim(payload->>'name'),archived=(payload->>'archived')::boolean,version=version+1,updated_at=now() where id=dept.id returning * into dept;end if;
  end if;
  if not public.nam_founder(w) then raise exception 'Current Founder required' using errcode='42501';end if;
  result:=jsonb_build_object('id',dept.id,'name',dept.name,'archived',dept.archived,'revision',dept.version);
 else
  select * into member from public.nam_memberships m where m.workspace_id=w and m.user_id=target_id and m.active for update;
  if not found then raise exception 'Active member not found' using errcode='P0002';end if;
  if not public.nam_assured() or public.nam_role(w) is null or (public.nam_role(w)='founder' and not public.nam_founder(w)) or (operation='member_department' and not public.nam_founder(w)) then raise exception 'Current metadata authority required' using errcode='42501';end if;
  insert into public.nam_member_profiles(workspace_id,user_id) values(w,target_id) on conflict do nothing;
  select * into profile from public.nam_member_profiles p where p.workspace_id=w and p.user_id=target_id for update;
  if expected_version<>profile.version then raise exception 'Profile changed elsewhere' using errcode='40001';end if;
  before_value:=public.nam_team_profile_value(w,target_id);
  if operation='profile' then
   if exists(select 1 from jsonb_object_keys(payload) f(key) where f.key not in ('name','job_title')) or jsonb_typeof(payload->'name') is distinct from 'string' or length(btrim(payload->>'name')) not between 1 and 100 or (payload->>'name')~'[[:cntrl:]]' or jsonb_typeof(payload->'job_title') is distinct from 'string' or length(payload->>'job_title')>100 or (payload->>'job_title')~'[[:cntrl:]]' then raise exception 'Invalid professional profile' using errcode='22023';end if;
   changed:=member.name is distinct from btrim(payload->>'name') or profile.job_title is distinct from btrim(payload->>'job_title');
   if changed then update public.nam_memberships set name=btrim(payload->>'name') where workspace_id=w and user_id=target_id;update public.nam_member_profiles set job_title=btrim(payload->>'job_title') where workspace_id=w and user_id=target_id;end if;
  elsif operation='notifications' then
   if exists(select 1 from jsonb_object_keys(payload) f(key) where f.key not in ('assignment','due','overdue')) or jsonb_typeof(payload->'assignment') is distinct from 'boolean' or jsonb_typeof(payload->'due') is distinct from 'boolean' or jsonb_typeof(payload->'overdue') is distinct from 'boolean' then raise exception 'Only supported inbox events may be configured' using errcode='22023';end if;
   changed:=profile.notification_assignment is distinct from (payload->>'assignment')::boolean or profile.notification_due is distinct from (payload->>'due')::boolean or profile.notification_overdue is distinct from (payload->>'overdue')::boolean;
   if changed then update public.nam_member_profiles set notification_assignment=(payload->>'assignment')::boolean,notification_due=(payload->>'due')::boolean,notification_overdue=(payload->>'overdue')::boolean where workspace_id=w and user_id=target_id;end if;
  else
   if exists(select 1 from jsonb_object_keys(payload) f(key) where f.key<>'department_id') or not (payload?'department_id') or jsonb_typeof(payload->'department_id') not in ('string','null') then raise exception 'Invalid department assignment' using errcode='22023';end if;
   next_department:=nullif(payload->>'department_id','')::uuid;
   if next_department is not null then
    select * into dept from public.nam_departments d where d.workspace_id=w and d.id=next_department for share;
    if not found or (dept.archived and profile.department_id is distinct from next_department) then raise exception 'Choose an active department in this workspace' using errcode='22023';end if;
   end if;
   changed:=profile.department_id is distinct from next_department;
   if changed then update public.nam_member_profiles set department_id=next_department where workspace_id=w and user_id=target_id;end if;
  end if;
  if changed then update public.nam_member_profiles set version=version+1,updated_at=now() where workspace_id=w and user_id=target_id;end if;
  result:=public.nam_team_profile_value(w,target_id);
 end if;
 if changed then insert into public.nam_team_events(workspace_id,actor_id,target_user,department_id,kind,before_value,after_value) values(w,auth.uid(),case when operation<>'department' then target_id end,case when operation='department' then dept.id when operation='member_department' then next_department end,operation,before_value,result);end if;
 insert into public.nam_team_requests(workspace_id,actor_id,request_key,fingerprint,result) values(w,auth.uid(),retry_key,fingerprint,result);
 return result;
end $$;

-- Filter the existing assignment and scheduled due/overdue INSERT paths in one
-- place. A preference save does not replay previously suppressed notifications.
-- No email/push/comment toggles are offered because those channels/events do not exist.
create function public.nam_notification_preference_filter() returns trigger language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
 select case new.kind when 'assignment' then coalesce(p.notification_assignment,true) when 'due' then coalesce(p.notification_due,true) when 'overdue' then coalesce(p.notification_overdue,true) else false end into allowed
 from public.nam_tasks t join public.nam_memberships m on m.workspace_id=t.workspace_id and m.user_id=new.recipient_id and m.active
 left join public.nam_member_profiles p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
 where t.id=new.task_id and t.workspace_id=new.workspace_id and t.owner_id=new.recipient_id and t.deleted_at is null and not t.archived and public.nam_member_section(t.workspace_id,new.recipient_id,t.section);
 if allowed is not true then return null;end if;
 return new;
end $$;
create trigger notification_preference_filter before insert on public.nam_notifications for each row execute function public.nam_notification_preference_filter();

revoke all on function public.nam_team_profile_value(uuid,uuid),public.nam_notification_preference_filter() from public,anon,authenticated,service_role;
revoke all on function public.nam_team_profile(uuid),public.nam_team_directory(uuid,integer,text,uuid),public.nam_team_departments(uuid,integer,boolean),public.nam_team_history(uuid,integer),public.nam_save_team_metadata(uuid,text,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.nam_team_profile(uuid),public.nam_team_directory(uuid,integer,text,uuid),public.nam_team_departments(uuid,integer,boolean),public.nam_team_history(uuid,integer),public.nam_save_team_metadata(uuid,text,uuid,integer,jsonb,text) to authenticated;
commit;
