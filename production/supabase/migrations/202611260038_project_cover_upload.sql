-- Laptop covers use verified project files, separate from production deliverables.
-- Existing project membership, RLS and private-original permissions are retained.
begin;
alter table public.nam_projects add column cover_resource_id uuid;
alter table public.nam_projects add constraint nam_project_cover_resource
 foreign key(workspace_id,id,cover_resource_id) references public.nam_project_resources(workspace_id,project_id,id);
alter table public.nam_projects add constraint nam_project_one_cover
 check(num_nonnulls(cover_render_id,cover_resource_id)<=1);
grant select(cover_resource_id) on public.nam_projects to authenticated;

-- Existing clients selecting a different render still replace an uploaded cover.
create function public.nam_project_render_cover_changed() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.cover_render_id is not null and new.cover_render_id is distinct from old.cover_render_id then new.cover_resource_id:=null;end if;
 return new;
end $$;
create trigger nam_project_render_cover_changed before update of cover_render_id on public.nam_projects
 for each row execute function public.nam_project_render_cover_changed();
revoke all on function public.nam_project_render_cover_changed() from public,anon,authenticated;

create unique index nam_project_cover_request on public.nam_project_events
 (workspace_id,project_id,actor_id,(changes->>'cover_request_key')) where changes?'cover_request_key';
create function public.nam_set_project_cover(w uuid,pid uuid,expected_version integer,resource_id uuid,render_id uuid,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.nam_projects; command jsonb; saved jsonb;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if expected_version is null or expected_version<1 or retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' or num_nonnulls(resource_id,render_id)>1 then raise exception 'Invalid cover request' using errcode='22023';end if;
 select * into p from public.nam_projects where workspace_id=w and id=pid for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 command:=jsonb_build_object('cover_resource_id',resource_id,'cover_render_id',render_id,'cover_request_key',retry_key,'expected_version',expected_version);
 select e.changes into saved from public.nam_project_events e where e.workspace_id=w and e.project_id=pid and e.actor_id=auth.uid() and e.changes->>'cover_request_key'=retry_key;
 if found then
  if saved is distinct from command then raise exception 'Cover retry belongs to a different change' using errcode='40001';end if;
  return pid;
 end if;
 if p.version is distinct from expected_version then raise exception 'Project changed elsewhere. Reload before changing its cover' using errcode='40001';end if;
 if p.archived then raise exception 'Restore this project before changing its cover' using errcode='22023';end if;
 if resource_id is not null then
  perform 1 from public.nam_project_resources r where r.workspace_id=w and r.project_id=pid and r.id=resource_id
   and r.kind='file' and r.status='ready' and r.visibility='project' and not r.archived
   and r.mime in ('image/jpeg','image/png') and r.preview_size>0 and r.preview_sha256 is not null for share of r;
  if not found then raise exception 'Choose a verified shared image from this project' using errcode='22023';end if;
 end if;
 if render_id is not null then
  perform 1 from public.nam_render_versions r join public.nam_deliverables d on d.workspace_id=r.workspace_id and d.id=r.deliverable_id
   where r.workspace_id=w and d.project_id=pid and r.id=render_id and r.status='ready' and not d.archived for share of r,d;
  if not found then raise exception 'Choose a verified render from this project' using errcode='22023';end if;
 end if;
 update public.nam_projects set cover_resource_id=resource_id,cover_render_id=render_id,version=version+1,updated_at=now() where workspace_id=w and id=pid returning * into p;
 insert into public.nam_project_events(workspace_id,project_id,actor_id,version,changes) values(w,pid,auth.uid(),p.version,command);
 return pid;
end $$;
revoke all on function public.nam_set_project_cover(uuid,uuid,integer,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.nam_set_project_cover(uuid,uuid,integer,uuid,uuid,text) to authenticated;

create or replace function public.nam_project_cover_media(w uuid,pid uuid,variant text default 'preview') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.nam_projects; r public.nam_render_versions; f public.nam_project_resources;
begin
 if variant not in ('preview','thumbnail') then raise exception 'Choose a cover variant' using errcode='22023';end if;
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 select * into p from public.nam_projects where workspace_id=w and id=pid;
 if p.cover_resource_id is not null then
  select * into f from public.nam_project_resources where workspace_id=w and project_id=pid and id=p.cover_resource_id
   and kind='file' and status='ready' and visibility='project' and not archived and mime in ('image/jpeg','image/png');
  if not found then raise exception 'Cover not found' using errcode='P0002';end if;
  return jsonb_build_object('bucket','nam-project-resources','path',f.storage_path||'.preview.webp','size',f.preview_size,'sha256',f.preview_sha256,'mime','image/webp','resource_id',f.id);
 end if;
 select v.* into r from public.nam_render_versions v join public.nam_deliverables d on d.workspace_id=v.workspace_id and d.id=v.deliverable_id
 where v.workspace_id=w and v.id=p.cover_render_id and v.status='ready' and d.project_id=pid and not d.archived;
 if not found then raise exception 'Cover not found' using errcode='P0002';end if;
 return jsonb_build_object('bucket','nam-render-versions','path',r.storage_path||'.'||variant||'.webp','size',case when variant='preview' then r.preview_size else r.thumbnail_size end,
  'sha256',case when variant='preview' then r.preview_sha256 else r.thumbnail_sha256 end,'mime','image/webp','render_id',r.id);
end $$;

create or replace function public.nam_project_detail(w uuid,pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('id',p.id,'title',p.title,'brief',p.brief,'outcome',p.outcome,'reference_url',p.reference_url,'start_date',p.start_date,'due_date',p.due_date,'client_name',p.client_name,'project_type',p.project_type,'location',p.location,'cover_render_id',p.cover_render_id,'cover_resource_id',p.cover_resource_id,'lead_id',p.lead_id,'version',p.version,'archived',p.archived,'created_at',p.created_at,'updated_at',p.updated_at,
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
  select p.id,p.title,p.due_date,p.start_date,p.client_name,p.project_type,p.location,
   p.created_at,p.updated_at,(p.cover_render_id is not null or exists(select 1 from public.nam_project_resources f where f.workspace_id=p.workspace_id and f.project_id=p.id and f.id=p.cover_resource_id and f.status='ready' and f.visibility='project' and not f.archived and f.mime in ('image/jpeg','image/png'))) as has_cover,p.lead_id,p.version,p.archived,
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
