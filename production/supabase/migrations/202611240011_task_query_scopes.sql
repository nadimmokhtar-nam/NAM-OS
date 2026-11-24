-- Evaluate trusted membership/session scopes once per statement rather than
-- re-reading managed auth tables for every task scanned by RLS. This retains
-- active membership, actual session validity and factor assurance checks.
begin;
create function public.nam_task_read_scopes() returns table(workspace_id uuid,section text,all_tasks boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.nam_assured() then return; end if;
 return query
 select m.workspace_id,permitted.section,m.role='founder'
 from public.nam_memberships m
 cross join lateral unnest(case
  when m.role='founder' then array['sales','academy','projects','library','team','operations']::text[]
  when m.role in ('sales','sales_manager') then array['sales','academy','operations']::text[]
  when m.role in ('production_manager','artist','freelancer') then array['projects','academy','library','operations']::text[]
  else array[]::text[] end) as permitted(section)
 where m.user_id=(select auth.uid()) and m.active
 and (m.role<>'founder' or coalesce((select auth.jwt()->>'aal')='aal2',false));
end $$;
revoke all on function public.nam_task_read_scopes() from public,anon;
grant execute on function public.nam_task_read_scopes() to authenticated;
drop policy tasks_read on public.nam_tasks;
create policy tasks_read on public.nam_tasks for select to authenticated using(
 (workspace_id,section) in (select s.workspace_id,s.section from public.nam_task_read_scopes() s where s.all_tasks)
 or (owner_id=(select auth.uid()) and deleted_at is null and
  (workspace_id,section) in (select s.workspace_id,s.section from public.nam_task_read_scopes() s))
);
create index nam_task_assigned_page on public.nam_tasks(workspace_id,owner_id,archived,due_date,number) where deleted_at is null;

-- Fixed SQL fragments only; all user values remain bound parameters. Explicit
-- assigned-owner restriction gives the planner a usable index condition and
-- does not depend on the more general founder-or-owner RLS expression.
create or replace function public.nam_task_page(w uuid,filters jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p integer:=coalesce((filters->>'page')::integer,1); size integer:=coalesce((filters->>'pageSize')::integer,200); total bigint; rows jsonb;
 archived_filter boolean:=coalesce((filters->>'archived')::boolean,false); term text:=coalesce(filters->>'search','');
 actor_id uuid:=(select auth.uid()); founder boolean:=public.nam_founder(w); predicate text; statement text;
begin
 if p<1 or p>100000 or size<1 or size>200 or length(term)>200 then raise exception 'Invalid page or search' using errcode='22023'; end if;
 predicate:='t.workspace_id=$1 and t.deleted_at is null and t.archived=$3';
 if not founder or coalesce((filters->>'mine')::boolean,false) then predicate:=predicate||' and t.owner_id=$2';end if;
 predicate:=predicate||' and (coalesce($4->>''section'','''')='''' or t.section=$4->>''section'')
 and (coalesce($4->>''owner'','''')='''' or t.owner_id::text=$4->>''owner'')
 and (coalesce($4->>''status'','''')='''' or t.status=$4->>''status'')
 and (coalesce($4->>''priority'','''')='''' or t.priority=$4->>''priority'')
 and ($5='''' or position(lower($5) in lower(t.title||'' ''||t.description))>0)';
 execute 'select count(*) from public.nam_tasks t where '||predicate into total using w,actor_id,archived_filter,filters,term;
 statement:='select coalesce(jsonb_agg(to_jsonb(result)),''[]''::jsonb) from (
 select t.id,t.number,t.workspace_id,t.title,''''::text as description,t.section,t.status,t.priority,t.due_date,t.owner_id,t.created_by,t.version,t.archived,t.deleted_at,t.completed_at,t.created_at,t.updated_at
 from public.nam_tasks t where '||predicate||'
 order by (t.status in (''Done'',''Canceled'')),t.due_date nulls last,t.number limit $6 offset $7) result';
 execute statement into rows using w,actor_id,archived_filter,filters,term,size,(p-1)*size;
 return jsonb_build_object('items',rows,'total',total,'page',p,'pageSize',size,'hasMore',p::bigint*size<total);
end $$;
commit;
