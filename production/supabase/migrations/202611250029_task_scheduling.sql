-- Calendar contains real task UUIDs. Repeats create one real successor when
-- completed; no service identity impersonates a member or projects virtual work.
begin;

alter table public.nam_tasks add column recurrence_rule jsonb;
alter table public.nam_tasks add column recurrence_series_id uuid;
alter table public.nam_tasks add column recurrence_anchor_date date;
alter table public.nam_tasks add column recurrence_predecessor_id uuid;
alter table public.nam_tasks add constraint nam_task_repeat_predecessor foreign key(workspace_id,recurrence_predecessor_id) references public.nam_tasks(workspace_id,id);
alter table public.nam_tasks add constraint nam_task_repeat_not_self check(recurrence_predecessor_id is null or recurrence_predecessor_id<>id);
alter table public.nam_tasks add column recurrence_occurrence integer not null default 0 check(recurrence_occurrence between 0 and 1000000);
alter table public.nam_tasks add constraint nam_task_repeat_identity check(
 (recurrence_series_id is null and recurrence_anchor_date is null and recurrence_rule is null and recurrence_occurrence=0)
 or (recurrence_series_id is not null and recurrence_anchor_date is not null and recurrence_anchor_date between date '0001-01-01' and date '9999-12-31'));
create unique index nam_task_repeat_occurrence on public.nam_tasks(workspace_id,recurrence_series_id,recurrence_occurrence) where recurrence_series_id is not null;
create unique index nam_task_repeat_successor on public.nam_tasks(workspace_id,recurrence_predecessor_id) where recurrence_predecessor_id is not null;
create index nam_task_calendar_window on public.nam_tasks(workspace_id,due_date,id) where deleted_at is null;

create table public.nam_task_dependencies(
 workspace_id uuid not null, task_id uuid not null, prerequisite_id uuid not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(task_id,prerequisite_id), check(task_id<>prerequisite_id),
 foreign key(workspace_id,task_id) references public.nam_tasks(workspace_id,id),
 foreign key(workspace_id,prerequisite_id) references public.nam_tasks(workspace_id,id)
);
create index nam_task_dependency_reverse on public.nam_task_dependencies(workspace_id,prerequisite_id,task_id);
create table public.nam_task_schedule_requests(
 workspace_id uuid not null, actor_id uuid not null references auth.users(id), request_key text not null,
 task_id uuid not null, payload jsonb not null, created_at timestamptz not null default now(),
 primary key(workspace_id,actor_id,request_key),
 foreign key(workspace_id,task_id) references public.nam_tasks(workspace_id,id)
);
alter table public.nam_task_dependencies enable row level security;
alter table public.nam_task_schedule_requests enable row level security;
create policy task_dependencies_read on public.nam_task_dependencies for select to authenticated
 using(public.nam_task_access(task_id) and public.nam_task_access(prerequisite_id));
revoke all on public.nam_task_dependencies,public.nam_task_schedule_requests from public,anon,authenticated;
grant select on public.nam_task_dependencies to authenticated;

-- All task status/deletion and graph edits acquire this lock before task locks.
-- A membership grant change or logout that finishes before lock acquisition is
-- rechecked. A write already holding its identity rows commits before revocation.
create function public.nam_task_schedule_lock(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Workspace access required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nam-task-schedule:'||w::text,0));
 perform 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=auth.uid() and m.active for share;
 if not found then raise exception 'Workspace access required' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found then raise exception 'Account unavailable' using errcode='42501';end if;
 perform 1 from auth.sessions s where s.user_id=auth.uid() and s.id=case when (auth.jwt()->>'session_id')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (auth.jwt()->>'session_id')::uuid end and (s.not_after is null or s.not_after>now()) for share;
 if not found or not public.nam_assured() or public.nam_role(w) is null then raise exception 'Current workspace session required' using errcode='42501';end if;
end $$;

-- Anchor monthly repeats to the original day (31 Jan, 28 Feb, 31 Mar).
-- A schedule ending beyond the supported date range has no successor.
create function public.nam_task_occurrence_date(anchor date,frequency text,repeat_every integer,occurrence integer) returns date
language plpgsql immutable set search_path='' as $$
declare result date; offset_count bigint:=repeat_every::bigint*occurrence;
begin
 if occurrence>1000000 then return null;end if;
 if anchor is null or repeat_every not between 1 and 99 or occurrence not between 0 and 1000000 or frequency not in ('daily','weekly','monthly') then raise exception 'Invalid recurrence' using errcode='22023';end if;
 if frequency='monthly' then result:=(anchor+pg_catalog.make_interval(months=>offset_count::integer))::date;
 else result:=anchor+(offset_count*case when frequency='weekly' then 7 else 1 end)::integer;end if;
 if result not between date '0001-01-01' and date '9999-12-31' then return null;end if;
 return result;
exception when datetime_field_overflow or numeric_value_out_of_range then return null;
end $$;

create function public.nam_task_scheduling(w uuid,tid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare task public.nam_tasks; rows jsonb; unavailable integer; next_task jsonb; next_date date;
begin
 select * into task from public.nam_tasks t where t.workspace_id=w and t.id=tid and t.deleted_at is null;
 if not found or not public.nam_task_access(tid) then raise exception 'Task not found' using errcode='P0002';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'title',p.title,'status',p.status,'due_date',p.due_date,'version',p.version,'satisfied',p.status='Done') order by p.number),'[]'::jsonb)
 into rows from public.nam_task_dependencies d join public.nam_tasks p on p.id=d.prerequisite_id and p.workspace_id=d.workspace_id
 where d.workspace_id=w and d.task_id=tid and public.nam_task_access(p.id);
 select count(*)::integer into unavailable from public.nam_task_dependencies d
 where d.workspace_id=w and d.task_id=tid and not public.nam_task_access(d.prerequisite_id);
 if task.recurrence_rule is not null then
  next_date:=public.nam_task_occurrence_date(task.recurrence_anchor_date,task.recurrence_rule->>'frequency',(task.recurrence_rule->>'interval')::integer,task.recurrence_occurrence+1);
  if next_date>(task.recurrence_rule->>'until')::date then next_date:=null;end if;
 end if;
 select jsonb_build_object('id',t.id,'number',t.number,'title',t.title,'due_date',t.due_date) into next_task
 from public.nam_tasks t where t.workspace_id=w and t.recurrence_predecessor_id=task.id and public.nam_task_access(t.id);
 return jsonb_build_object('id',task.id,'version',task.version,'due_date',task.due_date,'status',task.status,'archived',task.archived,
  'recurrence',task.recurrence_rule,'occurrence',task.recurrence_occurrence,'next_due_date',next_date,'next_task',next_task,
  'prerequisites',rows,'unavailable_prerequisites',unavailable,
  'can_complete',unavailable=0 and not exists(select 1 from public.nam_task_dependencies d join public.nam_tasks p on p.id=d.prerequisite_id where d.workspace_id=w and d.task_id=tid and (p.status<>'Done' or p.deleted_at is not null)),
  'can_repeat',public.nam_can_create_task(w,task.section));
end $$;

create function public.nam_save_task_scheduling(w uuid,tid uuid,expected_version integer,changes jsonb,retry_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare task public.nam_tasks; saved public.nam_task_schedule_requests; rule jsonb; target uuid; targets uuid[]; cycles boolean;
begin
 perform public.nam_task_schedule_lock(w);
 select * into task from public.nam_tasks t where t.workspace_id=w and t.id=tid and t.deleted_at is null for update;
 if not found or not public.nam_task_access(tid) then raise exception 'Task not found' using errcode='P0002';end if;
 if jsonb_typeof(changes) is distinct from 'object' or changes='{}'::jsonb or changes-array['recurrence','prerequisite_ids']<>'{}'::jsonb
 or retry_key is null or retry_key!~'^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid scheduling change' using errcode='22023';end if;
 select * into saved from public.nam_task_schedule_requests r where r.workspace_id=w and r.actor_id=auth.uid() and r.request_key=retry_key;
 if found then
  if saved.task_id is distinct from tid or saved.payload is distinct from jsonb_build_object('expected_version',expected_version,'changes',changes) then raise exception 'Retry key belongs to another scheduling change' using errcode='40001';end if;
  return public.nam_task_scheduling(w,tid);
 end if;
 if expected_version is distinct from task.version then raise exception 'Task changed elsewhere' using errcode='40001';end if;
 if task.archived then raise exception 'Restore the task before changing its schedule' using errcode='22023';end if;
 if changes?'recurrence' then
  rule:=changes->'recurrence';
  if rule='null'::jsonb then rule:=null;
  else
   if task.status in ('Done','Canceled') or jsonb_typeof(rule) is distinct from 'object' or rule-array['frequency','interval','until']<>'{}'::jsonb
   or coalesce(rule->>'frequency','') not in ('daily','weekly','monthly') or jsonb_typeof(rule->'frequency') is distinct from 'string'
   or (rule?'interval' and (jsonb_typeof(rule->'interval') is distinct from 'number' or (rule->>'interval')!~'^[0-9]{1,2}$'))
   or coalesce((rule->>'interval')::integer,1) not between 1 and 99 then raise exception 'Choose a supported repeat interval on an open task' using errcode='22023';end if;
   if task.due_date is null then raise exception 'Set a due date before repeating this task' using errcode='22023';end if;
   if rule?'until' and rule->'until'<>'null'::jsonb and (jsonb_typeof(rule->'until') is distinct from 'string' or (rule->>'until')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (rule->>'until')::date<task.due_date or (rule->>'until')::date not between date '0001-01-01' and date '9999-12-31') then raise exception 'Choose a repeat end date on or after this task' using errcode='22023';end if;
   if not public.nam_can_create_task(w,task.section) then raise exception 'Task creation access is required to repeat work' using errcode='42501';end if;
   rule:=jsonb_build_object('frequency',rule->>'frequency','interval',coalesce((rule->>'interval')::integer,1),'until',rule->>'until');
  end if;
  if rule is distinct from task.recurrence_rule and exists(select 1 from public.nam_tasks t where t.workspace_id=w and t.recurrence_predecessor_id=task.id) then raise exception 'Change the latest occurrence to adjust future repeats' using errcode='40001';end if;
  if rule is distinct from task.recurrence_rule then
   update public.nam_tasks set recurrence_rule=rule,
    recurrence_series_id=case when rule is not null then gen_random_uuid() else recurrence_series_id end,
    recurrence_anchor_date=case when rule is not null then due_date else recurrence_anchor_date end,
    recurrence_occurrence=case when rule is not null then 0 else recurrence_occurrence end where id=tid;
  end if;
 end if;
 if changes?'prerequisite_ids' then
  if jsonb_typeof(changes->'prerequisite_ids') is distinct from 'array' or jsonb_array_length(changes->'prerequisite_ids')>100
  or exists(select 1 from jsonb_array_elements(changes->'prerequisite_ids') e(value) where jsonb_typeof(e.value) is distinct from 'string' or (e.value#>>'{}')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Choose at most 100 prerequisites' using errcode='22023';end if;
  select coalesce(array_agg((e.value#>>'{}')::uuid),'{}'::uuid[]) into targets from jsonb_array_elements(changes->'prerequisite_ids') e(value);
  if cardinality(targets)<>(select count(distinct v) from unnest(targets) v) or tid=any(targets) then raise exception 'Choose each other task once' using errcode='22023';end if;
  foreach target in array targets loop
   if not exists(select 1 from public.nam_tasks t where t.workspace_id=w and t.id=target and t.deleted_at is null and not t.archived and public.nam_task_access(t.id)) then raise exception 'A prerequisite is not available' using errcode='P0002';end if;
  end loop;
  with recursive upstream(id) as (
   select unnest(targets) union select d.prerequisite_id from public.nam_task_dependencies d join upstream u on d.task_id=u.id where d.workspace_id=w
  ) select exists(select 1 from upstream where id=tid) into cycles;
  if cycles then raise exception 'Task dependencies cannot contain a cycle' using errcode='22023';end if;
  if task.status='Done' and exists(select 1 from public.nam_tasks t where t.id=any(targets) and t.status<>'Done') then raise exception 'Complete the prerequisites before finishing this task' using errcode='40001';end if;
  delete from public.nam_task_dependencies where workspace_id=w and task_id=tid and not(prerequisite_id=any(targets));
  insert into public.nam_task_dependencies(workspace_id,task_id,prerequisite_id,created_by) select w,tid,v,auth.uid() from unnest(targets) v on conflict do nothing;
 end if;
 update public.nam_tasks set version=version+1,updated_at=now() where id=tid;
 insert into public.nam_task_events(task_id,actor_id,kind,body) values(tid,auth.uid(),'scheduling',jsonb_build_object('message','Updated repeat and prerequisite settings'));
 insert into public.nam_task_schedule_requests(workspace_id,actor_id,request_key,task_id,payload) values(w,auth.uid(),retry_key,tid,jsonb_build_object('expected_version',expected_version,'changes',changes));
 return public.nam_task_scheduling(w,tid);
end $$;

-- Preserve 024's context/deliverable wrapper, which calls 013's private core.
-- The existing create RPC resolves this public name dynamically and therefore
-- retains its original idempotency keys and permission checks without a clone.
alter function public.nam_save_task(uuid,uuid,integer,jsonb) rename to nam_save_task_before_scheduling;
revoke all on function public.nam_save_task_before_scheduling(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function public.nam_save_task(w uuid,task_id uuid,expected_version integer,changes jsonb) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
declare requested_task_id alias for $2; previous public.nam_tasks; result public.nam_tasks; successor public.nam_tasks; next_date date; payload jsonb;
begin
 perform public.nam_task_schedule_lock(w);
 if requested_task_id is not null then
  select * into previous from public.nam_tasks t where t.workspace_id=w and t.id=requested_task_id and t.deleted_at is null for update;
  if not found or not public.nam_task_access(requested_task_id) then raise exception 'Task not found' using errcode='P0002';end if;
  if expected_version is distinct from previous.version then raise exception 'Task changed elsewhere' using errcode='40001';end if;
  if changes->>'status'='Done' and previous.status<>'Done' and exists(
   select 1 from public.nam_task_dependencies d join public.nam_tasks t on t.id=d.prerequisite_id
   where d.workspace_id=w and d.task_id=requested_task_id and (t.status<>'Done' or t.deleted_at is not null or not public.nam_task_access(t.id)))
  then raise exception 'Complete the prerequisites before finishing this task' using errcode='40001';end if;
  if previous.status='Done' and changes?'status' and changes->>'status'<>'Done' and exists(
   select 1 from public.nam_task_dependencies d join public.nam_tasks t on t.id=d.task_id
   where d.workspace_id=w and d.prerequisite_id=requested_task_id and t.status='Done' and t.deleted_at is null)
  then raise exception 'A completed task depends on this task. Reopen it first' using errcode='40001';end if;
  if previous.recurrence_rule is not null and changes?'due_date' and nullif(changes->>'due_date','')::date is distinct from previous.due_date then
   if nullif(changes->>'due_date','') is null then raise exception 'Turn off repeating before removing the due date' using errcode='22023';end if;
   if exists(select 1 from public.nam_tasks t where t.workspace_id=w and t.recurrence_predecessor_id=previous.id) then raise exception 'Change the latest occurrence to adjust future repeats' using errcode='40001';end if;
   update public.nam_tasks set recurrence_series_id=gen_random_uuid(),recurrence_anchor_date=(changes->>'due_date')::date,recurrence_occurrence=0 where id=requested_task_id;
  end if;
 end if;
 result:=public.nam_save_task_before_scheduling(w,requested_task_id,expected_version,changes);
 if result.status='Done' and previous.status is distinct from 'Done' and result.recurrence_rule is not null and not result.archived then
  next_date:=public.nam_task_occurrence_date(result.recurrence_anchor_date,result.recurrence_rule->>'frequency',(result.recurrence_rule->>'interval')::integer,result.recurrence_occurrence+1);
  if next_date is not null and (result.recurrence_rule->>'until' is null or next_date<=(result.recurrence_rule->>'until')::date) then
   select * into successor from public.nam_tasks t where t.workspace_id=w and t.recurrence_predecessor_id=result.id;
   if not found then
    payload:=jsonb_build_object('title',result.title,'description',result.description,'section',result.section,'owner_id',result.owner_id,'status','Todo','priority',result.priority,'due_date',next_date,'project_id',result.project_id,'production_stage',result.production_stage,'deliverable_id',result.deliverable_id);
    successor:=public.nam_save_task_before_scheduling(w,null,null,payload);
    update public.nam_tasks set recurrence_rule=result.recurrence_rule,recurrence_series_id=result.recurrence_series_id,recurrence_anchor_date=result.recurrence_anchor_date,recurrence_occurrence=result.recurrence_occurrence+1,recurrence_predecessor_id=result.id where id=successor.id;
    insert into public.nam_task_events(task_id,actor_id,kind,body) values(result.id,auth.uid(),'recurrence',jsonb_build_object('message','Created the next repeat occurrence','next_task_id',successor.id,'due_date',next_date));
    insert into public.nam_task_events(task_id,actor_id,kind,body) values(successor.id,auth.uid(),'recurrence',jsonb_build_object('message','Created from a completed repeat occurrence'));
   end if;
  end if;
 end if;
 return result;
end $$;

-- Acquire the graph lock before the retained create-request key lock. Internal
-- workflows already holding project locks call the same graph helper first.
-- Existing creation payload/retry validation is retained without cloning it.
alter function public.nam_create_task(uuid,jsonb,text) rename to nam_create_task_before_scheduling;
revoke all on function public.nam_create_task_before_scheduling(uuid,jsonb,text) from public,anon,authenticated,service_role;
create function public.nam_create_task(w uuid,changes jsonb,retry_key text default null) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
begin
 perform public.nam_task_schedule_lock(w);
 return public.nam_create_task_before_scheduling(w,changes,retry_key);
end $$;

alter function public.nam_task_action(uuid,uuid,text,jsonb) rename to nam_task_action_before_scheduling;
revoke all on function public.nam_task_action_before_scheduling(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.nam_task_action(w uuid,tid uuid,action text,input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform public.nam_task_schedule_lock(w);
 if action='delete' and public.nam_task_access(tid) and exists(
  select 1 from public.nam_task_dependencies d join public.nam_tasks t on t.id=d.task_id
  where d.workspace_id=w and d.prerequisite_id=tid and t.status='Done' and t.deleted_at is null)
 then raise exception 'A completed task depends on this task. Reopen it first' using errcode='40001';end if;
 return public.nam_task_action_before_scheduling(w,tid,action,input);
end $$;

-- Sort the complete matching authorized set before taking each page.
-- All024 project/deliverable fields, filters and invoker RLS stay authoritative.
create index nam_task_newest on public.nam_tasks(workspace_id,created_at desc,number desc) where deleted_at is null;
create or replace function public.nam_task_page(w uuid,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p integer:=coalesce((filters->>'page')::integer,1); size integer:=coalesce((filters->>'pageSize')::integer,200); total bigint; rows jsonb;
 archived_filter boolean:=coalesce((filters->>'archived')::boolean,false); term text:=coalesce(filters->>'search','');
 focus text:=coalesce(filters->>'focus',''); actor_id uuid:=(select auth.uid()); founder boolean:=public.nam_founder(w); predicate text; statement text; sort_order text:=coalesce(filters->>'sort','due_date'); ordering text;
begin
 if sort_order not in ('due_date','priority','newest','title') then raise exception 'Choose a supported task sort' using errcode='22023';end if;
 ordering:=case sort_order
 when 'priority' then 'case t.priority when ''Urgent'' then 0 when ''High'' then 1 when ''Normal'' then 2 else 3 end,t.due_date nulls last,t.number'
 when 'newest' then 't.created_at desc,t.number desc'
 when 'title' then 'lower(t.title),t.title,t.number'
 else '(t.status in (''Done'',''Canceled'')),t.due_date nulls last,case t.priority when ''Urgent'' then 0 when ''High'' then 1 when ''Normal'' then 2 else 3 end,t.number' end;
 if p<1 or p>100000 or size<1 or size>200 or length(term)>200 or focus not in ('','open','attention','today','upcoming','blocked','overdue','unscheduled','completed') then raise exception 'Invalid page, focus or search' using errcode='22023';end if;
 predicate:='t.workspace_id=$1 and t.deleted_at is null and t.archived=$3';
 if not founder or coalesce((filters->>'mine')::boolean,false) then predicate:=predicate||' and t.owner_id=$2';end if;
 predicate:=predicate||' and (coalesce($4->>''section'','''')='''' or t.section=$4->>''section'')
 and (coalesce($4->>''owner'','''')='''' or t.owner_id::text=$4->>''owner'')
 and (coalesce($4->>''project_id'','''')='''' or t.project_id::text=$4->>''project_id'')
 and (coalesce($4->>''deliverable_id'','''')='''' or t.deliverable_id::text=$4->>''deliverable_id'')
 and (coalesce($4->>''status'','''')='''' or t.status=$4->>''status'')
 and (coalesce($4->>''priority'','''')='''' or t.priority=$4->>''priority'')
 and ($5='''' or position(lower($5) in lower(t.title||'' ''||t.description))>0)';
 if focus='completed' then predicate:=predicate||' and t.status=''Done''';
 elsif focus<>'' then
  predicate:=predicate||' and t.status not in (''Done'',''Canceled'')';
  if focus='attention' then predicate:=predicate||' and (t.due_date<(now() at time zone ''Europe/Paris'')::date or t.status=''Blocked'' or t.production_stage in (''Internal review'',''Client review''))';
  elsif focus='today' then predicate:=predicate||' and (t.due_date<=(now() at time zone ''Europe/Paris'')::date or t.status in (''In progress'',''Blocked''))';
  elsif focus='upcoming' then predicate:=predicate||' and t.due_date>(now() at time zone ''Europe/Paris'')::date and t.due_date<=(now() at time zone ''Europe/Paris'')::date+7';
  elsif focus='blocked' then predicate:=predicate||' and t.status=''Blocked''';
  elsif focus='overdue' then predicate:=predicate||' and t.due_date<(now() at time zone ''Europe/Paris'')::date';
  elsif focus='unscheduled' then predicate:=predicate||' and t.due_date is null';end if;
 end if;
 execute 'select count(*) from public.nam_tasks t where '||predicate into total using w,actor_id,archived_filter,filters,term;
 statement:='select coalesce(jsonb_agg(to_jsonb(result)),''[]''::jsonb) from (
 select t.id,t.number,t.workspace_id,t.title,''''::text as description,t.section,t.status,t.priority,t.due_date,t.owner_id,t.created_by,t.version,t.archived,t.deleted_at,t.completed_at,t.created_at,t.updated_at,t.project_id,t.production_stage,t.deliverable_id,
 (select p.title from public.nam_projects p where p.id=t.project_id and p.workspace_id=t.workspace_id) as project_title,
 (select d.code from public.nam_deliverables d where d.id=t.deliverable_id and d.workspace_id=t.workspace_id) as deliverable_code
 from public.nam_tasks t where '||predicate||'
 order by '||ordering||' limit $6 offset $7) result';
 execute statement into rows using w,actor_id,archived_filter,filters,term,size,(p-1)*size;
 return jsonb_build_object('items',rows,'total',total,'sort',sort_order,'page',p,'pageSize',size,'hasMore',p::bigint*size<total);
end $$;

create function public.nam_task_calendar(w uuid,from_date date,to_date date,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p integer:=coalesce((filters->>'page')::integer,1); size integer:=coalesce((filters->>'pageSize')::integer,100); result jsonb;
begin
 if public.nam_role(w) is null or not public.nam_assured() then raise exception 'Workspace access required' using errcode='42501';end if;
 if from_date is null or to_date is null or from_date<date '0001-01-01' or to_date>date '9999-12-31' or to_date<from_date or to_date-from_date>365
 or jsonb_typeof(filters) is distinct from 'object' or filters-array['page','pageSize','section','owner','status','priority','project_id','deliverable_id','search','mine','archived','focus']<>'{}'::jsonb
 or p not between 1 and 100000 or size not between 1 and 200 or length(coalesce(filters->>'search',''))>200 then raise exception 'Choose an explicit calendar window of at most 366 days and a bounded page' using errcode='22023';end if;
 if (filters?'section' and filters->>'section' not in ('sales','academy','projects','library','team','operations'))
 or (filters?'status' and filters->>'status' not in ('Backlog','Todo','In progress','Blocked','Done','Canceled'))
 or (filters?'priority' and filters->>'priority' not in ('Low','Normal','High','Urgent'))
 or (filters?'focus' and filters->>'focus' not in ('open','attention','today','upcoming','blocked','overdue','unscheduled','completed'))
 or exists(select 1 from jsonb_each(filters) f where f.key in ('section','status','priority','focus','owner','project_id','deliverable_id','search') and jsonb_typeof(f.value) is distinct from 'string')
 or exists(select 1 from jsonb_each(filters) f where f.key in ('owner','project_id','deliverable_id') and (f.value#>>'{}')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
 or exists(select 1 from jsonb_each(filters) f where f.key in ('mine','archived') and jsonb_typeof(f.value) is distinct from 'boolean') then raise exception 'Invalid calendar filters' using errcode='22023';end if;
 with visible as materialized (
  select t.id,t.number,t.title,t.section,t.status,t.priority,t.due_date,t.owner_id,t.version,t.project_id,t.production_stage,t.deliverable_id,t.archived,
   t.recurrence_rule is not null as repeating,
   (select p.title from public.nam_projects p where p.workspace_id=w and p.id=t.project_id) as project_title,
   (select d.code from public.nam_deliverables d where d.workspace_id=w and d.id=t.deliverable_id) as deliverable_code
  from public.nam_tasks t where t.workspace_id=w and t.deleted_at is null and t.archived=coalesce((filters->>'archived')::boolean,false)
  and (public.nam_founder(w) and not coalesce((filters->>'mine')::boolean,false) or t.owner_id=auth.uid())
  and (not(filters?'section') or t.section=filters->>'section') and (not(filters?'owner') or t.owner_id=(filters->>'owner')::uuid)
  and (not(filters?'status') or t.status=filters->>'status') and (not(filters?'priority') or t.priority=filters->>'priority')
  and (not(filters?'project_id') or t.project_id=(filters->>'project_id')::uuid) and (not(filters?'deliverable_id') or t.deliverable_id=(filters->>'deliverable_id')::uuid)
  and (coalesce(filters->>'search','')='' or position(lower(filters->>'search') in lower(t.title||' '||t.description))>0)
  and case coalesce(filters->>'focus','')
   when '' then true when 'completed' then t.status='Done' when 'unscheduled' then t.status not in ('Done','Canceled') and t.due_date is null
   when 'open' then t.status not in ('Done','Canceled')
   when 'blocked' then t.status='Blocked'
   when 'overdue' then t.status not in ('Done','Canceled') and t.due_date<(now() at time zone 'Europe/Paris')::date
   when 'upcoming' then t.status not in ('Done','Canceled') and t.due_date>(now() at time zone 'Europe/Paris')::date and t.due_date<=(now() at time zone 'Europe/Paris')::date+7
   when 'today' then t.status not in ('Done','Canceled') and (t.due_date<=(now() at time zone 'Europe/Paris')::date or t.status in ('In progress','Blocked'))
   when 'attention' then t.status not in ('Done','Canceled') and (t.due_date<(now() at time zone 'Europe/Paris')::date or t.status='Blocked' or t.production_stage in ('Internal review','Client review')) else false end
 ), windowed as materialized (select * from visible where due_date between from_date and to_date)
 select jsonb_build_object('from',from_date,'to',to_date,'timezone','Europe/Paris','today',(now() at time zone 'Europe/Paris')::date,
  'access_revision',(select m.access_revision from public.nam_memberships m where m.workspace_id=w and m.user_id=auth.uid()),
  'access_sections',public.nam_effective_access(w)->'sections',
  'scope',case when public.nam_founder(w) and not coalesce((filters->>'mine')::boolean,false) then 'studio' else 'assigned' end,
  'items',coalesce((select jsonb_agg(to_jsonb(q) order by q.due_date,q.number) from (select * from windowed order by due_date,number limit size offset (p-1)*size) q),'[]'::jsonb),
  'total',(select count(*) from windowed),'unscheduled_total',(select count(*) from visible where due_date is null),
  'days',coalesce((select jsonb_agg(to_jsonb(q) order by q.due_date) from (select due_date,count(*) as total from windowed group by due_date) q),'[]'::jsonb),
  'page',p,'pageSize',size,'hasMore',p::bigint*size<(select count(*) from windowed)) into result;
 return result;
end $$;

-- Revalidate the bounded response after any intervening request identity
-- checks. A live role alone does not detect revoked sections or reassignment.
create function public.nam_task_calendar_authorized(w uuid,task_ids jsonb,observed_revision integer,observed_sections jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
 if jsonb_typeof(task_ids) is distinct from 'array' or jsonb_array_length(task_ids)>200 or jsonb_typeof(observed_sections) is distinct from 'array' or jsonb_array_length(observed_sections)>6
 or not public.nam_assured() or public.nam_role(w) is null then return false;end if;
 if exists(select 1 from jsonb_array_elements(task_ids) e(value) where jsonb_typeof(e.value) is distinct from 'string' or (e.value#>>'{}')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then return false;end if;
 return observed_revision is not distinct from (select m.access_revision from public.nam_memberships m where m.workspace_id=w and m.user_id=auth.uid())
 and observed_sections is not distinct from (public.nam_effective_access(w)->'sections')
 and jsonb_array_length(task_ids)=(select count(*) from public.nam_tasks t where t.workspace_id=w and t.id in(select e.value::uuid from jsonb_array_elements_text(task_ids) e(value)) and t.deleted_at is null);
end $$;

revoke all on function public.nam_task_schedule_lock(uuid),public.nam_task_occurrence_date(date,text,integer,integer),public.nam_task_scheduling(uuid,uuid),public.nam_save_task_scheduling(uuid,uuid,integer,jsonb,text),public.nam_save_task(uuid,uuid,integer,jsonb),public.nam_create_task(uuid,jsonb,text),public.nam_task_action(uuid,uuid,text,jsonb),public.nam_task_calendar(uuid,date,date,jsonb),public.nam_task_calendar_authorized(uuid,jsonb,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.nam_task_scheduling(uuid,uuid),public.nam_save_task_scheduling(uuid,uuid,integer,jsonb,text),public.nam_save_task(uuid,uuid,integer,jsonb),public.nam_create_task(uuid,jsonb,text),public.nam_task_action(uuid,uuid,text,jsonb),public.nam_task_calendar(uuid,date,date,jsonb),public.nam_task_calendar_authorized(uuid,jsonb,integer,jsonb) to authenticated;
commit;
