-- Private project files, deliberately shared notes and ordered reference boards.
-- Resources never broaden assigned task/image access and never fetch remote URLs.
begin;

create function public.nam_resource_https(value text) returns boolean
language sql immutable set search_path='' as $$
 select value is not null and length(value)<=2000 and value ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(/[^[:cntrl:]\\[:space:]]*)?$'
$$;

create table public.nam_project_resources (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,parent_id uuid,
 kind text not null check(kind in ('folder','file','note','meeting','reference','board')),
 title text not null check(length(trim(title)) between 1 and 150 and title !~ '[\x00-\x1f\x7f]'),
 visibility text not null default 'project' check(visibility in ('project','founder')),
 document jsonb not null default '{}'::jsonb check(jsonb_typeof(document)='object' and octet_length(document::text)<=150000),
 reference_url text not null default '' check(reference_url='' or public.nam_resource_https(reference_url)),
 archived boolean not null default false,version integer not null default 1 check(version>0),
 file_name text,mime text,byte_size bigint,expected_sha256 text,sha256 text,storage_path text unique,
 preview_size integer,preview_sha256 text,width integer,height integer,
 status text not null default 'ready' check(status in ('pending','ready')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,project_id,id),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id),
 foreign key(workspace_id,project_id,parent_id) references public.nam_project_resources(workspace_id,project_id,id),
 check(parent_id is distinct from id),
 check(kind<>'folder' or (visibility='project' and document='{}'::jsonb and reference_url='')),
 check(kind='file' or (num_nonnulls(file_name,mime,byte_size,expected_sha256,sha256,storage_path,preview_size,preview_sha256,width,height)=0 and status='ready')),
 check(kind<>'file' or (document='{}'::jsonb and reference_url='' and num_nulls(file_name,mime,byte_size,expected_sha256,storage_path)=0
  and length(file_name) between 1 and 150 and file_name !~ '[/\\\x00-\x1f\x7f]' and file_name !~ '^\.' and position('..' in file_name)=0
  and mime in ('image/jpeg','image/png','application/pdf','text/plain') and byte_size between 1 and 20971520 and expected_sha256 ~ '^[a-f0-9]{64}$'
  and (status<>'ready' or (sha256 is not null and sha256=expected_sha256))
  and (status<>'ready' or mime not in ('image/jpeg','image/png') or (num_nulls(preview_size,preview_sha256,width,height)=0 and preview_size between 1 and 8388608 and preview_sha256 ~ '^[a-f0-9]{64}$' and width between 1 and 16384 and height between 1 and 16384 and width::bigint*height<=64000000))))
);
create index project_resource_folder on public.nam_project_resources(workspace_id,project_id,parent_id,archived,kind,title,id);
create table public.nam_project_resource_events (
 id bigint generated always as identity primary key,workspace_id uuid not null,resource_id uuid not null,actor_id uuid not null references auth.users(id),
 version integer not null,changes jsonb not null,request_key text not null,created_at timestamptz not null default now(),
 unique(workspace_id,actor_id,request_key),foreign key(workspace_id,resource_id) references public.nam_project_resources(workspace_id,id)
);

create function public.nam_project_resource_access(w uuid,rid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_project_resources r where r.workspace_id=w and r.id=rid and public.nam_project_access(w,r.project_id)
  and (public.nam_founder(w) or (r.visibility='project' and r.status='ready')))
$$;
alter table public.nam_project_resources enable row level security;
alter table public.nam_project_resource_events enable row level security;
create policy project_resources_read on public.nam_project_resources for select to authenticated using(public.nam_project_resource_access(workspace_id,id));
create policy project_resource_events_read on public.nam_project_resource_events for select to authenticated using(public.nam_founder(workspace_id));
revoke all on public.nam_project_resources,public.nam_project_resource_events from public,anon,authenticated;
-- Storage paths and upload verification fields are available only through narrow tickets.
grant select(id,workspace_id,project_id,parent_id,kind,title,visibility,document,reference_url,archived,version,file_name,mime,byte_size,status,width,height,created_by,created_at,updated_at) on public.nam_project_resources to authenticated;
grant select on public.nam_project_resource_events to authenticated;

-- Validate rich content in PostgreSQL as well as at the API boundary. A board is
-- an explicitly shared composition; its image bytes retain independent access.
create function public.nam_validate_resource_document(w uuid,pid uuid,kind text,content jsonb,visibility text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare section jsonb;item jsonb;image public.nam_project_resources;seen text[]:='{}';item_count integer:=0;key text;
begin
 if jsonb_typeof(content) is distinct from 'object' or octet_length(content::text)>150000 then return false;end if;
 if kind in ('folder','file','reference') then return content='{}'::jsonb;end if;
 if kind='note' then
  return not exists(select 1 from jsonb_object_keys(content) f(k) where k<>'body') and jsonb_typeof(content->'body') is not distinct from 'string' and length(content->>'body')<=30000;
 end if;
 if kind='meeting' then
  if exists(select 1 from jsonb_object_keys(content) f(k) where k not in ('date','attendees','agenda','decisions','actions')) then return false;end if;
  foreach key in array array['date','attendees','agenda','decisions','actions'] loop
   if jsonb_typeof(content->key) is distinct from 'string' or length(content->>key)>5000 then return false;end if;
  end loop;
  if content->>'date'<>'' then
   if content->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
   begin if (content->>'date')::date not between date '0001-01-01' and date '9999-12-31' then return false;end if;exception when others then return false;end;
  end if;
  return true;
 end if;
 if kind<>'board' or exists(select 1 from jsonb_object_keys(content) f(k) where k<>'sections') or jsonb_typeof(content->'sections') is distinct from 'array' then return false;end if;
 if jsonb_array_length(content->'sections')>20 then return false;end if;
 for section in select value from jsonb_array_elements(content->'sections') loop
  if jsonb_typeof(section) is distinct from 'object' or exists(select 1 from jsonb_object_keys(section) f(k) where k not in ('id','title','items')) or
   jsonb_typeof(section->'id') is distinct from 'string' or (section->>'id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or section->>'id'=any(seen) or
   jsonb_typeof(section->'title') is distinct from 'string' or length(trim(section->>'title')) not between 1 and 100 or jsonb_typeof(section->'items') is distinct from 'array' then return false;end if;
  seen:=array_append(seen,section->>'id');
  for item in select value from jsonb_array_elements(section->'items') loop
   item_count:=item_count+1;if item_count>200 then return false;end if;
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) f(k) where k not in ('id','file_id','caption','reference_url')) or
    jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or item->>'id'=any(seen) or
    jsonb_typeof(item->'file_id') is distinct from 'string' or (item->>'file_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or
    jsonb_typeof(item->'caption') is distinct from 'string' or length(item->>'caption')>500 or jsonb_typeof(item->'reference_url') is distinct from 'string' or (item->>'reference_url'<>'' and not public.nam_resource_https(item->>'reference_url')) then return false;end if;
   seen:=array_append(seen,item->>'id');
   select * into image from public.nam_project_resources r where r.workspace_id=w and r.project_id=pid and r.id=(item->>'file_id')::uuid;
   if not found or image.kind<>'file' or image.status<>'ready' or image.archived or image.mime not in ('image/jpeg','image/png') or (visibility='project' and image.visibility<>'project') then return false;end if;
  end loop;
 end loop;
 return true;
end $$;

create function public.nam_save_project_resource(w uuid,pid uuid,rid uuid,expected_version integer,payload jsonb,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_project_resources;result public.nam_project_resources;event public.nam_project_resource_events;project public.nam_projects;
 selected_kind text;selected_visibility text;selected_parent uuid;content jsonb;identifier uuid:=gen_random_uuid();event_payload jsonb;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' or jsonb_typeof(payload) is distinct from 'object' or payload='{}'::jsonb or
  exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('kind','title','parent_id','visibility','document','reference_url','archived','file_name','mime','byte_size','sha256')) then raise exception 'Invalid resource fields' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||':project-resources',0));
 -- Pin the exact managed identity before any project/resource row can block.
 -- Revocation either commits first and fails this recheck, or waits until the
 -- already authorized mutation commits; it cannot slip through a queued save.
 perform 1 from public.nam_memberships where workspace_id=w and user_id=auth.uid() and active and role='founder' for share;
 if not found then raise exception 'Current Founder access required' using errcode='42501';end if;
 perform 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and (banned_until is null or banned_until<=now()) for share;
 if not found then raise exception 'Current account required' using errcode='42501';end if;
 perform 1 from auth.sessions where user_id=auth.uid() and id=(auth.jwt()->>'session_id')::uuid and (not_after is null or not_after>now()) for share;
 if not found or not public.nam_founder(w) then raise exception 'Current managed session required' using errcode='42501';end if;
 select * into project from public.nam_projects p where p.workspace_id=w and p.id=pid for share;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 event_payload:=jsonb_build_object('expected_version',expected_version,'payload',payload,'create',rid is null);
 select * into event from public.nam_project_resource_events e where e.workspace_id=w and e.actor_id=auth.uid() and e.request_key=retry_key;
 if found then
  select * into previous from public.nam_project_resources r where r.id=event.resource_id;
  if previous.project_id is distinct from pid or (rid is not null and event.resource_id is distinct from rid) or event.changes is distinct from event_payload then raise exception 'Resource retry differs' using errcode='40001';end if;
  return event.resource_id;
 end if;
 if project.archived then raise exception 'Restore the project before editing its resources' using errcode='22023';end if;
 if rid is not null then
  select * into previous from public.nam_project_resources r where r.workspace_id=w and r.project_id=pid and r.id=rid for update;
  if not found then raise exception 'Resource not found' using errcode='P0002';end if;
  if previous.version is distinct from expected_version then raise exception 'Resource changed elsewhere' using errcode='40001';end if;
  if payload?'kind' or payload?'file_name' or payload?'mime' or payload?'byte_size' or payload?'sha256' then raise exception 'Resource kind and file bytes are immutable' using errcode='22023';end if;
 else
  if expected_version is not null then raise exception 'A new resource has no version' using errcode='22023';end if;
  if (select count(*) from public.nam_project_resources r where r.workspace_id=w and r.project_id=pid)>=2000 then raise exception 'Project retained-resource allowance reached' using errcode='54000';end if;
 end if;
 -- Elected MFA may change independently while a resource row lock is queued.
 if not public.nam_founder(w) then raise exception 'Current Founder assurance required' using errcode='42501';end if;
 selected_kind:=coalesce(payload->>'kind',previous.kind);selected_visibility:=coalesce(payload->>'visibility',previous.visibility,'project');
 selected_parent:=case when payload?'parent_id' then (payload->>'parent_id')::uuid else previous.parent_id end;
 content:=coalesce(payload->'document',previous.document,case selected_kind when 'note' then '{"body":""}'::jsonb when 'meeting' then '{"date":"","attendees":"","agenda":"","decisions":"","actions":""}'::jsonb when 'board' then '{"sections":[]}'::jsonb else '{}'::jsonb end);
 if selected_kind is null or selected_kind not in ('folder','file','note','meeting','reference','board') or selected_visibility not in ('project','founder') or
  (rid is null or payload?'title') and (jsonb_typeof(payload->'title') is distinct from 'string' or length(trim(payload->>'title')) not between 1 and 150) or
  (payload?'visibility' and jsonb_typeof(payload->'visibility') is distinct from 'string') or (payload?'archived' and jsonb_typeof(payload->'archived') is distinct from 'boolean') or
  (payload?'reference_url' and jsonb_typeof(payload->'reference_url') is distinct from 'string') then raise exception 'Invalid resource metadata' using errcode='22023';end if;
 if not public.nam_validate_resource_document(w,pid,selected_kind,content,selected_visibility) then raise exception 'Invalid resource content or reference image' using errcode='22023';end if;
 if selected_kind='folder' and selected_visibility<>'project' then raise exception 'Folder contents have individual visibility' using errcode='22023';end if;
 if selected_parent is not null then
  perform 1 from public.nam_project_resources r where r.workspace_id=w and r.project_id=pid and r.id=selected_parent and r.kind='folder' and not r.archived;
  if not found then raise exception 'Choose an active project folder' using errcode='22023';end if;
  if selected_parent=rid or exists(with recursive ancestors as (select r.id,r.parent_id,1 depth from public.nam_project_resources r where r.id=selected_parent union all select r.id,r.parent_id,a.depth+1 from public.nam_project_resources r join ancestors a on r.id=a.parent_id where a.depth<=20) select 1 from ancestors where id=rid or depth>20) then raise exception 'Folder nesting is limited to twenty levels without cycles' using errcode='22023';end if;
 end if;
 if selected_kind='reference' and not public.nam_resource_https(coalesce(payload->>'reference_url',previous.reference_url,'')) then raise exception 'A safe HTTPS reference is required' using errcode='22023';end if;
 if selected_kind not in ('reference','note','meeting','board') and coalesce(payload->>'reference_url',previous.reference_url,'')<>'' then raise exception 'This resource has no external reference' using errcode='22023';end if;
 if rid is null and selected_kind='file' then
  if jsonb_typeof(payload->'file_name') is distinct from 'string' or jsonb_typeof(payload->'mime') is distinct from 'string' or jsonb_typeof(payload->'byte_size') is distinct from 'number' or jsonb_typeof(payload->'sha256') is distinct from 'string' then raise exception 'File metadata required' using errcode='22023';end if;
  if (select count(*) from public.nam_project_resources r where r.workspace_id=w and r.status='pending' and not r.archived)>=20 or
   (select coalesce(sum(r.byte_size+8388608),0) from public.nam_project_resources r where r.workspace_id=w and r.kind='file')+(payload->>'byte_size')::bigint+8388608>21474836480 then raise exception 'Private resource storage allowance reached' using errcode='54000';end if;
 elsif rid is null and (payload?'file_name' or payload?'mime' or payload?'byte_size' or payload?'sha256') then raise exception 'File fields require a file' using errcode='22023';end if;
 if rid is null then
  insert into public.nam_project_resources(id,workspace_id,project_id,parent_id,kind,title,visibility,document,reference_url,archived,file_name,mime,byte_size,expected_sha256,storage_path,status,created_by)
  values(identifier,w,pid,selected_parent,selected_kind,trim(payload->>'title'),selected_visibility,content,coalesce(payload->>'reference_url',''),coalesce((payload->>'archived')::boolean,false),
   case when selected_kind='file' then payload->>'file_name' end,case when selected_kind='file' then payload->>'mime' end,case when selected_kind='file' then (payload->>'byte_size')::bigint end,case when selected_kind='file' then payload->>'sha256' end,
   case when selected_kind='file' then w::text||'/'||identifier::text||case payload->>'mime' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' when 'application/pdf' then '.pdf' else '.txt' end end,
   case when selected_kind='file' then 'pending' else 'ready' end,auth.uid()) returning * into result;
 else
  update public.nam_project_resources set parent_id=selected_parent,title=coalesce(trim(payload->>'title'),previous.title),visibility=selected_visibility,document=content,reference_url=coalesce(payload->>'reference_url',previous.reference_url),archived=coalesce((payload->>'archived')::boolean,previous.archived),version=version+1,updated_at=now() where id=rid returning * into result;
 end if;
 insert into public.nam_project_resource_events(workspace_id,resource_id,actor_id,version,changes,request_key) values(w,result.id,auth.uid(),result.version,event_payload,retry_key);
 return result.id;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('nam-project-resources','nam-project-resources',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf','text/plain']);
create function public.nam_project_resource_storage_insert(object_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_project_resources r join public.nam_projects p on p.workspace_id=r.workspace_id and p.id=r.project_id where r.storage_path=object_path and r.kind='file' and r.status='pending' and not r.archived and not p.archived and public.nam_founder(r.workspace_id))
$$;
create policy project_resource_objects_insert on storage.objects for insert to authenticated with check(bucket_id='nam-project-resources' and public.nam_project_resource_storage_insert(name));
-- No authenticated SELECT/UPDATE/DELETE: private bytes are served only by the
-- authenticated application endpoint, and original uploads are immutable.

create function public.nam_project_resource_ticket(w uuid,rid uuid,variant text default 'original') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.nam_project_resources;
begin
 if not public.nam_project_resource_access(w,rid) then raise exception 'Resource not found' using errcode='P0002';end if;
 select * into r from public.nam_project_resources where workspace_id=w and id=rid;
 if r.kind<>'file' or variant not in ('original','preview','upload') then raise exception 'Choose a file variant' using errcode='22023';end if;
 if variant='upload' then
  if not public.nam_founder(w) or r.archived or exists(select 1 from public.nam_projects p where p.id=r.project_id and p.archived) then raise exception 'Active Founder upload access required' using errcode='42501';end if;
 elsif r.status<>'ready' or r.archived then raise exception 'File is not available' using errcode='P0002';end if;
 if variant='preview' and r.mime not in ('image/jpeg','image/png') then raise exception 'This file has no image preview' using errcode='22023';end if;
 return jsonb_build_object('id',r.id,'project_id',r.project_id,'version',r.version,'status',r.status,'path',r.storage_path||case when variant='preview' then '.preview.webp' else '' end,
  'mime',case when variant='preview' then 'image/webp' else r.mime end,'size',case when variant='preview' then r.preview_size else r.byte_size end,
  'sha256',case when variant='preview' then r.preview_sha256 else r.expected_sha256 end,'file_name',r.file_name);
end $$;

create function public.nam_attest_project_resource(w uuid,rid uuid,expected_version integer,verified_actor uuid,verified_session uuid,verified_aal2 boolean,evidence jsonb,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.nam_project_resources;member public.nam_memberships;
begin
 if coalesce(auth.role(),'')<>'service_role' or verified_actor is null or verified_session is null or retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Trusted file verification required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||':project-resources',0));
 select * into member from public.nam_memberships where workspace_id=w and user_id=verified_actor and active and role='founder' for share;
 if not found then raise exception 'Current Founder access required' using errcode='42501';end if;
 perform 1 from auth.users where id=verified_actor and email_confirmed_at is not null and (banned_until is null or banned_until<=now()) for share;
 if not found then raise exception 'Account unavailable' using errcode='42501';end if;
 perform 1 from auth.sessions where id=verified_session and user_id=verified_actor and (not_after is null or not_after>now()) for share;
 if not found then raise exception 'Original upload session ended' using errcode='42501';end if;
 if exists(select 1 from auth.mfa_factors where user_id=verified_actor and status='verified') and verified_aal2 is distinct from true then raise exception 'Authenticator verification required' using errcode='42501';end if;
 select * into r from public.nam_project_resources where workspace_id=w and id=rid for update;
 if not found or r.kind<>'file' then raise exception 'File not found' using errcode='P0002';end if;
 perform 1 from public.nam_projects where workspace_id=w and id=r.project_id and not archived for share;
 if not found or r.archived then raise exception 'Restore the project or file before finishing' using errcode='40001';end if;
 if exists(select 1 from auth.mfa_factors where user_id=verified_actor and status='verified') and verified_aal2 is distinct from true then raise exception 'Authenticator verification required' using errcode='42501';end if;
 if evidence->>'sha256' is distinct from r.expected_sha256 then raise exception 'Stored file fingerprint differs' using errcode='40001';end if;
 if r.status='ready' then return rid;end if;
 if r.version is distinct from expected_version then raise exception 'File metadata changed while uploading' using errcode='40001';end if;
 if not exists(select 1 from storage.objects where bucket_id='nam-project-resources' and name=r.storage_path and metadata->>'size'=r.byte_size::text and metadata->>'mimetype'=r.mime) then raise exception 'Private upload is incomplete' using errcode='40001';end if;
 if r.mime in ('image/jpeg','image/png') and not exists(select 1 from storage.objects where bucket_id='nam-project-resources' and name=r.storage_path||'.preview.webp' and metadata->>'size'=evidence->>'preview_size' and metadata->>'mimetype'='image/webp') then raise exception 'Verified preview is incomplete' using errcode='40001';end if;
 if exists(select 1 from public.nam_project_resource_events where workspace_id=w and actor_id=verified_actor and request_key=retry_key) then raise exception 'Finish retry key belongs to another action' using errcode='40001';end if;
 update public.nam_project_resources set status='ready',sha256=evidence->>'sha256',preview_size=(evidence->>'preview_size')::integer,preview_sha256=evidence->>'preview_sha256',width=(evidence->>'width')::integer,height=(evidence->>'height')::integer,version=version+1,updated_at=now() where id=rid returning * into r;
 insert into public.nam_project_resource_events(workspace_id,resource_id,actor_id,version,changes,request_key) values(w,rid,verified_actor,r.version,jsonb_build_object('verified_upload',true,'sha256',r.sha256),retry_key);
 return rid;
end $$;

create function public.nam_project_resource_page(w uuid,pid uuid,filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare page integer:=coalesce((filters->>'page')::integer,1);folder uuid:=(filters->>'folder')::uuid;view_kind text:=coalesce(filters->>'kind','all');search text:=coalesce(filters->>'search','');sort text:=coalesce(filters->>'sort','name');show_archived boolean:=coalesce((filters->>'archived')::boolean,false);result jsonb;
begin
 if not public.nam_project_access(w,pid) then raise exception 'Project not found' using errcode='P0002';end if;
 if page not between 1 and 100000 or length(search)>150 or view_kind not in ('all','files','notes','boards','images','references') or sort not in ('name','created') or exists(select 1 from jsonb_object_keys(filters) f(k) where k not in ('page','folder','kind','search','sort','archived')) then raise exception 'Invalid resource filters' using errcode='22023';end if;
 if folder is not null and not exists(select 1 from public.nam_project_resources r where r.workspace_id=w and r.project_id=pid and r.id=folder and r.kind='folder') then raise exception 'Folder not found' using errcode='P0002';end if;
 with filtered as (
  select id,parent_id,kind,title,visibility,reference_url,archived,version,file_name,mime,byte_size,status,width,height,created_by,created_at,updated_at from public.nam_project_resources r
  where workspace_id=w and project_id=pid and r.archived=show_archived and (view_kind<>'files' or r.parent_id is not distinct from folder)
   and (view_kind='all' or view_kind='files' or view_kind='notes' and r.kind in ('note','meeting') or view_kind='boards' and r.kind='board' or view_kind='references' and r.kind in ('board','reference') or view_kind='images' and r.kind='file' and r.status='ready' and r.mime in ('image/jpeg','image/png'))
   and (search='' or position(lower(search) in lower(r.title))>0)
 ), rows as (select * from filtered order by case when view_kind='files' and filtered.kind='folder' then 0 else 1 end,case when sort='name' then lower(title) end,case when sort='created' then created_at end desc,id limit 50 offset (page-1)*50)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(rows)) from rows),'[]'::jsonb),'total',(select count(*) from filtered),'page',page,'hasMore',page*50<(select count(*) from filtered),'folder',case when folder is null then null else (select jsonb_build_object('id',r.id,'title',r.title,'parent_id',r.parent_id) from public.nam_project_resources r where r.id=folder) end,'can_manage',public.nam_founder(w)) into result;
 return result;
end $$;

revoke all on function public.nam_resource_https(text),public.nam_project_resource_access(uuid,uuid),public.nam_validate_resource_document(uuid,uuid,text,jsonb,text),public.nam_save_project_resource(uuid,uuid,uuid,integer,jsonb,text),public.nam_project_resource_storage_insert(text),public.nam_project_resource_ticket(uuid,uuid,text),public.nam_attest_project_resource(uuid,uuid,integer,uuid,uuid,boolean,jsonb,text),public.nam_project_resource_page(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.nam_resource_https(text),public.nam_project_resource_access(uuid,uuid),public.nam_save_project_resource(uuid,uuid,uuid,integer,jsonb,text),public.nam_project_resource_storage_insert(text),public.nam_project_resource_ticket(uuid,uuid,text),public.nam_project_resource_page(uuid,uuid,jsonb) to authenticated;
grant execute on function public.nam_attest_project_resource(uuid,uuid,integer,uuid,uuid,boolean,jsonb,text) to service_role;
commit;
