-- Correct production summaries without changing project or task access.
-- A shared participant can read the same project in Today and Projects;
-- canceled deliverables leave completion totals, while their history remains.
begin;

-- Read only the caller's participation. Project-membership table visibility
-- remains Founder-only; no other participant identities are returned.
create function public.nam_project_participant(w uuid,pid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_project_access(w,pid) and exists(
  select 1 from public.nam_project_members pm
  where pm.workspace_id=w and pm.project_id=pid and pm.user_id=(select auth.uid()))
$$;
revoke all on function public.nam_project_participant(uuid,uuid) from public,anon,authenticated;
grant execute on function public.nam_project_participant(uuid,uuid) to authenticated;

create or replace function public.nam_project_list(w uuid,include_archived boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(result) order by result.due_date nulls last,result.title),'[]'::jsonb) from (
  select p.id,p.title,p.due_date,p.lead_id,p.version,p.archived,
   count(t.id) as deliverables,count(t.id) filter(where t.status='Done') as completed,
   count(t.id) filter(where t.status='Blocked') as blocked,
   count(t.id) filter(where t.status not in ('Done','Canceled') and t.due_date<(now() at time zone 'Europe/Paris')::date) as overdue
  from public.nam_projects p left join public.nam_tasks t on t.workspace_id=p.workspace_id and t.project_id=p.id and t.deleted_at is null and not t.archived and t.status<>'Canceled'
  where p.workspace_id=w and p.archived=include_archived group by p.id,p.title,p.due_date,p.lead_id,p.version,p.archived
  order by p.due_date nulls last,p.title limit 200
 ) result
$$;

create or replace function public.nam_daily_brief(w uuid,scope text default 'mine') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare today date:=(now() at time zone 'Europe/Paris')::date; result jsonb; member_access jsonb;
begin
 if scope not in ('mine','studio') then raise exception 'Invalid daily brief scope' using errcode='22023';end if;
 if scope='studio' and not public.nam_founder(w) then raise exception 'Founder access required for studio brief' using errcode='42501';end if;
 member_access:=public.nam_effective_access(w);
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
   select * from visible where is_open and status<>'Blocked' and (due_date<=today or status='In progress') and (due_date is null or due_date>=today) and (production_stage is null or production_stage not in ('Internal review','Client review'))
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
 -- A project deadline remains visible even before every image has a task date.
 -- Task-derived progress remains limited to the caller's existing visibility.
 result:=result||jsonb_build_object('projects',coalesce((
  select jsonb_agg(to_jsonb(q)) from (
   select p.id,p.title,p.due_date,
    count(t.id) as deliverables,count(t.id) filter(where t.status='Done') as completed,
    count(t.id) filter(where t.status='Blocked') as blocked,
    count(t.id) filter(where t.status not in ('Done','Canceled') and t.due_date<today) as overdue,
    count(t.id) filter(where t.status not in ('Done','Canceled') and t.production_stage in ('Internal review','Client review')) as reviews
   from public.nam_projects p left join public.nam_tasks t on t.workspace_id=p.workspace_id and t.project_id=p.id and t.deleted_at is null and not t.archived and t.status<>'Canceled'
   where p.workspace_id=w and not p.archived and (scope='studio' or public.nam_project_participant(w,p.id))
   group by p.id,p.title,p.due_date
   having count(t.id)=0 or count(t.id) filter(where t.status<>'Done')>0
   order by (p.due_date<today) desc nulls last,count(t.id) filter(where t.status='Blocked') desc,count(t.id) filter(where t.status<>'Done' and t.due_date<today) desc,p.due_date nulls last,p.id limit 3
  ) q
 ),'[]'::jsonb));
 -- Activity is an explicitly labelled, member-reported ledger. It is never
 -- added to provider counts or represented as verified CRM performance.
 if public.nam_section(w,'sales') and exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=auth.uid() and m.role in ('founder','sales_manager','sales')) then
  result:=result||jsonb_build_object('sales',coalesce((
   select jsonb_agg(to_jsonb(summary)) from (
    select m.user_id as owner_id,
     (select count(*) from public.nam_sales_activities a where a.workspace_id=w and a.owner_id=m.user_id and a.deleted_at is null and a.occurred_on=today) as today_activities,
     (select count(*) from public.nam_sales_activities a where a.workspace_id=w and a.owner_id=m.user_id and a.deleted_at is null and a.occurred_on between today-(extract(isodow from today)::integer-1) and today) as week_activities,
     (select count(*) from public.nam_sales_activities a where a.workspace_id=w and a.owner_id=m.user_id and a.deleted_at is null and a.type='Meeting held' and a.occurred_on between today-(extract(isodow from today)::integer-1) and today) as week_meetings,
     (select max(a.occurred_on) from public.nam_sales_activities a where a.workspace_id=w and a.owner_id=m.user_id and a.deleted_at is null and a.occurred_on<=today) as last_activity,
     (select count(*) from public.nam_tasks t where t.workspace_id=w and t.owner_id=m.user_id and t.section='sales' and t.deleted_at is null and not t.archived and t.status not in ('Done','Canceled') and t.due_date<today) as overdue_followups
    from public.nam_memberships m where m.workspace_id=w and m.active and m.role in ('sales','sales_manager') and (member_access->'member_sections'->(m.user_id::text) ? 'sales') and (scope='studio' or m.user_id=auth.uid())
    order by m.name,m.user_id limit 12
   ) summary
  ),'[]'::jsonb));
 else result:=result||jsonb_build_object('sales','[]'::jsonb);end if;

 if scope='studio' then
  with pending as materialized (
   select 'sales_report'::text as kind,r.id,r.owner_id,'Weekly sales report'::text as title,r.week_start::text as context,r.submitted_at,null::integer as revision
   from public.nam_sales_reports r where r.workspace_id=w and r.reviewed_at is null
   union all
   select 'academy_submission',s.id,s.user_id,a.title,v.title,s.submitted_at,s.revision
   from public.nam_academy_submissions s
   join public.nam_academy_assignments a on a.id=s.assignment_id and a.workspace_id=s.workspace_id
   join public.nam_course_versions v on v.id=a.course_version_id and v.workspace_id=a.workspace_id
   join public.nam_courses c on c.id=v.course_id and c.workspace_id=v.workspace_id
   where s.workspace_id=w and s.status='submitted' and not c.archived
  )
  select result||jsonb_build_object('review_counts',jsonb_build_object('sales',count(*) filter(where kind='sales_report'),'academy',count(*) filter(where kind='academy_submission')),
   'reviews',coalesce((select jsonb_agg(to_jsonb(q)) from (select * from pending order by submitted_at,id limit 8) q),'[]'::jsonb)) into result from pending;
 else result:=result||jsonb_build_object('review_counts',jsonb_build_object('sales',0,'academy',0),'reviews','[]'::jsonb);end if;

 result:=result||jsonb_build_object('learning_feedback',coalesce((
  select jsonb_agg(to_jsonb(q)) from (
   select s.id,a.title,v.course_id,v.title as course_title from public.nam_academy_submissions s
   join public.nam_academy_assignments a on a.id=s.assignment_id and a.workspace_id=s.workspace_id
   join public.nam_course_versions v on v.id=a.course_version_id and v.workspace_id=a.workspace_id
   join public.nam_enrollments e on e.course_version_id=v.id and e.workspace_id=v.workspace_id and e.user_id=s.user_id and e.revoked_at is null
   join public.nam_courses c on c.id=v.course_id and c.workspace_id=v.workspace_id
   where s.workspace_id=w and s.user_id=auth.uid() and s.status='changes_requested' and not c.archived
   order by s.reviewed_at desc,s.id limit 4
  ) q
 ),'[]'::jsonb));
 return result;
end $$;

commit;
