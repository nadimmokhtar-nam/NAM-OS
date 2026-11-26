-- Additive image/camera inventory. A deliverable is not a task or an approval.
-- Linked work keeps its existing owner, comments, attachments and RLS.
begin;
create function public.nam_production_stages() returns text[]
language sql immutable set search_path='' as $$
 select array['Briefing','Modelling','Camera approval','Materials and lighting','Draft production','Internal review','Client review','Revisions','Final approval','Delivery']::text[]
$$;
create function public.nam_production_stage_valid(stage text) returns boolean
language sql immutable set search_path='' as $$
 select stage=any(public.nam_production_stages()||array['Brief','Materials','Lighting']::text[])
$$;
alter table public.nam_tasks drop constraint nam_tasks_production_stage_check;
alter table public.nam_tasks add constraint nam_tasks_production_stage_check check(production_stage is null or public.nam_production_stage_valid(production_stage));

create table public.nam_deliverables (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 project_id uuid not null, code text not null check(code ~ '^[A-Z0-9][A-Z0-9._ -]{0,39}$'),
 title text not null check(length(trim(title)) between 1 and 200),
 kind text not null default 'still' check(kind in ('still','animation','panorama')),
 stage text not null default 'Briefing' check(stage=any(public.nam_production_stages())),
 artist_id uuid, due_date date check(due_date is null or due_date between date '0001-01-01' and date '9999-12-31'),
 camera_notes text not null default '' check(length(camera_notes)<=5000),
 version integer not null default 1 check(version>0), archived boolean not null default false,
 created_by uuid not null references auth.users(id), request_key text, create_payload jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,project_id,id), unique(workspace_id,id), unique(project_id,code),
 unique(workspace_id,created_by,request_key),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id),
 foreign key(workspace_id,artist_id) references public.nam_memberships(workspace_id,user_id)
);
create index nam_deliverable_project_page on public.nam_deliverables(workspace_id,project_id,archived,code,id);
create index nam_deliverable_artist on public.nam_deliverables(workspace_id,artist_id,project_id);
create table public.nam_deliverable_events (
 id bigint generated always as identity primary key, workspace_id uuid not null, deliverable_id uuid not null,
 actor_id uuid not null references auth.users(id), version integer not null, changes jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,deliverable_id) references public.nam_deliverables(workspace_id,id)
);
alter table public.nam_tasks add column deliverable_id uuid;
alter table public.nam_tasks add constraint nam_task_deliverable_project foreign key(workspace_id,project_id,deliverable_id) references public.nam_deliverables(workspace_id,project_id,id);
alter table public.nam_tasks add constraint nam_task_deliverable_context check(deliverable_id is null or project_id is not null);
create index nam_task_deliverable on public.nam_tasks(workspace_id,deliverable_id,owner_id) where deleted_at is null;

create function public.nam_deliverable_access(w uuid,did uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_section(w,'projects') and exists(
  select 1 from public.nam_deliverables d where d.workspace_id=w and d.id=did
  and public.nam_project_access(w,d.project_id) and (
   public.nam_founder(w) or d.artist_id=(select auth.uid()) or exists(
    select 1 from public.nam_tasks t where t.workspace_id=w and t.deliverable_id=d.id
    and t.owner_id=(select auth.uid()) and t.deleted_at is null and not t.archived
   )
  )
 )
$$;
alter table public.nam_deliverables enable row level security;
alter table public.nam_deliverable_events enable row level security;
create policy deliverables_read on public.nam_deliverables for select to authenticated using(public.nam_deliverable_access(workspace_id,id));
create policy deliverable_events_read on public.nam_deliverable_events for select to authenticated using(public.nam_deliverable_access(workspace_id,deliverable_id));
revoke all on public.nam_deliverables,public.nam_deliverable_events from public,anon,authenticated;
grant select(id,workspace_id,project_id,code,title,kind,stage,artist_id,due_date,camera_notes,version,archived,created_at,updated_at) on public.nam_deliverables to authenticated;
grant select on public.nam_deliverable_events to authenticated;

create function public.nam_save_deliverable(w uuid,did uuid,expected_version integer,changes jsonb,retry_key text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_deliverables; result public.nam_deliverables; pid uuid; artist uuid; project_archived boolean; manage boolean;
begin
 if jsonb_typeof(changes) is distinct from 'object' or changes='{}'::jsonb or exists(
  select 1 from jsonb_object_keys(changes) f(k) where k not in ('project_id','code','title','kind','stage','artist_id','due_date','camera_notes','archived')
 ) then raise exception 'Invalid deliverable fields' using errcode='22023';end if;
 if did is null then
  if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
  pid:=(changes->>'project_id')::uuid;
 else
  if not public.nam_deliverable_access(w,did) then raise exception 'Deliverable not found' using errcode='P0002';end if;
  select project_id into pid from public.nam_deliverables where workspace_id=w and id=did;
  if changes?'project_id' then raise exception 'A deliverable cannot move between projects' using errcode='22023';end if;
 end if;
 -- Parent lock serializes changes to the project participants/archive state.
 select archived into project_archived from public.nam_projects where workspace_id=w and id=pid for share;
 if not found or not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 manage:=public.nam_founder(w);
 if did is not null then
  select * into previous from public.nam_deliverables where workspace_id=w and id=did for update;
  if not found or not public.nam_deliverable_access(w,did) then raise exception 'Deliverable not found' using errcode='P0002';end if;
  if expected_version is distinct from previous.version then raise exception 'Deliverable changed elsewhere' using errcode='40001';end if;
  if not manage and (previous.artist_id is distinct from auth.uid() or exists(select 1 from jsonb_object_keys(changes) f(k) where k not in ('stage','camera_notes'))) then raise exception 'This action needs the project owner' using errcode='42501';end if;
  if previous.archived and (not manage or changes is distinct from '{"archived":false}'::jsonb) then raise exception 'Restore this deliverable before editing' using errcode='22023';end if;
 elsif not manage then raise exception 'Founder access required' using errcode='42501';end if;
 if did is null and retry_key is not null then
  if retry_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid retry key' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||auth.uid()::text||'deliverable:'||retry_key,0));
  if not public.nam_founder(w) or not public.nam_project_access(w,pid) then raise exception 'Access changed' using errcode='42501';end if;
  select * into previous from public.nam_deliverables where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
  if found then
   if previous.create_payload<>changes then raise exception 'Retry key belongs to another deliverable' using errcode='40001';end if;
   return previous.id;
  end if;
 end if;
 if project_archived and changes is distinct from '{"archived":true}'::jsonb then raise exception 'Restore the project before editing deliverables' using errcode='22023';end if;
 if (did is null or changes?'title') and (jsonb_typeof(changes->'title') is distinct from 'string' or length(trim(changes->>'title')) not between 1 and 200) then raise exception 'A deliverable name is required' using errcode='22023';end if;
 if (did is null or changes?'code') and (jsonb_typeof(changes->'code') is distinct from 'string' or upper(trim(changes->>'code')) !~ '^[A-Z0-9][A-Z0-9._ -]{0,39}$') then raise exception 'Choose a camera code' using errcode='22023';end if;
 if (changes?'kind' and (jsonb_typeof(changes->'kind') is distinct from 'string' or changes->>'kind' not in ('still','animation','panorama')))
 or (changes?'stage' and (jsonb_typeof(changes->'stage') is distinct from 'string' or not (changes->>'stage'=any(public.nam_production_stages()))))
 or (changes?'camera_notes' and jsonb_typeof(changes->'camera_notes') is distinct from 'string')
 or (changes?'archived' and jsonb_typeof(changes->'archived') is distinct from 'boolean')
 or (changes?'due_date' and jsonb_typeof(changes->'due_date') not in ('string','null'))
 or (changes?'artist_id' and jsonb_typeof(changes->'artist_id') not in ('string','null')) then raise exception 'Invalid deliverable fields' using errcode='22023';end if;
 artist:=case when changes?'artist_id' then nullif(changes->>'artist_id','')::uuid else previous.artist_id end;
 if artist is not null and not public.nam_project_member(w,pid,artist) then raise exception 'Choose an eligible project artist' using errcode='22023';end if;
 if did is null then
  insert into public.nam_deliverables(workspace_id,project_id,code,title,kind,stage,artist_id,due_date,camera_notes,archived,created_by,request_key,create_payload)
  values(w,pid,upper(trim(changes->>'code')),trim(changes->>'title'),coalesce(changes->>'kind','still'),coalesce(changes->>'stage','Briefing'),artist,nullif(changes->>'due_date','')::date,coalesce(changes->>'camera_notes',''),coalesce((changes->>'archived')::boolean,false),auth.uid(),retry_key,changes) returning * into result;
 else
  update public.nam_deliverables set code=coalesce(upper(trim(changes->>'code')),previous.code),title=coalesce(trim(changes->>'title'),previous.title),kind=coalesce(changes->>'kind',previous.kind),stage=coalesce(changes->>'stage',previous.stage),artist_id=artist,
   due_date=case when changes?'due_date' then nullif(changes->>'due_date','')::date else previous.due_date end,camera_notes=coalesce(changes->>'camera_notes',previous.camera_notes),archived=coalesce((changes->>'archived')::boolean,previous.archived),version=previous.version+1,updated_at=now()
  where id=did returning * into result;
 end if;
 insert into public.nam_deliverable_events(workspace_id,deliverable_id,actor_id,version,changes) values(w,result.id,auth.uid(),result.version,changes);
 return result.id;
end $$;

create function public.nam_deliverable_page(w uuid,pid uuid,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p integer:=coalesce((filters->>'page')::integer,1); size integer:=coalesce((filters->>'pageSize')::integer,100); term text:=coalesce(filters->>'search',''); sort_by text:=coalesce(filters->>'sort','code'); result jsonb;
begin
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 if jsonb_typeof(filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(filters) f(k) where k not in ('page','pageSize','search','sort','stage','kind','archived')) or p<1 or p>100000 or size<1 or size>100 or length(term)>200 or sort_by not in ('code','title','due_date','stage')
 or (coalesce(filters->>'stage','')<>'' and not (filters->>'stage'=any(public.nam_production_stages())))
 or coalesce(filters->>'kind','') not in ('','still','animation','panorama') then raise exception 'Invalid deliverable filter' using errcode='22023';end if;
 with visible as materialized (
  select d.id,d.project_id,d.code,d.title,d.kind,d.stage,d.artist_id,d.due_date,d.version,d.archived,d.updated_at
  from public.nam_deliverables d where d.workspace_id=w and d.project_id=pid
  and d.archived=coalesce((filters->>'archived')::boolean,false)
  and (term='' or position(lower(term) in lower(d.code||' '||d.title))>0)
  and (coalesce(filters->>'stage','')='' or d.stage=filters->>'stage')
  and (coalesce(filters->>'kind','')='' or d.kind=filters->>'kind')
 ), rows as (
  select * from visible order by
   case when sort_by='due_date' then due_date end nulls last,
   case when sort_by='stage' then array_position(public.nam_production_stages(),stage) end,
   case when sort_by='title' then lower(title) else code end,id limit size offset (p-1)*size
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(rows)) from rows),'[]'::jsonb),'total',(select count(*) from visible),'page',p,'pageSize',size,'hasMore',p::bigint*size<(select count(*) from visible)) into result;
 return result;
end $$;

create function public.nam_deliverable_detail(w uuid,did uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('id',d.id,'project_id',d.project_id,'code',d.code,'title',d.title,'kind',d.kind,'stage',d.stage,'artist_id',d.artist_id,'due_date',d.due_date,'camera_notes',d.camera_notes,'version',d.version,'archived',d.archived,'created_at',d.created_at,'updated_at',d.updated_at,
 'can_manage',public.nam_founder(w),'can_edit',public.nam_founder(w) or coalesce(d.artist_id=auth.uid(),false))
 into result from public.nam_deliverables d where d.workspace_id=w and d.id=did;
 if result is null then raise exception 'Deliverable not found' using errcode='P0002';end if;
 return result||jsonb_build_object(
 'task_total',(select count(*) from public.nam_tasks where workspace_id=w and deliverable_id=did and deleted_at is null and not archived),
 'tasks',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,title,status,owner_id,due_date,version from public.nam_tasks where workspace_id=w and deliverable_id=did and deleted_at is null and not archived order by due_date nulls last,number limit 200) q),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,actor_id,version,changes,created_at from public.nam_deliverable_events where workspace_id=w and deliverable_id=did order by id desc limit 40) q),'[]'::jsonb));
end $$;

revoke all on function public.nam_production_stages(),public.nam_production_stage_valid(text),public.nam_deliverable_access(uuid,uuid),public.nam_save_deliverable(uuid,uuid,integer,jsonb,text),public.nam_deliverable_page(uuid,uuid,jsonb),public.nam_deliverable_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.nam_production_stages(),public.nam_production_stage_valid(text),public.nam_deliverable_access(uuid,uuid),public.nam_save_deliverable(uuid,uuid,integer,jsonb,text),public.nam_deliverable_page(uuid,uuid,jsonb),public.nam_deliverable_detail(uuid,uuid) to authenticated;
-- The existing task mutation and paging functions are extended below, keeping
-- their access/version/retry machinery and historical task-stage values.

create or replace function public.nam_save_task(w uuid,task_id uuid,expected_version integer,changes jsonb) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
declare previous public.nam_tasks; result public.nam_tasks; pid uuid; stage text; next_owner uuid; next_section text; image_id uuid; image public.nam_deliverables;
begin
 if jsonb_typeof(changes) is distinct from 'object' then raise exception 'Invalid task fields' using errcode='22023';end if;
 if task_id is not null then
  select * into previous from public.nam_tasks t where t.id=task_id and t.workspace_id=w and t.deleted_at is null for update;
  if not found or not public.nam_task_access(task_id) then raise exception 'Task not found' using errcode='P0002';end if;
 end if;
 pid:=case when changes?'project_id' then nullif(changes->>'project_id','')::uuid else previous.project_id end;
 stage:=case when changes?'production_stage' then nullif(changes->>'production_stage','') else previous.production_stage end;
 image_id:=case when changes?'deliverable_id' then nullif(changes->>'deliverable_id','')::uuid else previous.deliverable_id end;
 next_owner:=coalesce((changes->>'owner_id')::uuid,previous.owner_id,auth.uid());
 next_section:=coalesce(changes->>'section',previous.section);
 if pid is null then stage:=null;image_id:=null;
 elsif next_section is distinct from 'projects' then raise exception 'Only production tasks can belong to projects' using errcode='22023';
 elsif changes?'project_id' or changes?'production_stage' or changes?'owner_id' or previous.id is null then
  perform 1 from public.nam_projects p where p.workspace_id=w and p.id=pid for share;
  if not found or not public.nam_project_access(w,pid) or not public.nam_project_member(w,pid,next_owner) then raise exception 'Explicit project access is required for both owner and editor' using errcode='42501';end if;
  if exists(select 1 from public.nam_projects where id=pid and archived) and (previous.project_id is distinct from pid or previous.owner_id is distinct from next_owner) then raise exception 'Restore this project before adding work' using errcode='22023';end if;
 end if;
 if stage is not null and not public.nam_production_stage_valid(stage) then raise exception 'Choose a production stage' using errcode='22023';end if;
 if image_id is not null then
  select * into image from public.nam_deliverables d where d.workspace_id=w and d.id=image_id for share;
  if not found or image.project_id is distinct from pid then raise exception 'Choose a deliverable from this project' using errcode='22023';end if;
  if changes?'deliverable_id' or previous.id is null then
   if not public.nam_deliverable_access(w,image_id) then raise exception 'Deliverable access required' using errcode='42501';end if;
   if image.archived and previous.deliverable_id is distinct from image_id then raise exception 'Restore the deliverable before linking work' using errcode='22023';end if;
  end if;
 end if;
 -- Clear context first when moving an existing task out of production. The
 -- enclosing transaction rolls back this update if any core validation fails.
 if previous.id is not null and pid is null then update public.nam_tasks set project_id=null,production_stage=null,deliverable_id=null where id=previous.id;end if;
 result:=public.nam_save_task_core(w,task_id,expected_version,changes-array['project_id','production_stage','deliverable_id']);
 update public.nam_tasks set project_id=pid,production_stage=stage,deliverable_id=image_id where id=result.id returning * into result;
 if changes?'project_id' or changes?'production_stage' or changes?'deliverable_id' then
  insert into public.nam_task_events(task_id,actor_id,kind,body) values(result.id,auth.uid(),'production_context',changes-array['title','description','section','owner_id','status','priority','due_date','archived','confirmOpenSubtasks']);
 end if;
 return result;
end $$;

create or replace function public.nam_task_page(w uuid,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p integer:=coalesce((filters->>'page')::integer,1); size integer:=coalesce((filters->>'pageSize')::integer,200); total bigint; rows jsonb;
 archived_filter boolean:=coalesce((filters->>'archived')::boolean,false); term text:=coalesce(filters->>'search','');
 focus text:=coalesce(filters->>'focus',''); actor_id uuid:=(select auth.uid()); founder boolean:=public.nam_founder(w); predicate text; statement text;
begin
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
 order by (t.status in (''Done'',''Canceled'')),t.due_date nulls last,
 case t.priority when ''Urgent'' then 0 when ''High'' then 1 when ''Normal'' then 2 else 3 end,t.number limit $6 offset $7) result';
 execute statement into rows using w,actor_id,archived_filter,filters,term,size,(p-1)*size;
 return jsonb_build_object('items',rows,'total',total,'page',p,'pageSize',size,'hasMore',p::bigint*size<total);
end $$;

create or replace function public.nam_export_business(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare export_table text; rows jsonb; result jsonb:='{}';
begin
 if not public.nam_founder(w) then raise exception 'Founder access is required' using errcode='42501'; end if;
 insert into public.nam_operations_events(workspace_id,actor_id,kind,detail) values(w,auth.uid(),'business_exported',jsonb_build_object('attachment_bytes',false,'video_bytes',false));
 -- Only named business tables may be exported. Auth, credentials, connection
 -- secrets, job payloads and sessions are intentionally absent from this list.
 foreach export_table in array array['nam_workspaces','nam_memberships','nam_tasks','nam_task_events','nam_task_comments','nam_task_subtasks','nam_notifications','nam_courses','nam_course_versions','nam_lessons','nam_enrollments','nam_lesson_progress','nam_course_draft_lessons','nam_course_completions','nam_academy_completion_events','nam_academy_events','nam_academy_assignments','nam_academy_submissions','nam_academy_submission_events','nam_sales_activities','nam_sales_reports','nam_sales_targets','nam_sales_events','nam_integration_records','nam_integration_owner_map','nam_operations_events','nam_course_modules','nam_course_version_modules','nam_course_resources','nam_course_version_resources','nam_section_grants','nam_access_events','nam_projects','nam_project_members','nam_project_events','nam_academy_videos','nam_course_version_videos','nam_deliverables','nam_deliverable_events'] loop
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
 return jsonb_build_object('format','NAM OS business data export','version',5,'exportedAt',now(),'attachmentBytesIncluded',false,'videoBytesIncluded',false,'data',result||jsonb_build_object('nam_task_attachments',rows));
end $$;

commit;
