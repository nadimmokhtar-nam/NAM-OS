-- Real dated project checkpoints. Their explicit status never writes task
-- completion, render decisions, phase completion or client approval records.
begin;
create table public.nam_project_milestones(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),
 target_date date not null check(target_date between date '0001-01-01' and date '9999-12-31'),
 note text not null default '' check(length(note)<=5000),
 status text not null default 'pending' check(status in ('pending','complete','cancelled')),
 version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 status_changed_at timestamptz not null default now(),completed_at timestamptz,completed_by uuid references auth.users(id),
 cancelled_at timestamptz,cancelled_by uuid references auth.users(id),
 unique(workspace_id,id),unique(workspace_id,project_id,id),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id),
 check((status='complete' and completed_at is not null and completed_by is not null) or (status<>'complete' and completed_at is null and completed_by is null)),
 check((status='cancelled' and cancelled_at is not null and cancelled_by is not null) or (status<>'cancelled' and cancelled_at is null and cancelled_by is null)));
create index project_milestone_calendar on public.nam_project_milestones(workspace_id,project_id,target_date,id);
create index project_milestone_status on public.nam_project_milestones(workspace_id,project_id,status,target_date,id);
create table public.nam_project_milestone_events(
 id bigint generated always as identity primary key,workspace_id uuid not null,project_id uuid not null,milestone_id uuid not null,
 actor_id uuid not null references auth.users(id),version integer not null,
 request_key text not null check(request_key~'^[A-Za-z0-9_-]{8,128}$'),command_payload jsonb not null,
 before_state jsonb,after_state jsonb not null,created_at timestamptz not null default now(),
 unique(workspace_id,actor_id,request_key),
 foreign key(workspace_id,project_id,milestone_id) references public.nam_project_milestones(workspace_id,project_id,id));
create index project_milestone_history on public.nam_project_milestone_events(workspace_id,milestone_id,id desc);
alter table public.nam_project_milestones enable row level security;
alter table public.nam_project_milestone_events enable row level security;
create policy project_milestone_read on public.nam_project_milestones for select to authenticated using(public.nam_project_access(workspace_id,project_id));
create policy project_milestone_history_read on public.nam_project_milestone_events for select to authenticated using(public.nam_founder(workspace_id) and public.nam_project_access(workspace_id,project_id));
revoke all on public.nam_project_milestones,public.nam_project_milestone_events from public,anon,authenticated;
grant select on public.nam_project_milestones to authenticated;
-- Retry payloads remain private even to the ordinary audit reader.
grant select(id,workspace_id,project_id,milestone_id,actor_id,version,before_state,after_state,created_at) on public.nam_project_milestone_events to authenticated;

create function public.nam_project_milestones_page(w uuid,pid uuid,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.nam_projects;selected_status text;search text;from_date date;to_date date;maximum integer;page_offset integer;result jsonb;total integer;
begin
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 select * into p from public.nam_projects x where x.workspace_id=w and x.id=pid;
 if jsonb_typeof(filters) is distinct from 'object' or filters-array['status','search','from','to','page_size','offset']<>'{}'::jsonb then raise exception 'Invalid milestone view' using errcode='22023';end if;
 selected_status:=coalesce(filters->>'status','all');search:=coalesce(filters->>'search','');
 if selected_status not in ('all','pending','complete','cancelled') or (filters?'status' and jsonb_typeof(filters->'status') is distinct from 'string') or (filters?'search' and jsonb_typeof(filters->'search') is distinct from 'string') or length(search)>200 then raise exception 'Choose a valid milestone filter' using errcode='22023';end if;
 if (filters?'page_size' and (jsonb_typeof(filters->'page_size') is distinct from 'number' or (filters->>'page_size')!~'^[0-9]{1,3}$')) or (filters?'offset' and (jsonb_typeof(filters->'offset') is distinct from 'number' or (filters->>'offset')!~'^[0-9]{1,6}$')) then raise exception 'Invalid milestone page' using errcode='22023';end if;
 maximum:=coalesce((filters->>'page_size')::integer,50);page_offset:=coalesce((filters->>'offset')::integer,0);
 if maximum not between 1 and 100 or page_offset not between 0 and 100000 then raise exception 'Invalid milestone page' using errcode='22023';end if;
 if filters?'from' then
  if jsonb_typeof(filters->'from') is distinct from 'string' or (filters->>'from')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Choose a valid start date' using errcode='22023';end if;
  from_date:=(filters->>'from')::date;
 end if;
 if filters?'to' then
  if jsonb_typeof(filters->'to') is distinct from 'string' or (filters->>'to')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Choose a valid end date' using errcode='22023';end if;
  to_date:=(filters->>'to')::date;
 end if;
 if (from_date is not null and from_date not between date '0001-01-01' and date '9999-12-31') or (to_date is not null and to_date not between date '0001-01-01' and date '9999-12-31') or from_date>to_date then raise exception 'Choose an ordered milestone date range' using errcode='22023';end if;
 select count(*) into total from public.nam_project_milestones m where m.workspace_id=w and m.project_id=pid
  and (selected_status='all' or m.status=selected_status) and (from_date is null or m.target_date>=from_date) and (to_date is null or m.target_date<=to_date)
  and (search='' or position(lower(search) in lower(m.title||' '||m.note))>0);
 select coalesce(jsonb_agg(to_jsonb(z) order by z.target_date,z.title,z.id),'[]'::jsonb) into result from (
  select m.* from public.nam_project_milestones m where m.workspace_id=w and m.project_id=pid
   and (selected_status='all' or m.status=selected_status) and (from_date is null or m.target_date>=from_date) and (to_date is null or m.target_date<=to_date)
   and (search='' or position(lower(search) in lower(m.title||' '||m.note))>0)
  order by m.target_date,m.title,m.id limit maximum offset page_offset) z;
 return jsonb_build_object('project_id',pid,'project_archived',p.archived,'items',result,'total',total,'page_size',maximum,'offset',page_offset,
  'next_offset',case when page_offset+maximum<total then page_offset+maximum else null end,'can_manage',public.nam_founder(w) and not p.archived,
  'today',(now() at time zone 'Europe/Paris')::date);
end $$;

create function public.nam_project_milestone_read(w uuid,pid uuid,mid uuid,event_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.nam_project_milestones;result jsonb;total integer:=0;events jsonb:='[]'::jsonb;archived boolean;
begin
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 if event_offset is null or event_offset not between 0 and 100000 then raise exception 'Invalid milestone history page' using errcode='22023';end if;
 select * into m from public.nam_project_milestones x where x.workspace_id=w and x.project_id=pid and x.id=mid;
 if not found then raise exception 'Milestone not found' using errcode='P0002';end if;
 select p.archived into archived from public.nam_projects p where p.workspace_id=w and p.id=pid;
 if public.nam_founder(w) then
  select count(*) into total from public.nam_project_milestone_events e where e.workspace_id=w and e.milestone_id=mid;
  select coalesce(jsonb_agg(to_jsonb(z) order by z.id desc),'[]'::jsonb) into events from (select e.id,e.actor_id,e.version,e.before_state,e.after_state,e.created_at from public.nam_project_milestone_events e where e.workspace_id=w and e.milestone_id=mid order by e.id desc limit 50 offset event_offset) z;
 end if;
 return to_jsonb(m)||jsonb_build_object('project_archived',archived,'can_manage',public.nam_founder(w) and not archived,'events',events,'event_total',total,'event_offset',event_offset,'event_next_offset',case when event_offset+50<total then event_offset+50 else null end);
end $$;

create function public.nam_save_project_milestone(w uuid,pid uuid,mid uuid,expected_version integer,changes jsonb,retry_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.nam_projects;previous public.nam_project_milestones;result public.nam_project_milestones;event public.nam_project_milestone_events;payload jsonb;next_status text;chosen_date date;
begin
 -- Follow 029's identity/session -> project -> record lock order. The helper
 -- pins the managed user/session rows before a queued project write can block.
 perform public.nam_task_schedule_lock(w);
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if retry_key is null or retry_key!~'^[A-Za-z0-9_-]{8,128}$' or jsonb_typeof(changes) is distinct from 'object' or changes='{}'::jsonb or changes-array['title','target_date','note','status']<>'{}'::jsonb then raise exception 'Provide supported milestone fields and a stable request key' using errcode='22023';end if;
 select * into p from public.nam_projects x where x.workspace_id=w and x.id=pid for share;
 if not found or not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder assurance changed' using errcode='42501';end if;
 payload:=jsonb_build_object('project_id',pid,'milestone_id',mid,'expected_version',expected_version,'changes',changes);
 select * into event from public.nam_project_milestone_events e where e.workspace_id=w and e.actor_id=auth.uid() and e.request_key=retry_key;
 if found then
  if event.command_payload is distinct from payload then raise exception 'This request key belongs to another milestone change' using errcode='40001';end if;
  return event.after_state;
 end if;
 if p.archived then raise exception 'Restore the project before changing its checkpoints' using errcode='22023';end if;
 if mid is null then
  if expected_version is not null then raise exception 'A new milestone has no version' using errcode='22023';end if;
  if (select count(*) from public.nam_project_milestones m where m.workspace_id=w and m.project_id=pid)>=1000 then raise exception 'A project can retain at most 1000 milestones' using errcode='54000';end if;
 else
  select * into previous from public.nam_project_milestones m where m.workspace_id=w and m.project_id=pid and m.id=mid for update;
  if not found then raise exception 'Milestone not found' using errcode='P0002';end if;
  if previous.version is distinct from expected_version then raise exception 'This milestone changed elsewhere. Reload its saved version before changing it.' using errcode='40001';end if;
 end if;
 if not public.nam_founder(w) then raise exception 'Founder assurance changed' using errcode='42501';end if;
 if (mid is null or changes?'title') and (jsonb_typeof(changes->'title') is distinct from 'string' or length(trim(changes->>'title')) not between 1 and 200) then raise exception 'Provide a milestone title' using errcode='22023';end if;
 if changes?'note' and (jsonb_typeof(changes->'note') is distinct from 'string' or length(changes->>'note')>5000) then raise exception 'Provide a shared note of at most 5000 characters' using errcode='22023';end if;
 if (mid is null or changes?'target_date') and (jsonb_typeof(changes->'target_date') is distinct from 'string' or (changes->>'target_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'Provide a valid milestone date' using errcode='22023';end if;
 chosen_date:=case when changes?'target_date' then (changes->>'target_date')::date else previous.target_date end;
 if chosen_date is null or chosen_date not between date '0001-01-01' and date '9999-12-31' then raise exception 'Provide a supported milestone date' using errcode='22023';end if;
 next_status:=coalesce(changes->>'status',previous.status,'pending');
 if next_status not in ('pending','complete','cancelled') or (changes?'status' and jsonb_typeof(changes->'status') is distinct from 'string') then raise exception 'Choose Pending, Complete or Cancelled' using errcode='22023';end if;
 if mid is null then
  insert into public.nam_project_milestones(workspace_id,project_id,title,target_date,note,status,created_by,completed_at,completed_by,cancelled_at,cancelled_by)
   values(w,pid,trim(changes->>'title'),chosen_date,coalesce(changes->>'note',''),next_status,auth.uid(),case when next_status='complete' then now() end,case when next_status='complete' then auth.uid() end,case when next_status='cancelled' then now() end,case when next_status='cancelled' then auth.uid() end) returning * into result;
 else
  update public.nam_project_milestones set title=coalesce(trim(changes->>'title'),previous.title),target_date=chosen_date,note=coalesce(changes->>'note',previous.note),status=next_status,
   version=version+1,updated_at=now(),status_changed_at=case when next_status is distinct from previous.status then now() else previous.status_changed_at end,
   completed_at=case when next_status='complete' then coalesce(previous.completed_at,now()) end,completed_by=case when next_status='complete' then coalesce(previous.completed_by,auth.uid()) end,
   cancelled_at=case when next_status='cancelled' then coalesce(previous.cancelled_at,now()) end,cancelled_by=case when next_status='cancelled' then coalesce(previous.cancelled_by,auth.uid()) end
   where id=previous.id and workspace_id=w returning * into result;
 end if;
 insert into public.nam_project_milestone_events(workspace_id,project_id,milestone_id,actor_id,version,request_key,command_payload,before_state,after_state)
  values(w,pid,result.id,auth.uid(),result.version,retry_key,payload,case when previous.id is not null then to_jsonb(previous) end,to_jsonb(result));
 return to_jsonb(result);
end $$;
revoke all on function public.nam_project_milestones_page(uuid,uuid,jsonb),public.nam_project_milestone_read(uuid,uuid,uuid,integer),public.nam_save_project_milestone(uuid,uuid,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.nam_project_milestones_page(uuid,uuid,jsonb),public.nam_project_milestone_read(uuid,uuid,uuid,integer),public.nam_save_project_milestone(uuid,uuid,uuid,integer,jsonb,text) to authenticated;
commit;
