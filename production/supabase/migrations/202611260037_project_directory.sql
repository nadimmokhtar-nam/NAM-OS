-- Directory sorting uses existing project timestamps under the same RLS.
-- This only extends the bounded read DTO; no record, grant or policy changes.
begin;
create or replace function public.nam_project_list(w uuid,include_archived boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(result) order by result.due_date nulls last,result.title),'[]'::jsonb) from (
  select p.id,p.title,p.due_date,p.start_date,p.client_name,p.project_type,p.location,
   p.created_at,p.updated_at,p.cover_render_id is not null as has_cover,p.lead_id,p.version,p.archived,
   count(t.id) as deliverables,count(t.id) filter(where t.status='Done') as completed,
   count(t.id) filter(where t.status='Blocked') as blocked,
   count(t.id) filter(where t.status not in ('Done','Canceled') and t.due_date<(now() at time zone 'Europe/Paris')::date) as overdue
  from public.nam_projects p left join public.nam_tasks t on t.workspace_id=p.workspace_id
   and t.project_id=p.id and t.deleted_at is null and not t.archived and t.status<>'Canceled'
  where p.workspace_id=w and p.archived=include_archived group by p.id
  order by p.due_date nulls last,p.title limit 200
 ) result
$$;
commit;
