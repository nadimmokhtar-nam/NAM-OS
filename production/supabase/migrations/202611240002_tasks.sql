begin;
alter table public.nam_tasks add column number bigint generated always as identity unique;
create index nam_events_task on public.nam_task_events(task_id,id desc);
create table public.nam_task_comments(id uuid primary key default gen_random_uuid(),task_id uuid not null references public.nam_tasks(id),author_id uuid not null references auth.users(id),body text not null check(length(trim(body)) between 1 and 5000),created_at timestamptz not null default now());
create index nam_comments_task on public.nam_task_comments(task_id,created_at,id);
create table public.nam_task_subtasks(id uuid primary key default gen_random_uuid(),task_id uuid not null references public.nam_tasks(id),title text not null check(length(trim(title)) between 1 and 200),completed boolean not null default false,created_at timestamptz not null default now());
create index nam_subtasks_task on public.nam_task_subtasks(task_id,created_at,id);
create table public.nam_notifications(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),recipient_id uuid not null,task_id uuid not null references public.nam_tasks(id),body text not null,kind text not null check(kind in ('assignment','due','overdue')),dedupe_key text not null,created_at timestamptz not null default now(),read_at timestamptz,foreign key(workspace_id,recipient_id) references public.nam_memberships(workspace_id,user_id),unique(recipient_id,dedupe_key));
create index nam_notification_recipient on public.nam_notifications(workspace_id,recipient_id,created_at desc);
create table public.nam_task_request_keys(workspace_id uuid not null,user_id uuid not null,scope text not null,key text not null,body jsonb not null,task_id uuid not null references public.nam_tasks(id),created_at timestamptz not null default now(),primary key(workspace_id,user_id,scope,key),foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id));
alter table public.nam_task_comments enable row level security;
alter table public.nam_task_subtasks enable row level security;
alter table public.nam_notifications enable row level security;
alter table public.nam_task_request_keys enable row level security;

create function public.nam_task_access(tid uuid,include_deleted boolean default false) returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.nam_tasks t where t.id=tid and public.nam_section(t.workspace_id,t.section) and (public.nam_founder(t.workspace_id) or t.owner_id=(select auth.uid())) and (t.deleted_at is null or (include_deleted and public.nam_founder(t.workspace_id))))$$;
drop policy tasks_read on public.nam_tasks;
create policy tasks_read on public.nam_tasks for select to authenticated using(public.nam_section(workspace_id,section) and (public.nam_founder(workspace_id) or (owner_id=(select auth.uid()) and deleted_at is null)));
create policy comments_read on public.nam_task_comments for select to authenticated using(public.nam_task_access(task_id));
create policy subtasks_read on public.nam_task_subtasks for select to authenticated using(public.nam_task_access(task_id));
create policy notifications_read on public.nam_notifications for select to authenticated using(recipient_id=(select auth.uid()) and public.nam_task_access(task_id));

-- Upgrade the original write function to enforce parent/subtask decisions.
create or replace function public.nam_save_task(w uuid,task_id uuid,expected_version integer,changes jsonb) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
declare old public.nam_tasks; result public.nam_tasks; next_owner uuid; next_section text; next_status text; founder boolean;
begin
 if auth.uid() is null or jsonb_typeof(changes) is distinct from 'object' then raise exception 'Access denied' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(changes) as fields(key) where fields.key not in ('title','description','section','owner_id','status','priority','due_date','archived','confirmOpenSubtasks')) then raise exception 'Unsupported field' using errcode='22023'; end if;
 if changes?'title' and (jsonb_typeof(changes->'title')<>'string' or length(trim(changes->>'title')) not between 1 and 200) then raise exception 'Invalid task name' using errcode='22023'; end if;
 if changes?'description' and (jsonb_typeof(changes->'description')<>'string' or length(changes->>'description')>10000) then raise exception 'Invalid description' using errcode='22023'; end if;
 if changes?'archived' and jsonb_typeof(changes->'archived')<>'boolean' then raise exception 'Invalid archive value' using errcode='22023'; end if;
 founder:=public.nam_founder(w);
 if task_id is not null then
  select * into old from public.nam_tasks t where t.id=task_id and t.workspace_id=w and t.deleted_at is null for update;
  if not found or not public.nam_task_access(task_id) then raise exception 'Task not found' using errcode='P0002'; end if;
  if expected_version is distinct from old.version then raise exception 'Task changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 end if;
 next_owner:=coalesce((changes->>'owner_id')::uuid,old.owner_id,auth.uid());
 next_section:=coalesce(changes->>'section',old.section);
 next_status:=coalesce(changes->>'status',old.status,'Todo');
 if not public.nam_section(w,next_section) then raise exception 'Section denied' using errcode='42501'; end if;
 if not founder and (next_owner<>auth.uid() or (old.id is not null and next_section<>old.section)) then raise exception 'Assignment denied' using errcode='42501'; end if;
 if not exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=next_owner and m.active and
  (m.role='founder' or (m.role in ('sales','sales_manager') and next_section in ('sales','academy','operations')) or
  (m.role in ('artist','production_manager','freelancer') and next_section in ('projects','academy','library','operations')))) then raise exception 'Owner ineligible' using errcode='22023'; end if;
 if next_status='Done' and old.status is distinct from 'Done' and exists(select 1 from public.nam_task_subtasks s where s.task_id=old.id and not s.completed) and coalesce(changes->'confirmOpenSubtasks','false'::jsonb)<>'true'::jsonb then raise exception 'This task has open subtasks. Complete them or confirm finishing the parent.' using errcode='40001'; end if;
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
 if result.owner_id<>auth.uid() and (old.id is null or old.owner_id<>result.owner_id) then
  insert into public.nam_notifications(workspace_id,recipient_id,task_id,body,kind,dedupe_key) values(w,result.owner_id,result.id,'Assigned to you: '||result.title,'assignment','assignment:'||result.id||':'||result.version) on conflict do nothing;
 end if;
 return result;
end $$;

create function public.nam_create_task(w uuid,changes jsonb,retry_key text default null) returns public.nam_tasks language plpgsql security definer set search_path='' as $$
declare previous public.nam_task_request_keys; result public.nam_tasks;
begin
 if auth.uid() is null then raise exception 'Access denied' using errcode='42501'; end if;
 if retry_key is not null then
  if retry_key !~ '^[a-zA-Z0-9_-]{8,128}$' then raise exception 'Invalid retry key' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||auth.uid()::text||retry_key,0));
  select * into previous from public.nam_task_request_keys k where k.workspace_id=w and k.user_id=auth.uid() and k.scope='create' and k.key=retry_key;
  if found then
   if previous.body<>changes then raise exception 'This retry key belongs to a different request' using errcode='40001'; end if;
   if not public.nam_task_access(previous.task_id) then raise exception 'Task not found' using errcode='P0002'; end if;
   select * into result from public.nam_tasks where id=previous.task_id; return result;
  end if;
 end if;
 result:=public.nam_save_task(w,null,null,changes);
 if retry_key is not null then insert into public.nam_task_request_keys(workspace_id,user_id,scope,key,body,task_id) values(w,auth.uid(),'create',retry_key,changes,result.id); end if;
 return result;
end $$;

create function public.nam_task_action(w uuid,tid uuid,action text,input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare task public.nam_tasks; sub public.nam_task_subtasks; content text;
begin
 if jsonb_typeof(input) is distinct from 'object' then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into task from public.nam_tasks t where t.id=tid and t.workspace_id=w for update;
 if not found or not public.nam_task_access(tid,action='restore') then raise exception 'Task not found' using errcode='P0002'; end if;
 if action='comment' then
  if input- 'body'<>'{}'::jsonb or jsonb_typeof(input->'body') is distinct from 'string' then raise exception 'Invalid comment' using errcode='22023'; end if;
  content:=trim(input->>'body');
  insert into public.nam_task_comments(task_id,author_id,body) values(tid,auth.uid(),content);
 elsif action='subtask' then
  if input- array['id','title','completed']<>'{}'::jsonb then raise exception 'Unsupported field' using errcode='22023'; end if;
  if input?'id' then
   if jsonb_typeof(input->'completed') is distinct from 'boolean' then raise exception 'Invalid subtask state' using errcode='22023'; end if;
   update public.nam_task_subtasks s set completed=(input->>'completed')::boolean where s.id=(input->>'id')::uuid and s.task_id=tid returning * into sub;
   if not found then raise exception 'Subtask not found' using errcode='P0002'; end if;
   content:=case when sub.completed then 'Completed: ' else 'Reopened: ' end||sub.title;
  else
   if jsonb_typeof(input->'title') is distinct from 'string' then raise exception 'Invalid subtask' using errcode='22023'; end if;
   insert into public.nam_task_subtasks(task_id,title) values(tid,trim(input->>'title')) returning * into sub;
   content:='Added: '||sub.title;
  end if;
 elsif action in ('delete','restore') then
  if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501'; end if;
  if action='delete' and (input- 'expectedVersion'<>'{}'::jsonb or (input->>'expectedVersion')::integer is distinct from task.version) then raise exception 'Task changed elsewhere. Reload before deleting.' using errcode='40001'; end if;
  if action='restore' and (input<>'{}'::jsonb or task.deleted_at is null) then raise exception 'Deleted task not found' using errcode='P0002'; end if;
  update public.nam_tasks set deleted_at=case when action='delete' then now() end,version=version+1,updated_at=now() where id=tid;
  content:=case when action='delete' then 'Moved to deleted records' else 'Restored from deleted records' end;
 else raise exception 'Unknown task action' using errcode='22023';
 end if;
 insert into public.nam_task_events(task_id,actor_id,kind,body) values(tid,auth.uid(),action,jsonb_build_object('message',content));
 return tid;
end $$;

create function public.nam_read_notifications(w uuid) returns void language sql security definer set search_path=''
as $$update public.nam_notifications n set read_at=now() where n.workspace_id=w and n.recipient_id=(select auth.uid()) and n.read_at is null and public.nam_task_access(n.task_id)$$;

-- A scheduler must explicitly call this RPC with server-only service identity.
-- It emits in-app reminders; email sending is not implemented by this function.
create function public.nam_process_reminders(w uuid) returns integer language plpgsql security definer set search_path='' as $$
declare count_inserted integer;
begin
 if not public.nam_founder(w) and (select auth.role()) is distinct from 'service_role' then raise exception 'Founder access required' using errcode='42501'; end if;
 insert into public.nam_notifications(workspace_id,recipient_id,task_id,body,kind,dedupe_key)
 select t.workspace_id,t.owner_id,t.id,case when t.due_date=(now() at time zone 'Europe/Paris')::date then 'Due today: ' else 'Overdue: ' end||t.title,
 case when t.due_date=(now() at time zone 'Europe/Paris')::date then 'due' else 'overdue' end,
 'reminder:'||t.id||':'||(now() at time zone 'Europe/Paris')::date
 from public.nam_tasks t join public.nam_memberships m on m.workspace_id=t.workspace_id and m.user_id=t.owner_id
 where t.workspace_id=w and m.active and not t.archived and t.deleted_at is null and t.status not in ('Done','Canceled') and t.due_date<=(now() at time zone 'Europe/Paris')::date
 on conflict do nothing;
 get diagnostics count_inserted=row_count; return count_inserted;
end $$;
revoke all on public.nam_task_comments,public.nam_task_subtasks,public.nam_notifications,public.nam_task_request_keys from anon,authenticated;
grant select on public.nam_task_comments,public.nam_task_subtasks,public.nam_notifications to authenticated;
revoke all on function public.nam_task_access(uuid,boolean),public.nam_create_task(uuid,jsonb,text),public.nam_task_action(uuid,uuid,text,jsonb),public.nam_read_notifications(uuid),public.nam_process_reminders(uuid) from public,anon,authenticated;
grant execute on function public.nam_task_access(uuid,boolean),public.nam_create_task(uuid,jsonb,text),public.nam_task_action(uuid,uuid,text,jsonb),public.nam_read_notifications(uuid) to authenticated;
grant execute on function public.nam_process_reminders(uuid) to authenticated,service_role;

-- Security-invoker aggregate/page queries retain the caller's RLS policies.
create function public.nam_task_page(w uuid,filters jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p integer:=coalesce((filters->>'page')::integer,1); size integer:=coalesce((filters->>'pageSize')::integer,200); total bigint; rows jsonb; archived_filter boolean:=coalesce((filters->>'archived')::boolean,false); term text:=coalesce(filters->>'search','');
begin
 if p<1 or p>100000 or size<1 or size>200 or length(term)>200 then raise exception 'Invalid page or search' using errcode='22023'; end if;
 select count(*) into total from public.nam_tasks t where t.workspace_id=w and t.deleted_at is null and t.archived=archived_filter
 and (coalesce(filters->>'section','')='' or t.section=filters->>'section') and (coalesce(filters->>'owner','')='' or t.owner_id::text=filters->>'owner')
 and (not coalesce((filters->>'mine')::boolean,false) or t.owner_id=auth.uid()) and (coalesce(filters->>'status','')='' or t.status=filters->>'status')
 and (coalesce(filters->>'priority','')='' or t.priority=filters->>'priority') and (term='' or position(lower(term) in lower(t.title||' '||t.description))>0);
 select coalesce(jsonb_agg(to_jsonb(result)),'[]'::jsonb) into rows from (
 select t.id,t.number,t.workspace_id,t.title,''::text as description,t.section,t.status,t.priority,t.due_date,t.owner_id,t.created_by,t.version,t.archived,t.deleted_at,t.completed_at,t.created_at,t.updated_at
 from public.nam_tasks t where t.workspace_id=w and t.deleted_at is null and t.archived=archived_filter
 and (coalesce(filters->>'section','')='' or t.section=filters->>'section') and (coalesce(filters->>'owner','')='' or t.owner_id::text=filters->>'owner')
 and (not coalesce((filters->>'mine')::boolean,false) or t.owner_id=auth.uid()) and (coalesce(filters->>'status','')='' or t.status=filters->>'status')
 and (coalesce(filters->>'priority','')='' or t.priority=filters->>'priority') and (term='' or position(lower(term) in lower(t.title||' '||t.description))>0)
 order by (t.status in ('Done','Canceled')),t.due_date nulls last,t.number limit size offset ((p-1)*size)
 ) result;
 return jsonb_build_object('items',rows,'total',total,'page',p,'pageSize',size,'hasMore',p::bigint*size<total);
end $$;
create function public.nam_task_stats(w uuid) returns jsonb language sql stable security invoker set search_path=''
as $$ select jsonb_build_object('total',count(*),'open',count(*) filter(where status not in ('Done','Canceled')),'dueToday',count(*) filter(where status not in ('Done','Canceled') and due_date=(now() at time zone 'Europe/Paris')::date),'overdue',count(*) filter(where status not in ('Done','Canceled') and due_date<(now() at time zone 'Europe/Paris')::date)) from public.nam_tasks where workspace_id=w and deleted_at is null and not archived $$;
revoke all on function public.nam_task_page(uuid,jsonb),public.nam_task_stats(uuid) from public,anon;
grant execute on function public.nam_task_page(uuid,jsonb),public.nam_task_stats(uuid) to authenticated;
commit;
