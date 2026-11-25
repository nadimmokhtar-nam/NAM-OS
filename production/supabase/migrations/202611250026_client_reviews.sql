-- Client review is a separate audience. Studio membership and private media
-- policies remain unchanged; issued items pin one verified render forever.
begin;

create table public.nam_client_contacts (
 workspace_id uuid not null references public.nam_workspaces(id), user_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 100),
 email text not null check(length(email) between 3 and 254 and email=lower(email)),
 created_at timestamptz not null default now(), primary key(workspace_id,user_id), unique(workspace_id,email)
);
create table public.nam_client_project_access (
 workspace_id uuid not null, project_id uuid not null, user_id uuid not null,
 active boolean not null default true, can_approve boolean not null default false,
 version integer not null default 1 check(version>0), created_by uuid not null references auth.users(id),
 request_key text not null, create_payload jsonb not null, updated_at timestamptz not null default now(),
 primary key(project_id,user_id), unique(workspace_id,project_id,user_id), unique(workspace_id,created_by,request_key),
 foreign key(workspace_id,user_id) references public.nam_client_contacts(workspace_id,user_id),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id)
);
create table public.nam_client_review_requests (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
 number integer not null check(number>0), title text not null check(length(trim(title)) between 1 and 200),
 message text not null default '' check(length(message)<=5000), allow_download boolean not null default false,
 status text not null default 'issued' check(status in ('issued','closed','cancelled')),
 version integer not null default 1 check(version>0), created_by uuid not null references auth.users(id),
 request_key text not null, create_payload jsonb not null, issued_at timestamptz not null default now(), closed_at timestamptz,
 unique(workspace_id,id), unique(workspace_id,project_id,id), unique(project_id,number),
 unique(workspace_id,created_by,request_key),
 foreign key(workspace_id,project_id) references public.nam_projects(workspace_id,id)
);
alter table public.nam_render_versions add constraint render_version_deliverable_identity unique(workspace_id,deliverable_id,id);
create table public.nam_client_review_items (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null, request_id uuid not null,
 deliverable_id uuid not null, render_id uuid not null, position integer not null check(position between 1 and 100),
 code text not null, title text not null,
 unique(workspace_id,request_id,id), unique(request_id,deliverable_id), unique(request_id,position),
 foreign key(workspace_id,project_id,request_id) references public.nam_client_review_requests(workspace_id,project_id,id),
 foreign key(workspace_id,project_id,deliverable_id) references public.nam_deliverables(workspace_id,project_id,id),
 foreign key(workspace_id,deliverable_id,render_id) references public.nam_render_versions(workspace_id,deliverable_id,id)
);
create table public.nam_client_review_recipients (
 workspace_id uuid not null, project_id uuid not null, request_id uuid not null, user_id uuid not null,
 can_decide boolean not null default false, primary key(request_id,user_id),
 foreign key(workspace_id,project_id,request_id) references public.nam_client_review_requests(workspace_id,project_id,id),
 foreign key(workspace_id,project_id,user_id) references public.nam_client_project_access(workspace_id,project_id,user_id)
);
create table public.nam_client_review_decisions (
 id bigint generated always as identity primary key, workspace_id uuid not null, request_id uuid not null, item_id uuid not null,
 user_id uuid not null references auth.users(id), decision text not null check(decision in ('accepted','rejected')),
 message text not null default '' check(length(message)<=5000), version integer not null check(version>0),
 request_key text not null, create_payload jsonb not null, created_at timestamptz not null default now(),
 unique(item_id,user_id,version), unique(workspace_id,user_id,request_key),
 foreign key(workspace_id,request_id,item_id) references public.nam_client_review_items(workspace_id,request_id,id),
 foreign key(request_id,user_id) references public.nam_client_review_recipients(request_id,user_id)
);
create index client_review_project_history on public.nam_client_review_requests(workspace_id,project_id,number desc);
create index client_review_recipient on public.nam_client_review_recipients(workspace_id,user_id,request_id);
create index client_review_render on public.nam_client_review_items(workspace_id,render_id,request_id);
create index client_review_response on public.nam_client_review_decisions(item_id,user_id,version desc);

-- No client can select internal render rows, studio memberships or task data.
-- All client-facing records are assembled by narrowly scoped RPCs below.
alter table public.nam_client_contacts enable row level security;
alter table public.nam_client_project_access enable row level security;
alter table public.nam_client_review_requests enable row level security;
alter table public.nam_client_review_items enable row level security;
alter table public.nam_client_review_recipients enable row level security;
alter table public.nam_client_review_decisions enable row level security;
create policy client_contacts_founder on public.nam_client_contacts for select to authenticated using(public.nam_founder(workspace_id));
create policy client_access_founder on public.nam_client_project_access for select to authenticated using(public.nam_founder(workspace_id));
create policy client_requests_founder on public.nam_client_review_requests for select to authenticated using(public.nam_founder(workspace_id));
create policy client_items_founder on public.nam_client_review_items for select to authenticated using(public.nam_founder(workspace_id));
create policy client_recipients_founder on public.nam_client_review_recipients for select to authenticated using(public.nam_founder(workspace_id));
create policy client_decisions_founder on public.nam_client_review_decisions for select to authenticated using(public.nam_founder(workspace_id));
revoke all on public.nam_client_contacts,public.nam_client_project_access,public.nam_client_review_requests,public.nam_client_review_items,public.nam_client_review_recipients,public.nam_client_review_decisions from public,anon,authenticated;
grant select on public.nam_client_contacts,public.nam_client_project_access,public.nam_client_review_requests,public.nam_client_review_items,public.nam_client_review_recipients,public.nam_client_review_decisions to authenticated;

create function public.nam_client_identity(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.nam_session_valid() then raise exception 'Sign in required' using errcode='42501';end if;
 select jsonb_build_object('id',c.user_id,'name',c.name) into result from public.nam_client_contacts c
 where c.workspace_id=w and c.user_id=auth.uid() and exists(select 1 from public.nam_client_project_access a where a.workspace_id=w and a.user_id=c.user_id and a.active);
 if result is null then raise exception 'Client invitation required' using errcode='42501';end if;
 return result;
end $$;
create function public.nam_client_review_access(w uuid,qid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_assured() and exists(
  select 1 from public.nam_client_review_requests q
  join public.nam_client_review_recipients t on t.request_id=q.id and t.workspace_id=w
  join public.nam_client_project_access a on a.project_id=q.project_id and a.user_id=t.user_id and a.workspace_id=w
  join public.nam_projects p on p.id=q.project_id and p.workspace_id=w
  where q.workspace_id=w and q.id=qid and t.user_id=auth.uid() and a.active and not p.archived and q.status<>'cancelled'
 )
$$;

create function public.nam_client_account_for_email(address text) returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server access required' using errcode='42501';end if;
 return (select id from auth.users where lower(email)=lower(trim(address)) limit 1);
end $$;

create function public.nam_save_client_access(w uuid,pid uuid,uid uuid,expected_version integer,payload jsonb,retry_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.nam_client_project_access; person public.nam_client_contacts; result public.nam_client_project_access; address text; display_name text;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('name','email','active','can_approve'))
 or jsonb_typeof(payload->'name') is distinct from 'string' or jsonb_typeof(payload->'email') is distinct from 'string'
 or jsonb_typeof(payload->'active') is distinct from 'boolean' or jsonb_typeof(payload->'can_approve') is distinct from 'boolean'
 or length(trim(payload->>'name')) not between 1 and 100 or length(trim(payload->>'email')) not between 3 and 254
 or retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid client details' using errcode='22023';end if;
 perform 1 from public.nam_projects where workspace_id=w and id=pid and not archived for share;
 if not found then raise exception 'Active project required' using errcode='P0002';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||pid::text||uid::text||'client',0));
 if not public.nam_founder(w) then raise exception 'Access changed' using errcode='42501';end if;
 address:=lower(trim(payload->>'email'));display_name:=trim(payload->>'name');
 if not exists(select 1 from auth.users where id=uid and lower(email)=address) then raise exception 'Client identity does not match' using errcode='22023';end if;
 select * into previous from public.nam_client_project_access where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
 if found then
  if previous.project_id<>pid or previous.user_id<>uid or previous.create_payload<>payload then raise exception 'Retry belongs to another client access request' using errcode='40001';end if;
  return jsonb_build_object('user_id',uid,'version',previous.version,'active',previous.active,'can_approve',previous.can_approve,'replayed',true);
 end if;
 select * into previous from public.nam_client_project_access where workspace_id=w and project_id=pid and user_id=uid for update;
 if found then
  if previous.version is distinct from expected_version then raise exception 'Client access changed elsewhere' using errcode='40001';end if;
  select * into person from public.nam_client_contacts where workspace_id=w and user_id=uid;
  if person.name<>display_name or person.email<>address then raise exception 'Existing client contact details cannot change through project access' using errcode='22023';end if;
  update public.nam_client_project_access set active=(payload->>'active')::boolean,can_approve=(payload->>'can_approve')::boolean,version=version+1,updated_at=now() where project_id=pid and user_id=uid returning * into result;
 else
  if expected_version is not null then raise exception 'Client access changed elsewhere' using errcode='40001';end if;
  insert into public.nam_client_contacts(workspace_id,user_id,name,email) values(w,uid,display_name,address) on conflict(workspace_id,user_id) do nothing;
  insert into public.nam_client_project_access(workspace_id,project_id,user_id,active,can_approve,created_by,request_key,create_payload)
  values(w,pid,uid,(payload->>'active')::boolean,(payload->>'can_approve')::boolean,auth.uid(),retry_key,payload) returning * into result;
 end if;
 return jsonb_build_object('user_id',uid,'version',result.version,'active',result.active,'can_approve',result.can_approve,'replayed',false);
end $$;

create function public.nam_issue_client_review(w uuid,pid uuid,payload jsonb,retry_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.nam_client_review_requests; result uuid; selection jsonb; d public.nam_deliverables; r public.nam_render_versions; a public.nam_client_project_access; uid uuid; n integer; pos integer:=0;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('title','message','allow_download','items','recipients'))
 or jsonb_typeof(payload->'title') is distinct from 'string' or length(trim(payload->>'title')) not between 1 and 200
 or jsonb_typeof(payload->'message') is distinct from 'string' or length(payload->>'message')>5000
 or jsonb_typeof(payload->'allow_download') is distinct from 'boolean'
 or jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_typeof(payload->'recipients') is distinct from 'array'
 or retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid review request' using errcode='22023';end if;
 if jsonb_array_length(payload->'items') not between 1 and 100 or jsonb_array_length(payload->'recipients') not between 1 and 20 then raise exception 'Choose images and recipients' using errcode='22023';end if;
 perform 1 from public.nam_projects where workspace_id=w and id=pid and not archived for share;
 if not found then raise exception 'Active project required' using errcode='P0002';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w::text||pid::text||'review-issue',0));
 if not public.nam_founder(w) then raise exception 'Access changed' using errcode='42501';end if;
 select * into previous from public.nam_client_review_requests where workspace_id=w and created_by=auth.uid() and request_key=retry_key;
 if found then
  if previous.project_id<>pid or previous.create_payload<>payload then raise exception 'Retry belongs to another review' using errcode='40001';end if;
  return previous.id;
 end if;
 select coalesce(max(number),0)+1 into n from public.nam_client_review_requests where project_id=pid;
 insert into public.nam_client_review_requests(workspace_id,project_id,number,title,message,allow_download,created_by,request_key,create_payload)
 values(w,pid,n,trim(payload->>'title'),payload->>'message',(payload->>'allow_download')::boolean,auth.uid(),retry_key,payload) returning id into result;
 -- Stable lock order agrees with render attestation's deliverable -> render order.
 for selection in select item from jsonb_array_elements(payload->'items') as rows(item) order by item->>'deliverable_id' loop
  if jsonb_typeof(selection) is distinct from 'object' or exists(select 1 from jsonb_object_keys(selection) f(k) where k not in ('deliverable_id','render_id','expected_version')) or jsonb_typeof(selection->'expected_version') is distinct from 'number' then raise exception 'Invalid review image' using errcode='22023';end if;
  select * into d from public.nam_deliverables where workspace_id=w and project_id=pid and id=(selection->>'deliverable_id')::uuid and not archived for share;
  if not found then raise exception 'Image is not available in this project' using errcode='P0002';end if;
  if d.version is distinct from (selection->>'expected_version')::integer then raise exception 'Image changed before issuing' using errcode='40001';end if;
  select * into r from public.nam_render_versions where workspace_id=w and deliverable_id=d.id and id=(selection->>'render_id')::uuid and status='ready' for share;
  if not found then raise exception 'Verified render required' using errcode='22023';end if;
  if r.number<>(select max(number) from public.nam_render_versions where workspace_id=w and deliverable_id=d.id and status='ready') then raise exception 'Select the latest verified render' using errcode='40001';end if;
  pos:=pos+1;
  insert into public.nam_client_review_items(workspace_id,project_id,request_id,deliverable_id,render_id,position,code,title) values(w,pid,result,d.id,r.id,pos,d.code,d.title);
 end loop;
 for selection in select item from jsonb_array_elements(payload->'recipients') as rows(item) order by item->>'user_id' loop
  if jsonb_typeof(selection) is distinct from 'object' or exists(select 1 from jsonb_object_keys(selection) f(k) where k not in ('user_id','can_decide')) or jsonb_typeof(selection->'can_decide') is distinct from 'boolean' then raise exception 'Invalid review recipient' using errcode='22023';end if;
  uid:=(selection->>'user_id')::uuid;
  select * into a from public.nam_client_project_access where workspace_id=w and project_id=pid and user_id=uid and active for share;
  if not found or ((selection->>'can_decide')::boolean and not a.can_approve) then raise exception 'Choose an eligible client recipient' using errcode='22023';end if;
  insert into public.nam_client_review_recipients(workspace_id,project_id,request_id,user_id,can_decide) values(w,pid,result,uid,(selection->>'can_decide')::boolean);
 end loop;
 return result;
end $$;

create function public.nam_client_review_list(w uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by issued_at desc,id), '[]'::jsonb) from (
  select q.id,q.issued_at,jsonb_build_object('id',q.id,'number',q.number,'title',q.title,'project',p.title,'status',q.status,'issued_at',q.issued_at,'items',(select count(*) from public.nam_client_review_items i where i.request_id=q.id)) entry
  from public.nam_client_review_requests q join public.nam_projects p on p.id=q.project_id
  where q.workspace_id=w and public.nam_client_review_access(w,q.id) order by q.issued_at desc,q.id limit 100
 ) rows
$$;
create function public.nam_client_review_detail(w uuid,qid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.nam_client_review_requests; result jsonb; deciding boolean;
begin
 if not public.nam_client_review_access(w,qid) then raise exception 'Review is not available' using errcode='P0002';end if;
 select * into q from public.nam_client_review_requests where workspace_id=w and id=qid;
 select t.can_decide and a.can_approve and q.status='issued' into deciding from public.nam_client_review_recipients t join public.nam_client_project_access a on a.project_id=t.project_id and a.user_id=t.user_id where t.request_id=qid and t.user_id=auth.uid();
 select jsonb_build_object('id',q.id,'number',q.number,'title',q.title,'message',q.message,'project',p.title,'status',q.status,'issued_at',q.issued_at,'allow_download',q.allow_download,'can_decide',coalesce(deciding,false),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'code',i.code,'title',i.title,'number',r.number,'width',r.width,'height',r.height,'file_name',r.file_name,'byte_size',r.byte_size,
  'response',(select jsonb_build_object('decision',e.decision,'message',e.message,'version',e.version,'created_at',e.created_at) from public.nam_client_review_decisions e where e.item_id=i.id and e.user_id=auth.uid() order by e.version desc limit 1)) order by i.position)
 from public.nam_client_review_items i join public.nam_render_versions r on r.id=i.render_id where i.request_id=qid),'[]'::jsonb)) into result from public.nam_projects p where p.id=q.project_id;
 return result;
end $$;
create function public.nam_client_review_media(w uuid,qid uuid,iid uuid,variant text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if variant not in ('preview','thumbnail','original') or variant is null then raise exception 'Invalid image variant' using errcode='22023';end if;
 if not public.nam_client_review_access(w,qid) then raise exception 'Review is not available' using errcode='P0002';end if;
 select jsonb_build_object('path',r.storage_path||case when variant='original' then '' else '.'||variant||'.webp' end,
 'size',case variant when 'original' then r.byte_size when 'preview' then r.preview_size else r.thumbnail_size end,
 'sha256',case variant when 'original' then r.sha256 when 'preview' then r.preview_sha256 else r.thumbnail_sha256 end,
 'mime',case when variant='original' then r.mime else 'image/webp' end,'file_name',r.file_name) into result
 from public.nam_client_review_items i join public.nam_client_review_requests q on q.id=i.request_id join public.nam_render_versions r on r.id=i.render_id
 where i.workspace_id=w and i.request_id=qid and i.id=iid and r.status='ready' and (variant<>'original' or q.allow_download);
 if result is null then raise exception 'Image is not available' using errcode='P0002';end if;
 return result;
end $$;

create function public.nam_decide_client_review(w uuid,qid uuid,iid uuid,expected_version integer,payload jsonb,retry_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.nam_client_review_requests; a public.nam_client_project_access; t public.nam_client_review_recipients; previous public.nam_client_review_decisions; result public.nam_client_review_decisions; current_version integer;
begin
 if not public.nam_client_review_access(w,qid) then raise exception 'Review is not available' using errcode='P0002';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) f(k) where k not in ('decision','message'))
 or jsonb_typeof(payload->'decision') is distinct from 'string' or payload->>'decision' not in ('accepted','rejected')
 or jsonb_typeof(payload->'message') is distinct from 'string' or length(payload->>'message')>5000
 or expected_version is null or expected_version<0 or retry_key is null or retry_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid review response' using errcode='22023';end if;
 -- Parent, grant, request and item locks make revocation/closure/response races explicit.
 perform 1 from public.nam_projects p join public.nam_client_review_requests v on v.project_id=p.id where v.workspace_id=w and v.id=qid and not p.archived for share of p;
 if not found then raise exception 'Project unavailable' using errcode='P0002';end if;
 select * into a from public.nam_client_project_access where workspace_id=w and project_id=(select project_id from public.nam_client_review_requests where id=qid) and user_id=auth.uid() for share;
 select * into q from public.nam_client_review_requests where workspace_id=w and id=qid for share;
 select * into t from public.nam_client_review_recipients where request_id=qid and user_id=auth.uid();
 if not public.nam_assured() or not a.active or not a.can_approve or t.can_decide is distinct from true then raise exception 'Client response permission required' using errcode='42501';end if;
 perform 1 from public.nam_client_review_items where workspace_id=w and request_id=qid and id=iid for update;
 if not found then raise exception 'Review image not found' using errcode='P0002';end if;
 select * into previous from public.nam_client_review_decisions where workspace_id=w and user_id=auth.uid() and request_key=retry_key;
 if found then
  if previous.request_id<>qid or previous.item_id<>iid or previous.create_payload<>payload then raise exception 'Retry belongs to another response' using errcode='40001';end if;
  return jsonb_build_object('decision',previous.decision,'message',previous.message,'version',previous.version,'created_at',previous.created_at);
 end if;
 if q.status<>'issued' then raise exception 'Review has closed' using errcode='40001';end if;
 select coalesce(max(version),0) into current_version from public.nam_client_review_decisions where item_id=iid and user_id=auth.uid();
 if current_version is distinct from expected_version then raise exception 'Response changed elsewhere' using errcode='40001';end if;
 insert into public.nam_client_review_decisions(workspace_id,request_id,item_id,user_id,decision,message,version,request_key,create_payload)
 values(w,qid,iid,auth.uid(),payload->>'decision',payload->>'message',current_version+1,retry_key,payload) returning * into result;
 return jsonb_build_object('decision',result.decision,'message',result.message,'version',result.version,'created_at',result.created_at);
end $$;

create function public.nam_close_client_review(w uuid,qid uuid,expected_version integer,next_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.nam_client_review_requests;
begin
 if not public.nam_founder(w) then raise exception 'Founder access required' using errcode='42501';end if;
 if next_status is null or next_status not in ('closed','cancelled') then raise exception 'Invalid review state' using errcode='22023';end if;
 select * into q from public.nam_client_review_requests where workspace_id=w and id=qid for update;
 if not found then raise exception 'Review not found' using errcode='P0002';end if;
 if q.status=next_status then return jsonb_build_object('id',q.id,'status',q.status,'version',q.version);end if;
 if q.version is distinct from expected_version or q.status<>'issued' then raise exception 'Review changed elsewhere' using errcode='40001';end if;
 update public.nam_client_review_requests set status=next_status,version=version+1,closed_at=now() where id=qid returning * into q;
 return jsonb_build_object('id',q.id,'status',q.status,'version',q.version);
end $$;

create function public.nam_staff_client_feedback(w uuid,rid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.nam_render_versions r where r.workspace_id=w and r.id=rid and public.nam_deliverable_access(w,r.deliverable_id)) then raise exception 'Image not found' using errcode='P0002';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('request_number',q.number,'request_title',q.title,'request_status',q.status,'client_name',c.name,'decision',e.decision,'message',e.message,'created_at',e.created_at) order by e.created_at desc,e.id desc)
 from public.nam_client_review_items i join public.nam_client_review_requests q on q.id=i.request_id
 join lateral(select distinct on(user_id) * from public.nam_client_review_decisions where item_id=i.id order by user_id,version desc) e on true
 join public.nam_client_contacts c on c.workspace_id=w and c.user_id=e.user_id where i.workspace_id=w and i.render_id=rid),'[]'::jsonb);
end $$;

revoke all on function public.nam_client_identity(uuid),public.nam_client_review_access(uuid,uuid),public.nam_client_account_for_email(text),public.nam_save_client_access(uuid,uuid,uuid,integer,jsonb,text),public.nam_issue_client_review(uuid,uuid,jsonb,text),public.nam_client_review_list(uuid),public.nam_client_review_detail(uuid,uuid),public.nam_client_review_media(uuid,uuid,uuid,text),public.nam_decide_client_review(uuid,uuid,uuid,integer,jsonb,text),public.nam_close_client_review(uuid,uuid,integer,text),public.nam_staff_client_feedback(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.nam_client_account_for_email(text) to service_role;
grant execute on function public.nam_client_identity(uuid),public.nam_client_review_access(uuid,uuid),public.nam_save_client_access(uuid,uuid,uuid,integer,jsonb,text),public.nam_issue_client_review(uuid,uuid,jsonb,text),public.nam_client_review_list(uuid),public.nam_client_review_detail(uuid,uuid),public.nam_client_review_media(uuid,uuid,uuid,text),public.nam_decide_client_review(uuid,uuid,uuid,integer,jsonb,text),public.nam_close_client_review(uuid,uuid,integer,text),public.nam_staff_client_feedback(uuid,uuid) to authenticated;

commit;
