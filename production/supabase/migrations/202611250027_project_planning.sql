-- Shared project context and an explicit plan. Task/image permissions remain
-- independent; a planned phase never completes work or approves a render.
begin;
alter table public.nam_projects add column start_date date check(start_date is null or start_date between date '0001-01-01' and date '9999-12-31');
alter table public.nam_projects add column client_name text not null default '' check(length(client_name)<=200);
alter table public.nam_projects add column project_type text not null default '' check(length(project_type)<=100);
alter table public.nam_projects add column location text not null default '' check(length(location)<=200);
alter table public.nam_projects add column cover_render_id uuid;
alter table public.nam_projects add foreign key(workspace_id,cover_render_id) references public.nam_render_versions(workspace_id,id);
alter table public.nam_projects add constraint nam_project_date_range check(start_date is null or due_date is null or start_date<=due_date);
grant select(start_date,client_name,project_type,location,cover_render_id) on public.nam_projects to authenticated;

-- Expanded project writes retain the original versions, retry payloads and events.
create or replace function public.nam_save_project(w uuid,pid uuid,expected_version integer,changes jsonb,retry_key text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_projects; result public.nam_projects; members jsonb; target uuid; lead uuid;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if jsonb_typeof(changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(changes) f(k) where k not in ('title','brief','outcome','reference_url','due_date','lead_id','member_ids','archived','start_date','client_name','project_type','location','cover_render_id')) then raise exception 'Invalid project fields' using errcode='22023';end if;
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
 if (changes?'client_name' and jsonb_typeof(changes->'client_name') is distinct from 'string') or (changes?'project_type' and jsonb_typeof(changes->'project_type') is distinct from 'string') or (changes?'location' and jsonb_typeof(changes->'location') is distinct from 'string') then raise exception 'Invalid shared project context' using errcode='22023';end if;
 if nullif(changes->>'cover_render_id','') is not null then
  if pid is null then raise exception 'Choose a project image after creating the project' using errcode='22023';end if;
  perform 1 from public.nam_render_versions r join public.nam_deliverables d on d.workspace_id=r.workspace_id and d.id=r.deliverable_id
   where r.workspace_id=w and r.id=(changes->>'cover_render_id')::uuid and r.status='ready' and d.project_id=pid and not d.archived for share of r,d;
  if not found then raise exception 'Choose a verified render from this project' using errcode='22023';end if;
 end if;
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
  insert into public.nam_projects(workspace_id,title,brief,outcome,reference_url,due_date,lead_id,created_by,request_key,create_payload,start_date,client_name,project_type,location)
  values(w,trim(changes->>'title'),coalesce(changes->>'brief',''),coalesce(changes->>'outcome',''),coalesce(changes->>'reference_url',''),nullif(changes->>'due_date','')::date,lead,auth.uid(),retry_key,changes,nullif(changes->>'start_date','')::date,coalesce(changes->>'client_name',''),coalesce(changes->>'project_type',''),coalesce(changes->>'location','')) returning * into result;
 else
  update public.nam_projects set title=coalesce(trim(changes->>'title'),previous.title),brief=coalesce(changes->>'brief',previous.brief),outcome=coalesce(changes->>'outcome',previous.outcome),reference_url=coalesce(changes->>'reference_url',previous.reference_url),
   due_date=case when changes?'due_date' then nullif(changes->>'due_date','')::date else previous.due_date end,
   start_date=case when changes?'start_date' then nullif(changes->>'start_date','')::date else previous.start_date end,client_name=coalesce(changes->>'client_name',previous.client_name),project_type=coalesce(changes->>'project_type',previous.project_type),location=coalesce(changes->>'location',previous.location),
   cover_render_id=case when changes?'cover_render_id' then nullif(changes->>'cover_render_id','')::uuid else previous.cover_render_id end,
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

create table public.nam_project_phases (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 100),
 production_stage text check(production_stage is null or production_stage in ('Briefing','Modelling','Camera approval','Materials and lighting','Draft production','Internal review','Client review','Revisions','Final approval','Delivery')),
 start_date date check(start_date is null or start_date between date '0001-01-01' and date '9999-12-31'),
 end_date date check(end_date is null or end_date between date '0001-01-01' and date '9999-12-31'),
 status text not null default 'planned' check(status in ('planned','in_progress','complete','cancelled')),
 note text not null default '' check(length(note)<=5000),position integer not null default 1 check(position between 1 and 1000),
 archived boolean not null default false,version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id),request_key text not null,create_payload jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id),
 unique(workspace_id,id),unique(workspace_id,created_by,request_key),
 check(start_date is null or end_date is null or start_date<=end_date)
);
create index nam_project_phase_order on public.nam_project_phases(workspace_id,project_id,archived,position,id);
create table public.nam_project_phase_events (
 id bigint generated always as identity primary key,workspace_id uuid not null,phase_id uuid not null,
 actor_id uuid not null references auth.users(id),version integer not null,changes jsonb not null,
 request_key text not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,phase_id) references public.nam_project_phases(workspace_id,id),
 unique(workspace_id,actor_id,request_key)
);
alter table public.nam_project_phases enable row level security;
alter table public.nam_project_phase_events enable row level security;
create policy project_phases_read on public.nam_project_phases for select to authenticated using(public.nam_project_access(workspace_id,project_id));
create policy project_phase_events_read on public.nam_project_phase_events for select to authenticated using(public.nam_founder(workspace_id));
revoke all on public.nam_project_phases,public.nam_project_phase_events from public,anon,authenticated;
grant select(id,workspace_id,project_id,title,production_stage,start_date,end_date,status,note,position,archived,version,created_by,created_at,updated_at) on public.nam_project_phases to authenticated;
grant select on public.nam_project_phase_events to authenticated;

create function public.nam_save_project_phase(w uuid,pid uuid,phase_id uuid,expected_version integer,payload jsonb,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_project_phases; result public.nam_project_phases; event public.nam_project_phase_events; project public.nam_projects;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' or jsonb_typeof(payload) is distinct from 'object' or payload='{}'::jsonb
 or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('title','production_stage','start_date','end_date','status','note','position','archived')) then raise exception 'Invalid phase fields or retry key' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||auth.uid()::text||'phase:'||retry_key,0));
 select * into project from public.nam_projects p where p.workspace_id=w and p.id=pid for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 select * into event from public.nam_project_phase_events e where e.workspace_id=w and e.actor_id=auth.uid() and e.request_key=retry_key;
 if found then
  select * into previous from public.nam_project_phases p where p.workspace_id=w and p.id=event.phase_id;
  if previous.project_id is distinct from pid or (phase_id is not null and event.phase_id is distinct from phase_id) or event.changes is distinct from jsonb_build_object('expected_version',expected_version,'payload',payload,'create',phase_id is null) then raise exception 'Retry key belongs to another phase change' using errcode='40001';end if;
  return event.phase_id;
 end if;
 if project.archived then raise exception 'Restore the project before changing its plan' using errcode='22023';end if;
 if phase_id is not null then
  select * into previous from public.nam_project_phases p where p.workspace_id=w and p.project_id=pid and p.id=phase_id for update;
  if not found then raise exception 'Phase not found' using errcode='P0002';end if;
  if previous.version is distinct from expected_version then raise exception 'Phase changed elsewhere' using errcode='40001';end if;
 else
  if expected_version is not null then raise exception 'A new phase has no saved version' using errcode='22023';end if;
  if (select count(*) from public.nam_project_phases p where p.workspace_id=w and p.project_id=pid)>=1000 then raise exception 'At most 1000 retained phases per project' using errcode='22023';end if;
 end if;
 if phase_id is null or payload?'title' then
  if jsonb_typeof(payload->'title') is distinct from 'string' or length(trim(payload->>'title')) not between 1 and 100 then raise exception 'A phase title is required' using errcode='22023';end if;
 end if;
 if (payload?'note' and jsonb_typeof(payload->'note') is distinct from 'string') or
 (payload?'status' and jsonb_typeof(payload->'status') is distinct from 'string') or
 (payload?'archived' and jsonb_typeof(payload->'archived') is distinct from 'boolean') or
 (payload?'position' and (jsonb_typeof(payload->'position') is distinct from 'number' or (payload->>'position')!~ '^[0-9]{1,4}$')) then raise exception 'Invalid phase fields' using errcode='22023';end if;
 if phase_id is null then
  insert into public.nam_project_phases(workspace_id,project_id,title,production_stage,start_date,end_date,status,note,position,archived,created_by,request_key,create_payload)
  values(w,pid,trim(payload->>'title'),nullif(payload->>'production_stage',''),nullif(payload->>'start_date','')::date,nullif(payload->>'end_date','')::date,coalesce(payload->>'status','planned'),coalesce(payload->>'note',''),coalesce((payload->>'position')::integer,1),coalesce((payload->>'archived')::boolean,false),auth.uid(),retry_key,payload) returning * into result;
 else
  update public.nam_project_phases set title=coalesce(trim(payload->>'title'),previous.title),
   production_stage=case when payload?'production_stage' then nullif(payload->>'production_stage','') else previous.production_stage end,
   start_date=case when payload?'start_date' then nullif(payload->>'start_date','')::date else previous.start_date end,
   end_date=case when payload?'end_date' then nullif(payload->>'end_date','')::date else previous.end_date end,
   status=coalesce(payload->>'status',previous.status),note=coalesce(payload->>'note',previous.note),position=coalesce((payload->>'position')::integer,previous.position),
   archived=coalesce((payload->>'archived')::boolean,previous.archived),version=previous.version+1,updated_at=now() where id=phase_id returning * into result;
 end if;
 insert into public.nam_project_phase_events(workspace_id,phase_id,actor_id,version,changes,request_key)
 values(w,result.id,auth.uid(),result.version,jsonb_build_object('expected_version',expected_version,'payload',payload,'create',phase_id is null),retry_key);
 return result.id;
end $$;

create function public.nam_project_plan(w uuid,pid uuid,include_archived boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 select jsonb_build_object('id',p.id,'title',p.title,'start_date',p.start_date,'due_date',p.due_date,'archived',p.archived,
  'task_scope',case when public.nam_founder(w) then 'studio' else 'assigned' end,
  'phases',coalesce((select jsonb_agg(to_jsonb(q) order by q.position,q.id) from (
   select f.id,f.title,f.production_stage,f.start_date,f.end_date,f.status,f.note,f.position,f.archived,f.version,
    count(t.id) filter(where t.status<>'Canceled') as tasks,count(t.id) filter(where t.status='Done') as completed
   from public.nam_project_phases f left join public.nam_tasks t on t.workspace_id=f.workspace_id and t.project_id=f.project_id and t.production_stage=f.production_stage and t.deleted_at is null and not t.archived
   where f.workspace_id=w and f.project_id=pid and f.archived=include_archived group by f.id
  ) q),'[]'::jsonb)) into result from public.nam_projects p where p.workspace_id=w and p.id=pid;
 return result;
end $$;

-- A cover is a deliberate shared-brief image. It exposes only the selected
-- verified derivative, never internal render notes, comments or originals.
create function public.nam_project_cover_media(w uuid,pid uuid,variant text default 'preview') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.nam_render_versions;
begin
 if variant not in ('preview','thumbnail') then raise exception 'Choose a cover variant' using errcode='22023';end if;
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 select v.* into r from public.nam_projects p join public.nam_render_versions v on v.workspace_id=p.workspace_id and v.id=p.cover_render_id
 join public.nam_deliverables d on d.workspace_id=v.workspace_id and d.id=v.deliverable_id and d.project_id=p.id
 where p.workspace_id=w and p.id=pid and v.status='ready';
 if not found then raise exception 'Cover not found' using errcode='P0002';end if;
 return jsonb_build_object('path',r.storage_path||'.'||variant||'.webp','size',case when variant='preview' then r.preview_size else r.thumbnail_size end,
  'sha256',case when variant='preview' then r.preview_sha256 else r.thumbnail_sha256 end,'mime','image/webp','render_id',r.id);
end $$;

create or replace function public.nam_project_detail(w uuid,pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('id',p.id,'title',p.title,'brief',p.brief,'outcome',p.outcome,'reference_url',p.reference_url,'start_date',p.start_date,'due_date',p.due_date,'client_name',p.client_name,'project_type',p.project_type,'location',p.location,'cover_render_id',p.cover_render_id,'lead_id',p.lead_id,'version',p.version,'archived',p.archived,'created_at',p.created_at,'updated_at',p.updated_at,
  'member_ids',case when public.nam_founder(w) then coalesce((select jsonb_agg(pm.user_id) from public.nam_project_members pm where pm.project_id=p.id),'[]'::jsonb) else jsonb_build_array(auth.uid()) end,
  'overview',jsonb_build_object(
   'task_scope',case when public.nam_founder(w) then 'studio' else 'assigned' end,
   'open_tasks',(select count(*) from public.nam_tasks t where t.workspace_id=w and t.project_id=pid and t.deleted_at is null and not t.archived and t.status not in ('Done','Canceled')),
   'overdue_tasks',(select count(*) from public.nam_tasks t where t.workspace_id=w and t.project_id=pid and t.deleted_at is null and not t.archived and t.status not in ('Done','Canceled') and t.due_date<(now() at time zone 'Europe/Paris')::date),
   'images',(select count(*) from public.nam_deliverables d where d.workspace_id=w and d.project_id=pid and not d.archived),
   'pending_responses',case when public.nam_founder(w) then (select count(*) from public.nam_client_review_requests q join public.nam_client_review_items i on i.workspace_id=q.workspace_id and i.request_id=q.id join public.nam_client_review_recipients r on r.workspace_id=q.workspace_id and r.request_id=q.id join public.nam_client_project_access a on a.workspace_id=r.workspace_id and a.project_id=q.project_id and a.user_id=r.user_id
    where q.workspace_id=w and q.project_id=pid and q.status='issued' and r.can_decide and a.active and a.can_approve and not exists(select 1 from public.nam_client_review_decisions d where d.workspace_id=w and d.item_id=i.id and d.user_id=r.user_id)) else null end,
   'recent_images',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id) from (
    select d.id,d.code,d.title,r.id render_id,r.number,r.created_at from public.nam_deliverables d
    join lateral(select id,number,created_at from public.nam_render_versions where workspace_id=w and deliverable_id=d.id and status='ready' order by number desc limit 1) r on true
    where d.workspace_id=w and d.project_id=pid and not d.archived order by r.created_at desc,d.id limit 4
   ) q),'[]'::jsonb))) into result from public.nam_projects p where p.workspace_id=w and p.id=pid;
 if result is null then raise exception 'Project not found' using errcode='P0002';end if;
 return result;
end $$;

create or replace function public.nam_project_list(w uuid,include_archived boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(result) order by result.due_date nulls last,result.title),'[]'::jsonb) from (
  select p.id,p.title,p.due_date,p.start_date,p.client_name,p.project_type,p.location,p.cover_render_id is not null as has_cover,p.lead_id,p.version,p.archived,
   count(t.id) as deliverables,count(t.id) filter(where t.status='Done') as completed,count(t.id) filter(where t.status='Blocked') as blocked,
   count(t.id) filter(where t.status not in ('Done','Canceled') and t.due_date<(now() at time zone 'Europe/Paris')::date) as overdue
  from public.nam_projects p left join public.nam_tasks t on t.workspace_id=p.workspace_id and t.project_id=p.id and t.deleted_at is null and not t.archived and t.status<>'Canceled'
  where p.workspace_id=w and p.archived=include_archived group by p.id
  order by p.due_date nulls last,p.title limit 200
 ) result
$$;

revoke all on function public.nam_save_project_phase(uuid,uuid,uuid,integer,jsonb,text),public.nam_project_plan(uuid,uuid,boolean),public.nam_project_cover_media(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.nam_save_project_phase(uuid,uuid,uuid,integer,jsonb,text),public.nam_project_plan(uuid,uuid,boolean),public.nam_project_cover_media(uuid,uuid,text) to authenticated;
create or replace function public.nam_export_business(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare export_table text; rows jsonb; result jsonb:='{}';
begin
 if not public.nam_founder(w) then raise exception 'Founder access is required' using errcode='42501'; end if;
 insert into public.nam_operations_events(workspace_id,actor_id,kind,detail) values(w,auth.uid(),'business_exported',jsonb_build_object('attachment_bytes',false,'video_bytes',false));
 -- Only named business tables may be exported. Auth, credentials, connection
 -- secrets, job payloads and sessions are intentionally absent from this list.
 foreach export_table in array array['nam_workspaces','nam_memberships','nam_tasks','nam_task_events','nam_task_comments','nam_task_subtasks','nam_notifications','nam_courses','nam_course_versions','nam_lessons','nam_enrollments','nam_lesson_progress','nam_course_draft_lessons','nam_course_completions','nam_academy_completion_events','nam_academy_events','nam_academy_assignments','nam_academy_submissions','nam_academy_submission_events','nam_sales_activities','nam_sales_reports','nam_sales_targets','nam_sales_events','nam_integration_records','nam_integration_owner_map','nam_operations_events','nam_course_modules','nam_course_version_modules','nam_course_resources','nam_course_version_resources','nam_section_grants','nam_access_events','nam_projects','nam_project_members','nam_project_events','nam_academy_videos','nam_course_version_videos','nam_deliverables','nam_deliverable_events','nam_render_versions','nam_render_comments','nam_client_contacts','nam_client_project_access','nam_client_review_requests','nam_client_review_items','nam_client_review_recipients','nam_client_review_decisions','nam_project_phases','nam_project_phase_events'] loop
  if pg_catalog.to_regclass('public.'||export_table) is null then continue; end if;
  if export_table='nam_workspaces' then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where t.id=$1',export_table) into rows using w;
  elsif export_table='nam_integration_records' then
   select coalesce(jsonb_agg(to_jsonb(r)-'credential_fingerprint'),'[]'::jsonb) into rows from public.nam_integration_records r where r.workspace_id=w;
  elsif exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=export_table and c.column_name='workspace_id') then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where t.workspace_id=$1',export_table) into rows using w;
  elsif export_table in ('nam_task_events','nam_task_comments','nam_task_subtasks') then
   execute pg_catalog.format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t join public.nam_tasks parent on parent.id=t.task_id where parent.workspace_id=$1',export_table) into rows using w;
  elsif export_table='nam_lesson_progress' then
   select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into rows from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id where l.workspace_id=w;
  else continue;
  end if;
  result:=result||jsonb_build_object(export_table,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into rows from public.nam_task_attachments a where a.workspace_id=w;
 return jsonb_build_object('format','NAM OS business data export','version',8,'exportedAt',now(),'attachmentBytesIncluded',false,'videoBytesIncluded',false,'renderBytesIncluded',false,'data',result||jsonb_build_object('nam_task_attachments',rows));
end $$;

commit;
