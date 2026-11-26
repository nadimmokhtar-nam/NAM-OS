-- Revision work and final delivery retain the same task/render identities.
-- Final files are immutable issued snapshots, not another public asset store.
begin;
alter table public.nam_client_review_requests add column purpose text not null default 'review' check(purpose in ('review','delivery'));
create unique index if not exists nam_task_delivery_workspace_identity on public.nam_tasks(workspace_id,id);
create table public.nam_project_revision_rounds (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 number integer not null check(number>0),title text not null check(length(trim(title)) between 1 and 200),
 brief text not null default '' check(length(brief)<=5000),due_date date,
 review_request_id uuid,status text not null default 'open' check(status in ('open','closed')),
 version integer not null default 1 check(version>0),created_by uuid not null references auth.users(id),
 request_key text not null,create_payload jsonb not null,created_at timestamptz not null default now(),closed_at timestamptz,
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id),
 foreign key(workspace_id,project_id,review_request_id) references public.nam_client_review_requests(workspace_id,project_id,id),
 unique(workspace_id,id),unique(project_id,number),unique(workspace_id,created_by,request_key),
 check(due_date is null or due_date between date '0001-01-01' and date '9999-12-31')
);
create table public.nam_project_revision_items (
 workspace_id uuid not null,round_id uuid not null,deliverable_id uuid not null,render_id uuid not null,task_id uuid not null,
 instruction text not null check(length(trim(instruction)) between 1 and 5000),
 primary key(round_id,deliverable_id),
 foreign key(workspace_id,round_id) references public.nam_project_revision_rounds(workspace_id,id),
 foreign key(workspace_id,deliverable_id,render_id) references public.nam_render_versions(workspace_id,deliverable_id,id),
 foreign key(workspace_id,task_id) references public.nam_tasks(workspace_id,id)
);
create table public.nam_project_deliveries (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 number integer not null check(number>0),review_request_id uuid not null,
 manifest jsonb not null,created_by uuid not null references auth.users(id),
 request_key text not null,create_payload jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id),
 foreign key(workspace_id,project_id,review_request_id) references public.nam_client_review_requests(workspace_id,project_id,id),
 unique(workspace_id,id),unique(project_id,number),unique(review_request_id),unique(workspace_id,created_by,request_key)
);
create table public.nam_project_delivery_events (
 id bigint generated always as identity primary key,workspace_id uuid not null,project_id uuid not null,
 actor_id uuid not null references auth.users(id),kind text not null check(kind in ('revision_opened','revision_closed','delivery_issued','delivery_cancelled')),
 record_id uuid not null,detail jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id)
);
create index nam_revision_round_project_page on public.nam_project_revision_rounds(workspace_id,project_id,number desc);
create index nam_revision_items_task on public.nam_project_revision_items(workspace_id,task_id);
create index nam_delivery_project_page on public.nam_project_deliveries(workspace_id,project_id,number desc);
create function public.nam_audit_delivery_cancellation() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.nam_project_deliveries;
begin
 if old.status is distinct from new.status and new.status='cancelled' and new.purpose='delivery' then
  select * into d from public.nam_project_deliveries where workspace_id=new.workspace_id and review_request_id=new.id;
  if found then insert into public.nam_project_delivery_events(workspace_id,project_id,actor_id,kind,record_id,detail) values(d.workspace_id,d.project_id,auth.uid(),'delivery_cancelled',d.id,jsonb_build_object('request_id',new.id,'version',new.version));end if;
 end if;
 return new;
end $$;
revoke all on function public.nam_audit_delivery_cancellation() from public,anon,authenticated,service_role;
create trigger nam_delivery_cancellation_audit after update of status on public.nam_client_review_requests for each row execute function public.nam_audit_delivery_cancellation();
alter table public.nam_project_revision_rounds enable row level security;
alter table public.nam_project_revision_items enable row level security;
alter table public.nam_project_deliveries enable row level security;
alter table public.nam_project_delivery_events enable row level security;
create policy revision_round_read on public.nam_project_revision_rounds for select to authenticated using(public.nam_project_access(workspace_id,project_id));
create policy revision_item_read on public.nam_project_revision_items for select to authenticated using(public.nam_task_access(task_id));
create policy delivery_read on public.nam_project_deliveries for select to authenticated using(public.nam_founder(workspace_id));
create policy delivery_events_read on public.nam_project_delivery_events for select to authenticated using(public.nam_founder(workspace_id));
revoke all on public.nam_project_revision_rounds,public.nam_project_revision_items,public.nam_project_deliveries,public.nam_project_delivery_events from public,anon,authenticated;
grant select(id,workspace_id,project_id,number,title,brief,due_date,review_request_id,status,version,created_by,created_at,closed_at) on public.nam_project_revision_rounds to authenticated;
grant select on public.nam_project_revision_items,public.nam_project_deliveries,public.nam_project_delivery_events to authenticated;

create function public.nam_open_revision_round(w uuid,pid uuid,payload jsonb,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_project_revision_rounds; result public.nam_project_revision_rounds; p public.nam_projects; d public.nam_deliverables; r public.nam_render_versions; task public.nam_tasks; entry jsonb; counter integer; qid uuid;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' or jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('title','brief','due_date','review_request_id','items')) then raise exception 'Invalid revision fields' using errcode='22023';end if;
 -- Match scheduling's graph -> identity -> task/project lock order.
 perform public.nam_task_schedule_lock(w);
 select * into p from public.nam_projects where workspace_id=w and id=pid for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 select * into previous from public.nam_project_revision_rounds where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
 if found then
  if previous.project_id<>pid or previous.create_payload<>payload then raise exception 'Retry key belongs to another round' using errcode='40001';end if;
  return previous.id;
 end if;
 if p.archived then raise exception 'Restore the project before adding revisions' using errcode='22023';end if;
 if jsonb_typeof(payload->'title') is distinct from 'string' or length(trim(payload->>'title')) not between 1 and 200 or
  (payload?'brief' and jsonb_typeof(payload->'brief') is distinct from 'string') or length(coalesce(payload->>'brief',''))>5000 or
  jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 then raise exception 'Choose a title and up to 100 images' using errcode='22023';end if;
 if (select count(distinct value->>'deliverable_id') from jsonb_array_elements(payload->'items'))<>jsonb_array_length(payload->'items') then raise exception 'Choose each image once' using errcode='22023';end if;
 qid:=nullif(payload->>'review_request_id','')::uuid;
 if qid is not null and not exists(select 1 from public.nam_client_review_requests where workspace_id=w and project_id=pid and id=qid and purpose='review') then raise exception 'Choose a review from this project' using errcode='22023';end if;
 select coalesce(max(number),0)+1 into counter from public.nam_project_revision_rounds where workspace_id=w and project_id=pid;
 insert into public.nam_project_revision_rounds(workspace_id,project_id,number,title,brief,due_date,review_request_id,created_by,request_key,create_payload)
 values(w,pid,counter,trim(payload->>'title'),coalesce(payload->>'brief',''),nullif(payload->>'due_date','')::date,qid,auth.uid(),retry_key,payload) returning * into result;
 for entry in select value from jsonb_array_elements(payload->'items') order by value->>'deliverable_id' loop
  if jsonb_typeof(entry) is distinct from 'object' or exists(select 1 from jsonb_object_keys(entry) f(k) where k not in ('deliverable_id','render_id','expected_version','instruction')) or jsonb_typeof(entry->'instruction') is distinct from 'string' or length(trim(entry->>'instruction')) not between 1 and 5000 then raise exception 'Every image needs a revision instruction' using errcode='22023';end if;
  select * into d from public.nam_deliverables where workspace_id=w and project_id=pid and id=(entry->>'deliverable_id')::uuid and not archived for update;
  if not found then raise exception 'Image not found' using errcode='P0002';end if;
  if d.version is distinct from (entry->>'expected_version')::integer then raise exception 'Image changed before opening the round' using errcode='40001';end if;
  select * into r from public.nam_render_versions where workspace_id=w and deliverable_id=d.id and status='ready' order by number desc limit 1 for share;
  if not found or r.id is distinct from (entry->>'render_id')::uuid then raise exception 'Choose the current verified image version' using errcode='40001';end if;
  if d.artist_id is null or not public.nam_project_member(w,pid,d.artist_id) then raise exception 'Assign an eligible project artist before creating revision work' using errcode='22023';end if;
  perform public.nam_save_deliverable(w,d.id,d.version,jsonb_build_object('stage','Revisions'),null);
  task:=public.nam_create_task(w,jsonb_build_object('title','Revision '||counter||' · '||left(d.code||' · '||d.title,165),'description',trim(entry->>'instruction'),'section','projects','project_id',pid,'deliverable_id',d.id,'production_stage','Revisions','owner_id',d.artist_id,'due_date',result.due_date,'status','Todo'),'revision_'||result.id::text||'_'||d.id::text);
  insert into public.nam_project_revision_items(workspace_id,round_id,deliverable_id,render_id,task_id,instruction) values(w,result.id,d.id,r.id,task.id,trim(entry->>'instruction'));
 end loop;
 insert into public.nam_project_delivery_events(workspace_id,project_id,actor_id,kind,record_id,detail) values(w,pid,auth.uid(),'revision_opened',result.id,jsonb_build_object('number',counter,'items',jsonb_array_length(payload->'items')));
 return result.id;
end $$;

create function public.nam_close_revision_round(w uuid,rid uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare r public.nam_project_revision_rounds;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 perform public.nam_task_schedule_lock(w);
 select * into r from public.nam_project_revision_rounds where workspace_id=w and id=rid for update;
 if not found then raise exception 'Round not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if r.status='closed' then return;end if;
 if r.version is distinct from expected_version then raise exception 'Revision round changed elsewhere' using errcode='40001';end if;
 if exists(select 1 from public.nam_project_revision_items i join public.nam_tasks t on t.workspace_id=i.workspace_id and t.id=i.task_id where i.workspace_id=w and i.round_id=rid and t.status not in ('Done','Canceled')) then raise exception 'Resolve this round’s tasks before closing it' using errcode='40001';end if;
 update public.nam_project_revision_rounds set status='closed',version=version+1,closed_at=now() where id=rid;
 insert into public.nam_project_delivery_events(workspace_id,project_id,actor_id,kind,record_id,detail) values(w,r.project_id,auth.uid(),'revision_closed',rid,jsonb_build_object('version',r.version+1));
end $$;

create function public.nam_issue_project_delivery(w uuid,pid uuid,payload jsonb,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_project_deliveries; result public.nam_project_deliveries; p public.nam_projects; entry jsonb; d public.nam_deliverables; qid uuid; counter integer; recipients jsonb; manifest jsonb;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,110}$' or jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('title','message','items','recipients')) then raise exception 'Invalid delivery fields' using errcode='22023';end if;
 perform public.nam_task_schedule_lock(w);
 select * into p from public.nam_projects where workspace_id=w and id=pid for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 select * into previous from public.nam_project_deliveries where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
 if found then
  if previous.project_id<>pid or previous.create_payload<>payload then raise exception 'Retry key belongs to another delivery' using errcode='40001';end if;
  return previous.id;
 end if;
 if p.archived then raise exception 'Restore the project before issuing final files' using errcode='22023';end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 or jsonb_typeof(payload->'recipients') is distinct from 'array' or jsonb_array_length(payload->'recipients') not between 1 and 20 then raise exception 'Choose final images and recipients' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(payload->'items') order by value->>'deliverable_id' loop
  select * into d from public.nam_deliverables where workspace_id=w and project_id=pid and id=(entry->>'deliverable_id')::uuid and not archived for update;
  if not found or d.stage not in ('Final approval','Delivery') then raise exception 'Mark each selected image Final approval before issuing delivery' using errcode='22023';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('user_id',value,'can_decide',false)) into recipients from jsonb_array_elements_text(payload->'recipients');
 -- The existing issuance RPC validates latest verified versions, expected image
 -- revisions, active recipients, managed session and all tenant relationships.
 qid:=public.nam_issue_client_review(w,pid,jsonb_build_object('title',payload->'title','message',coalesce(payload->>'message',''),'items',payload->'items','recipients',recipients,'allow_download',true),'delivery_'||retry_key);
 update public.nam_client_review_requests set purpose='delivery' where id=qid;
 for entry in select value from jsonb_array_elements(payload->'items') order by value->>'deliverable_id' loop
  select * into d from public.nam_deliverables where workspace_id=w and id=(entry->>'deliverable_id')::uuid;
  if d.stage<>'Delivery' then perform public.nam_save_deliverable(w,d.id,d.version,jsonb_build_object('stage','Delivery'),null);end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'deliverable_id',i.deliverable_id,'code',i.code,'title',i.title,'render_id',v.id,'version',v.number,'file_name',v.file_name,'mime',v.mime,'byte_size',v.byte_size,'sha256',v.sha256,'width',v.width,'height',v.height) order by i.position),'[]'::jsonb) into manifest
 from public.nam_client_review_items i join public.nam_render_versions v on v.workspace_id=i.workspace_id and v.id=i.render_id where i.workspace_id=w and i.request_id=qid;
 select coalesce(max(number),0)+1 into counter from public.nam_project_deliveries where workspace_id=w and project_id=pid;
 insert into public.nam_project_deliveries(workspace_id,project_id,number,review_request_id,manifest,created_by,request_key,create_payload) values(w,pid,counter,qid,manifest,auth.uid(),retry_key,payload) returning * into result;
 insert into public.nam_project_delivery_events(workspace_id,project_id,actor_id,kind,record_id,detail) values(w,pid,auth.uid(),'delivery_issued',result.id,jsonb_build_object('number',counter,'request_id',qid,'items',jsonb_array_length(manifest)));
 return result.id;
end $$;

revoke all on function public.nam_open_revision_round(uuid,uuid,jsonb,text),public.nam_close_revision_round(uuid,uuid,integer),public.nam_issue_project_delivery(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.nam_open_revision_round(uuid,uuid,jsonb,text),public.nam_close_revision_round(uuid,uuid,integer),public.nam_issue_project_delivery(uuid,uuid,jsonb,text) to authenticated;

create function public.nam_revision_round_page(w uuid,pid uuid,page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare total integer;items jsonb;
begin
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 if page is null or page not between 1 and 100000 then raise exception 'Invalid revision page' using errcode='22023';end if;
 select count(*) into total from public.nam_project_revision_rounds where workspace_id=w and project_id=pid;
 select coalesce(jsonb_agg(to_jsonb(q) order by number desc),'[]'::jsonb) into items from (
  select r.id,r.number,r.title,r.status,r.due_date,r.version,r.created_at,
   (select count(*) from public.nam_project_revision_items i where i.workspace_id=w and i.round_id=r.id) as items,
   (select count(*) from public.nam_project_revision_items i join public.nam_tasks t on t.workspace_id=i.workspace_id and t.id=i.task_id where i.workspace_id=w and i.round_id=r.id and t.status in ('Done','Canceled')) as resolved
  from public.nam_project_revision_rounds r where r.workspace_id=w and r.project_id=pid order by number desc limit 50 offset (page-1)*50
 ) q;
 return jsonb_build_object('items',items,'total',total,'page',page,'hasMore',page*50<total,'scope',case when public.nam_founder(w) then 'studio' else 'assigned' end);
end $$;
create function public.nam_revision_round_detail(w uuid,rid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('id',r.id,'project_id',r.project_id,'number',r.number,'title',r.title,'brief',r.brief,'due_date',r.due_date,'review_request_id',r.review_request_id,'status',r.status,'version',r.version,'created_at',r.created_at,'closed_at',r.closed_at,
 'scope',case when public.nam_founder(w) then 'studio' else 'assigned' end,
 'items',coalesce((select jsonb_agg(jsonb_build_object('deliverable_id',i.deliverable_id,'code',d.code,'title',d.title,'render_id',i.render_id,'task_id',i.task_id,'instruction',i.instruction,'task_status',t.status,'task_version',t.version,'owner_id',t.owner_id) order by d.code,i.deliverable_id)
 from public.nam_project_revision_items i join public.nam_deliverables d on d.workspace_id=i.workspace_id and d.id=i.deliverable_id join public.nam_tasks t on t.workspace_id=i.workspace_id and t.id=i.task_id where i.workspace_id=w and i.round_id=r.id),'[]'::jsonb)) into result from public.nam_project_revision_rounds r where r.workspace_id=w and r.id=rid;
 if result is null then raise exception 'Revision round not found' using errcode='P0002';end if;
 return result;
end $$;
create function public.nam_project_delivery_page(w uuid,pid uuid,page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare total integer;items jsonb;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 if page is null or page not between 1 and 100000 then raise exception 'Invalid delivery page' using errcode='22023';end if;
 select count(*) into total from public.nam_project_deliveries where workspace_id=w and project_id=pid;
 select coalesce(jsonb_agg(to_jsonb(q) order by number desc),'[]'::jsonb) into items from (
  select d.id,d.number,d.review_request_id,q.title,q.message,q.status,q.version,d.created_at,jsonb_array_length(d.manifest) as items
  from public.nam_project_deliveries d join public.nam_client_review_requests q on q.workspace_id=d.workspace_id and q.id=d.review_request_id
  where d.workspace_id=w and d.project_id=pid order by d.number desc limit 50 offset (page-1)*50
 ) q;
 return jsonb_build_object('items',items,'total',total,'page',page,'hasMore',page*50<total);
end $$;
create function public.nam_project_delivery_detail(w uuid,did uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 select jsonb_build_object('id',d.id,'project_id',d.project_id,'number',d.number,'review_request_id',q.id,'title',q.title,'message',q.message,'status',q.status,'version',q.version,'created_at',d.created_at,'manifest',d.manifest,
  'recipients',coalesce((select jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',c.name,'active',a.active) order by c.name) from public.nam_client_review_recipients r join public.nam_client_contacts c on c.workspace_id=r.workspace_id and c.user_id=r.user_id join public.nam_client_project_access a on a.workspace_id=r.workspace_id and a.project_id=r.project_id and a.user_id=r.user_id where r.workspace_id=w and r.request_id=q.id),'[]'::jsonb))
 into result from public.nam_project_deliveries d join public.nam_client_review_requests q on q.workspace_id=d.workspace_id and q.id=d.review_request_id where d.workspace_id=w and d.id=did;
 if result is null then raise exception 'Final delivery not found' using errcode='P0002';end if;
 return result;
end $$;
create function public.nam_cancel_project_delivery(w uuid,did uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare d public.nam_project_deliveries; prior text;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 perform public.nam_task_schedule_lock(w);
 select * into d from public.nam_project_deliveries where workspace_id=w and id=did for update;
 if not found then raise exception 'Final delivery not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 select status into prior from public.nam_client_review_requests where workspace_id=w and id=d.review_request_id for update;
 perform public.nam_close_client_review(w,d.review_request_id,expected_version,'cancelled');
end $$;
create function public.nam_project_round_images(w uuid,pid uuid,final_only boolean default false,search text default '',page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;total integer;
begin
 if not public.nam_founder(w) or not public.nam_project_access(w,pid) then raise exception 'Founder access required' using errcode='42501';end if;
 if page is null or page not between 1 and 100000 or search is null or length(search)>200 or final_only is null then raise exception 'Invalid image page' using errcode='22023';end if;
 select count(*) into total from public.nam_deliverables d where d.workspace_id=w and d.project_id=pid and not d.archived and (not final_only or d.stage in ('Final approval','Delivery')) and strpos(lower(d.code||' '||d.title),lower(search))>0 and exists(select 1 from public.nam_render_versions v where v.workspace_id=w and v.deliverable_id=d.id and v.status='ready');
 select coalesce(jsonb_agg(to_jsonb(q) order by q.code,q.id),'[]'::jsonb) into items from (
  select d.id,d.code,d.title,d.stage,d.artist_id,d.version,v.id render_id,v.number,v.file_name,v.byte_size
  from public.nam_deliverables d join lateral(select id,number,file_name,byte_size from public.nam_render_versions where workspace_id=w and deliverable_id=d.id and status='ready' order by number desc limit 1) v on true
  where d.workspace_id=w and d.project_id=pid and not d.archived and (not final_only or d.stage in ('Final approval','Delivery')) and strpos(lower(d.code||' '||d.title),lower(search))>0
  order by d.code,d.id limit 50 offset (page-1)*50
 ) q;
 return jsonb_build_object('items',items,'total',total,'page',page,'hasMore',page*50<total);
end $$;
create function public.nam_client_delivery_manifest(w uuid,qid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.nam_client_review_access(w,qid) then raise exception 'Delivery not found' using errcode='P0002';end if;
 select jsonb_build_object('format','NAM Studio final delivery','version',1,'title',q.title,'project',p.title,'issued_at',d.created_at,
  'files',(select coalesce(jsonb_agg(value-array['render_id','deliverable_id']),'[]'::jsonb) from jsonb_array_elements(d.manifest))) into result
 from public.nam_project_deliveries d join public.nam_client_review_requests q on q.workspace_id=d.workspace_id and q.id=d.review_request_id join public.nam_projects p on p.workspace_id=d.workspace_id and p.id=d.project_id
 where d.workspace_id=w and d.review_request_id=qid and q.purpose='delivery' and q.allow_download;
 if result is null then raise exception 'Delivery not found' using errcode='P0002';end if;
 return result;
end $$;
revoke all on function public.nam_revision_round_page(uuid,uuid,integer),public.nam_revision_round_detail(uuid,uuid),public.nam_project_delivery_page(uuid,uuid,integer),public.nam_project_delivery_detail(uuid,uuid),public.nam_cancel_project_delivery(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.nam_revision_round_page(uuid,uuid,integer),public.nam_revision_round_detail(uuid,uuid),public.nam_project_delivery_page(uuid,uuid,integer),public.nam_project_delivery_detail(uuid,uuid),public.nam_cancel_project_delivery(uuid,uuid,integer) to authenticated;
revoke all on function public.nam_project_round_images(uuid,uuid,boolean,text,integer),public.nam_client_delivery_manifest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.nam_project_round_images(uuid,uuid,boolean,text,integer),public.nam_client_delivery_manifest(uuid,uuid) to authenticated;
create or replace function public.nam_client_review_list(w uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by issued_at desc,id), '[]'::jsonb) from (
  select q.id,q.issued_at,jsonb_build_object('id',q.id,'number',q.number,'title',q.title,'purpose',q.purpose,'project',p.title,'status',q.status,'issued_at',q.issued_at,'items',(select count(*) from public.nam_client_review_items i where i.request_id=q.id)) entry
  from public.nam_client_review_requests q join public.nam_projects p on p.id=q.project_id
  where q.workspace_id=w and public.nam_client_review_access(w,q.id) order by q.issued_at desc,q.id limit 100
 ) rows
$$;
create or replace function public.nam_client_review_detail(w uuid,qid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.nam_client_review_requests; result jsonb; deciding boolean;
begin
 if not public.nam_client_review_access(w,qid) then raise exception 'Review is not available' using errcode='P0002';end if;
 select * into q from public.nam_client_review_requests where workspace_id=w and id=qid;
 select t.can_decide and a.can_approve and q.status='issued' into deciding from public.nam_client_review_recipients t join public.nam_client_project_access a on a.project_id=t.project_id and a.user_id=t.user_id where t.request_id=qid and t.user_id=auth.uid();
 select jsonb_build_object('id',q.id,'number',q.number,'title',q.title,'message',q.message,'purpose',q.purpose,'project',p.title,'status',q.status,'issued_at',q.issued_at,'allow_download',q.allow_download,'can_decide',coalesce(deciding,false),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'code',i.code,'title',i.title,'number',r.number,'width',r.width,'height',r.height,'file_name',r.file_name,'byte_size',r.byte_size,
  'response',(select jsonb_build_object('decision',e.decision,'message',e.message,'version',e.version,'created_at',e.created_at) from public.nam_client_review_decisions e where e.item_id=i.id and e.user_id=auth.uid() order by e.version desc limit 1)) order by i.position)
 from public.nam_client_review_items i join public.nam_render_versions r on r.id=i.render_id where i.request_id=qid),'[]'::jsonb)) into result from public.nam_projects p where p.id=q.project_id;
 return result;
end $$;

create or replace function public.nam_close_client_review(w uuid,qid uuid,expected_version integer,next_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.nam_client_review_requests;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if next_status is null or next_status not in ('closed','cancelled') then raise exception 'Invalid review state' using errcode='22023';end if;
 perform public.nam_task_schedule_lock(w);
 select * into q from public.nam_client_review_requests where workspace_id=w and id=qid for update;
 if not found then raise exception 'Review not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if q.status=next_status then return jsonb_build_object('id',q.id,'status',q.status,'version',q.version);end if;
 if q.version is distinct from expected_version or q.status<>'issued' then raise exception 'Review changed elsewhere' using errcode='40001';end if;
 update public.nam_client_review_requests set status=next_status,version=version+1,closed_at=now() where id=qid returning * into q;
 return jsonb_build_object('id',q.id,'status',q.status,'version',q.version);
end $$;


commit;
