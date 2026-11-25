-- Authoritative operational views: pagination cannot hide an overdue item
-- from the brief's counts. All queries run under the caller's existing RLS.
begin;
create or replace function public.nam_task_page(w uuid,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p integer:=coalesce((filters->>'page')::integer,1); size integer:=coalesce((filters->>'pageSize')::integer,200); total bigint; rows jsonb;
 archived_filter boolean:=coalesce((filters->>'archived')::boolean,false); term text:=coalesce(filters->>'search','');
 focus text:=coalesce(filters->>'focus',''); actor_id uuid:=(select auth.uid()); founder boolean:=public.nam_founder(w); predicate text; statement text;
begin
 if p<1 or p>100000 or size<1 or size>200 or length(term)>200 or focus not in ('','open','today','upcoming','blocked','overdue','unscheduled','completed') then raise exception 'Invalid page, focus or search' using errcode='22023';end if;
 predicate:='t.workspace_id=$1 and t.deleted_at is null and t.archived=$3';
 if not founder or coalesce((filters->>'mine')::boolean,false) then predicate:=predicate||' and t.owner_id=$2';end if;
 predicate:=predicate||' and (coalesce($4->>''section'','''')='''' or t.section=$4->>''section'')
 and (coalesce($4->>''owner'','''')='''' or t.owner_id::text=$4->>''owner'')
 and (coalesce($4->>''project_id'','''')='''' or t.project_id::text=$4->>''project_id'')
 and (coalesce($4->>''status'','''')='''' or t.status=$4->>''status'')
 and (coalesce($4->>''priority'','''')='''' or t.priority=$4->>''priority'')
 and ($5='''' or position(lower($5) in lower(t.title||'' ''||t.description))>0)';
 if focus='completed' then predicate:=predicate||' and t.status=''Done''';
 elsif focus<>'' then
  predicate:=predicate||' and t.status not in (''Done'',''Canceled'')';
  if focus='today' then predicate:=predicate||' and (t.due_date<=(now() at time zone ''Europe/Paris'')::date or t.status in (''In progress'',''Blocked''))';
  elsif focus='upcoming' then predicate:=predicate||' and t.due_date>(now() at time zone ''Europe/Paris'')::date and t.due_date<=(now() at time zone ''Europe/Paris'')::date+7';
  elsif focus='blocked' then predicate:=predicate||' and t.status=''Blocked''';
  elsif focus='overdue' then predicate:=predicate||' and t.due_date<(now() at time zone ''Europe/Paris'')::date';
  elsif focus='unscheduled' then predicate:=predicate||' and t.due_date is null';end if;
 end if;
 execute 'select count(*) from public.nam_tasks t where '||predicate into total using w,actor_id,archived_filter,filters,term;
 statement:='select coalesce(jsonb_agg(to_jsonb(result)),''[]''::jsonb) from (
 select t.id,t.number,t.workspace_id,t.title,''''::text as description,t.section,t.status,t.priority,t.due_date,t.owner_id,t.created_by,t.version,t.archived,t.deleted_at,t.completed_at,t.created_at,t.updated_at,t.project_id,t.production_stage,
 (select p.title from public.nam_projects p where p.id=t.project_id and p.workspace_id=t.workspace_id) as project_title
 from public.nam_tasks t where '||predicate||'
 order by (t.status in (''Done'',''Canceled'')),t.due_date nulls last,
 case t.priority when ''Urgent'' then 0 when ''High'' then 1 when ''Normal'' then 2 else 3 end,t.number limit $6 offset $7) result';
 execute statement into rows using w,actor_id,archived_filter,filters,term,size,(p-1)*size;
 return jsonb_build_object('items',rows,'total',total,'page',p,'pageSize',size,'hasMore',p::bigint*size<total);
end $$;

create function public.nam_daily_brief(w uuid,scope text default 'mine') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare today date:=(now() at time zone 'Europe/Paris')::date; result jsonb;
begin
 if scope not in ('mine','studio') then raise exception 'Invalid daily brief scope' using errcode='22023';end if;
 if scope='studio' and not public.nam_founder(w) then raise exception 'Founder access required for studio brief' using errcode='42501';end if;
 with visible as materialized (
  select t.id,t.number,t.title,t.section,t.status,t.priority,t.due_date,t.owner_id,t.version,t.project_id,t.production_stage,t.completed_at,
   t.status not in ('Done','Canceled') as is_open
  from public.nam_tasks t where t.workspace_id=w and t.deleted_at is null and not t.archived and (scope='studio' or t.owner_id=auth.uid())
 ), counts as (
  select jsonb_build_object('open',count(*) filter(where is_open),
   'today',count(*) filter(where is_open and (due_date<=today or status in ('In progress','Blocked'))),
   'overdue',count(*) filter(where is_open and due_date<today),
   'blocked',count(*) filter(where is_open and status='Blocked'),
   'review',count(*) filter(where is_open and production_stage in ('Internal review','Client review')),
   'upcoming',count(*) filter(where is_open and due_date>today and due_date<=today+7),
   'unscheduled',count(*) filter(where is_open and due_date is null),
   'completed_week',count(*) filter(where status='Done' and completed_at>=today-6)) as value from visible
 )
 select jsonb_build_object('scope',scope,'today',today,'counts',(select value from counts),
  'attention',coalesce((select jsonb_agg(to_jsonb(q)-'is_open') from (
   select * from visible where is_open and (due_date<today or status='Blocked' or production_stage in ('Internal review','Client review'))
   order by (status='Blocked') desc,due_date nulls last,number limit 8) q),'[]'::jsonb),
  'priorities',coalesce((select jsonb_agg(to_jsonb(q)-'is_open') from (
   select * from visible where is_open and status<>'Blocked' and (due_date<=today or status='In progress')
   order by due_date nulls last,case priority when 'Urgent' then 0 when 'High' then 1 when 'Normal' then 2 else 3 end,number limit 8) q),'[]'::jsonb),
  'upcoming',coalesce((select jsonb_agg(to_jsonb(q)-'is_open') from (
   select * from visible where is_open and due_date>today and due_date<=today+7 order by due_date,number limit 6) q),'[]'::jsonb),
  'completed',coalesce((select jsonb_agg(to_jsonb(q)-'is_open') from (
   select * from visible where status='Done' and completed_at>=today-6 order by completed_at desc,number desc limit 5) q),'[]'::jsonb),
  'workload',case when scope='studio' then coalesce((select jsonb_agg(to_jsonb(q)) from (
   select owner_id,count(*) filter(where is_open) as open,count(*) filter(where is_open and status='Blocked') as blocked,
    count(*) filter(where is_open and due_date<today) as overdue,min(due_date) filter(where is_open) as next_due
   from visible group by owner_id having count(*) filter(where is_open)>0
   order by count(*) filter(where is_open and status='Blocked') desc,count(*) filter(where is_open and due_date<today) desc,owner_id limit 12) q),'[]'::jsonb) else '[]'::jsonb end
 ) into result;
 return result;
end $$;
revoke all on function public.nam_daily_brief(uuid,text) from public,anon;
grant execute on function public.nam_daily_brief(uuid,text) to authenticated;
commit;
