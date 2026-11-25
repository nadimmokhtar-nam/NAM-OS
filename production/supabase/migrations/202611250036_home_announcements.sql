-- Home adds real dated announcements and reads existing permitted work. It
-- neither grants sections/project access nor duplicates the daily brief.
begin;
create function public.nam_home_member(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.nam_assured() and public.nam_role(w) in ('founder','sales_manager','sales','production_manager','artist','freelancer'),false)
$$;
create function public.nam_home_audience_valid(roles text[]) returns boolean language sql immutable set search_path='' as $$
 select roles is not null and cardinality(roles)<=6 and array_position(roles,null) is null
 and roles<@array['founder','sales_manager','sales','production_manager','artist','freelancer']::text[]
 and cardinality(roles)=(select count(distinct value) from unnest(roles) value)
$$;
create table public.nam_home_announcements(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),
 title text not null check(length(trim(title)) between 1 and 200 and title!~'[[:cntrl:]]'),
 body text not null check(length(trim(body)) between 1 and 8000),
 audience_roles text[] not null default '{}' check(public.nam_home_audience_valid(audience_roles)),
 starts_on date not null check(starts_on between date '1900-01-01' and date '2200-12-31'),
 ends_on date check(ends_on is null or (ends_on between date '1900-01-01' and date '2200-12-31' and ends_on>=starts_on)),
 archived boolean not null default false,version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,id));
create index nam_home_announcement_dates on public.nam_home_announcements(workspace_id,archived,starts_on desc,ends_on,id);
create table public.nam_home_announcement_events(
 id bigint generated always as identity primary key,workspace_id uuid not null,announcement_id uuid not null,
 actor_id uuid not null references auth.users(id),version integer not null,
 kind text not null check(kind in ('created','edited','archived','restored')),
 before_state jsonb,after_state jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,announcement_id) references public.nam_home_announcements(workspace_id,id));
create index nam_home_announcement_history on public.nam_home_announcement_events(workspace_id,announcement_id,id desc);
create table public.nam_home_announcement_requests(
 workspace_id uuid not null,actor_id uuid not null references auth.users(id),request_key text not null check(request_key~'^[A-Za-z0-9_-]{8,128}$'),
 fingerprint jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(workspace_id,actor_id,request_key),foreign key(workspace_id) references public.nam_workspaces(id));
alter table public.nam_home_announcements enable row level security;
alter table public.nam_home_announcement_events enable row level security;
alter table public.nam_home_announcement_requests enable row level security;
create policy home_announcements_read on public.nam_home_announcements for select to authenticated using(
 public.nam_home_member(workspace_id) and (public.nam_founder(workspace_id) or
  (not archived and starts_on<=(now() at time zone 'Europe/Paris')::date and (ends_on is null or ends_on>=(now() at time zone 'Europe/Paris')::date)
   and (cardinality(audience_roles)=0 or public.nam_role(workspace_id)=any(audience_roles)))));
create policy home_announcement_events_read on public.nam_home_announcement_events for select to authenticated using(public.nam_home_member(workspace_id) and public.nam_founder(workspace_id));
revoke all on public.nam_home_announcements,public.nam_home_announcement_events,public.nam_home_announcement_requests from public,anon,authenticated,service_role;
grant select on public.nam_home_announcements,public.nam_home_announcement_events to authenticated;

create function public.nam_home_announcements_page(w uuid,filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare mode text;state text;term text;maximum integer;page_offset integer;today date:=(now() at time zone 'Europe/Paris')::date;rows jsonb;total bigint;
begin
 if not public.nam_home_member(w) then raise exception 'Active assured NAM membership required' using errcode='42501';end if;
 if jsonb_typeof(filters) is distinct from 'object' or filters-array['mode','state','q','limit','offset']<>'{}'::jsonb then raise exception 'Unsupported announcement filters' using errcode='22023';end if;
 mode:=coalesce(filters->>'mode','active');state:=coalesce(filters->>'state','all');term:=coalesce(filters->>'q','');
 if mode not in ('active','manage') or state not in ('all','current','scheduled','expired','archived') or length(term)>200
 or (filters?'mode' and jsonb_typeof(filters->'mode') is distinct from 'string') or (filters?'state' and jsonb_typeof(filters->'state') is distinct from 'string') or (filters?'q' and jsonb_typeof(filters->'q') is distinct from 'string')
 or (filters?'limit' and (jsonb_typeof(filters->'limit') is distinct from 'number' or (filters->>'limit')!~'^[0-9]{1,2}$')) or (filters?'offset' and (jsonb_typeof(filters->'offset') is distinct from 'number' or (filters->>'offset')!~'^[0-9]{1,6}$')) then raise exception 'Invalid announcement view' using errcode='22023';end if;
 maximum:=coalesce((filters->>'limit')::integer,20);page_offset:=coalesce((filters->>'offset')::integer,0);
 if maximum not between 1 and 50 or page_offset not between 0 and 100000 then raise exception 'Invalid announcement page' using errcode='22023';end if;
 if mode='manage' and not public.nam_founder(w) then raise exception 'Founder management required' using errcode='42501';end if;
 with visible as materialized (
  select a.* from public.nam_home_announcements a where a.workspace_id=w
  and (mode='manage' or (not a.archived and a.starts_on<=today and (a.ends_on is null or a.ends_on>=today) and (cardinality(a.audience_roles)=0 or public.nam_role(w)=any(a.audience_roles))))
  and (mode='active' or state='all' or (state='archived' and a.archived) or (not a.archived and ((state='current' and a.starts_on<=today and (a.ends_on is null or a.ends_on>=today)) or (state='scheduled' and a.starts_on>today) or (state='expired' and a.ends_on<today))))
  and (term='' or position(lower(term) in lower(a.title||' '||a.body))>0)
 ), page as (select * from visible order by starts_on desc,created_at desc,id limit maximum offset page_offset)
 select (select count(*) from visible),coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('state',case when p.archived then 'archived' when p.starts_on>today then 'scheduled' when p.ends_on<today then 'expired' else 'current' end) order by p.starts_on desc,p.created_at desc,p.id) from page p),'[]'::jsonb) into total,rows;
 return jsonb_build_object('items',rows,'total',total,'limit',maximum,'offset',page_offset,'hasMore',page_offset+maximum<total,'today',today,'mode',mode,'can_manage',public.nam_founder(w));
end $$;

create function public.nam_home_announcement_history(w uuid,aid uuid,page_offset integer default 0) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;total bigint;
begin
 if not public.nam_home_member(w) or not public.nam_founder(w) then raise exception 'Founder history required' using errcode='42501';end if;
 if page_offset is null or page_offset not between 0 and 100000 then raise exception 'Invalid history page' using errcode='22023';end if;
 if not exists(select 1 from public.nam_home_announcements a where a.workspace_id=w and a.id=aid) then raise exception 'Announcement unavailable' using errcode='P0002';end if;
 select count(*) into total from public.nam_home_announcement_events e where e.workspace_id=w and e.announcement_id=aid;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id desc),'[]'::jsonb) into rows from (select e.* from public.nam_home_announcement_events e where e.workspace_id=w and e.announcement_id=aid order by e.id desc limit 25 offset page_offset) q;
 return jsonb_build_object('items',rows,'total',total,'limit',25,'offset',page_offset,'hasMore',page_offset+25<total);
end $$;

create function public.nam_save_home_announcement(w uuid,aid uuid,expected_version integer,changes jsonb,retry_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.nam_home_announcements;saved public.nam_home_announcements;prior public.nam_home_announcement_requests;fingerprint jsonb;before_value jsonb;result jsonb;roles text[];event_kind text;
begin
 if not public.nam_home_member(w) or not public.nam_founder(w) then raise exception 'Founder announcement management required' using errcode='42501';end if;
 if expected_version is null or expected_version<0 or expected_version>2147483646 or jsonb_typeof(changes) is distinct from 'object' or changes-array['title','body','audience_roles','starts_on','ends_on','archived']<>'{}'::jsonb or changes='{}'::jsonb or retry_key is null or retry_key!~'^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid announcement change' using errcode='22023';end if;
 -- A write/retry must retain the live request identity through its commit.
 perform 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=auth.uid() and m.active and m.role='founder' for share;
 if not found then raise exception 'Founder membership ended' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found then raise exception 'Account unavailable' using errcode='42501';end if;
 perform 1 from auth.sessions s where s.user_id=auth.uid() and s.id=case when (auth.jwt()->>'session_id')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (auth.jwt()->>'session_id')::uuid end and (s.not_after is null or s.not_after>now()) for share;
 if not found or not public.nam_home_member(w) or not public.nam_founder(w) then raise exception 'Current assured Founder session required' using errcode='42501';end if;
 fingerprint:=jsonb_build_object('announcement_id',aid,'expected_version',expected_version,'changes',changes);
 perform pg_advisory_xact_lock(hashtextextended('nam-home-announcement:'||w::text||auth.uid()::text||retry_key,0));
 if not public.nam_home_member(w) or not public.nam_founder(w) then raise exception 'Announcement authority ended' using errcode='42501';end if;
 select * into prior from public.nam_home_announcement_requests r where r.workspace_id=w and r.actor_id=auth.uid() and r.request_key=retry_key;
 if found then
  if prior.fingerprint is distinct from fingerprint then raise exception 'Retry key reused for another change' using errcode='40001';end if;
  return prior.result;
 end if;
 if aid is null then
  if expected_version<>0 or not(changes?&array['title','body','audience_roles','starts_on','ends_on']) then raise exception 'Complete announcement fields required' using errcode='22023';end if;
 else
  select * into previous from public.nam_home_announcements a where a.workspace_id=w and a.id=aid for update;
  if not found then raise exception 'Announcement unavailable' using errcode='P0002';end if;
  if previous.version<>expected_version then raise exception 'Announcement changed' using errcode='40001';end if;
 end if;
 if (changes?'title' and (jsonb_typeof(changes->'title') is distinct from 'string' or length(btrim(changes->>'title')) not between 1 and 200 or changes->>'title'~'[[:cntrl:]]'))
 or (changes?'body' and (jsonb_typeof(changes->'body') is distinct from 'string' or length(btrim(changes->>'body')) not between 1 and 8000))
 or (changes?'archived' and jsonb_typeof(changes->'archived') is distinct from 'boolean')
 or (changes?'starts_on' and (jsonb_typeof(changes->'starts_on') is distinct from 'string' or changes->>'starts_on'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
 or (changes?'ends_on' and changes->'ends_on'<>'null'::jsonb and (jsonb_typeof(changes->'ends_on') is distinct from 'string' or changes->>'ends_on'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then raise exception 'Invalid announcement fields' using errcode='22023';end if;
 if changes?'audience_roles' then
  if jsonb_typeof(changes->'audience_roles') is distinct from 'array' or jsonb_array_length(changes->'audience_roles')>6 or exists(select 1 from jsonb_array_elements(changes->'audience_roles') value where jsonb_typeof(value) is distinct from 'string') then raise exception 'Choose valid role audiences' using errcode='22023';end if;
  select coalesce(array_agg(value order by value),'{}'::text[]) into roles from jsonb_array_elements_text(changes->'audience_roles') value;
  if not public.nam_home_audience_valid(roles) then raise exception 'Choose distinct NAM role audiences' using errcode='22023';end if;
 else roles:=previous.audience_roles;end if;
 if aid is null then
  insert into public.nam_home_announcements(workspace_id,title,body,audience_roles,starts_on,ends_on,archived,created_by,updated_by)
  values(w,btrim(changes->>'title'),btrim(changes->>'body'),roles,(changes->>'starts_on')::date,(changes->>'ends_on')::date,coalesce((changes->>'archived')::boolean,false),auth.uid(),auth.uid()) returning * into saved;
  event_kind:='created';
 else
  before_value:=to_jsonb(previous);
  update public.nam_home_announcements set title=case when changes?'title' then btrim(changes->>'title') else previous.title end,body=case when changes?'body' then btrim(changes->>'body') else previous.body end,audience_roles=roles,
   starts_on=case when changes?'starts_on' then (changes->>'starts_on')::date else previous.starts_on end,ends_on=case when changes?'ends_on' then (changes->>'ends_on')::date else previous.ends_on end,
   archived=coalesce((changes->>'archived')::boolean,previous.archived),version=version+1,updated_by=auth.uid(),updated_at=now() where id=aid returning * into saved;
  event_kind:=case when not previous.archived and saved.archived then 'archived' when previous.archived and not saved.archived then 'restored' else 'edited' end;
 end if;
 result:=to_jsonb(saved);
 insert into public.nam_home_announcement_events(workspace_id,announcement_id,actor_id,version,kind,before_state,after_state) values(w,saved.id,auth.uid(),saved.version,event_kind,before_value,result);
 insert into public.nam_home_announcement_requests(workspace_id,actor_id,request_key,fingerprint,result) values(w,auth.uid(),retry_key,fingerprint,result);
 return result;
end $$;

-- Supplemental source-labelled pointers. RLS on the existing project/image/
-- client tables remains in force; no guessed CRM or project approval metrics.
create function public.nam_home_work_context(w uuid,scope text default 'mine') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb:='{}'::jsonb;today date:=(now() at time zone 'Europe/Paris')::date;images jsonb;client_reviews jsonb;
begin
 if not public.nam_home_member(w) then raise exception 'Active assured NAM membership required' using errcode='42501';end if;
 if scope is null or scope not in ('mine','studio') then raise exception 'Invalid Home scope' using errcode='22023';end if;
 if scope='studio' and not public.nam_founder(w) then raise exception 'Founder studio scope required' using errcode='42501';end if;
 if public.nam_section(w,'projects') then
  with visible as materialized (
   select d.id,d.project_id,d.code,d.title,d.stage,d.due_date from public.nam_deliverables d join public.nam_projects p on p.workspace_id=d.workspace_id and p.id=d.project_id
   where d.workspace_id=w and not d.archived and not p.archived and (scope='studio' or not public.nam_founder(w) or d.artist_id=auth.uid() or exists(select 1 from public.nam_tasks t where t.workspace_id=w and t.deliverable_id=d.id and t.owner_id=auth.uid() and t.deleted_at is null and not t.archived))
  ) select jsonb_build_object('total',(select count(*) from visible),'review_stage',(select count(*) from visible where stage in ('Internal review','Client review')),'revisions',(select count(*) from visible where stage='Revisions'),
   'items',coalesce((select jsonb_agg(to_jsonb(q) order by q.due_date nulls last,q.code,q.id) from (select * from visible where stage in ('Internal review','Client review','Revisions') order by due_date nulls last,code,id limit 3) q),'[]'::jsonb)) into images;
 end if;
 if scope='studio' and public.nam_founder(w) and public.nam_section(w,'projects') then
  with visible as materialized (
   select q.id,q.project_id,q.title,q.issued_at from public.nam_client_review_requests q join public.nam_projects p on p.workspace_id=q.workspace_id and p.id=q.project_id where q.workspace_id=w and q.status='issued' and q.purpose='review' and not p.archived
  ) select jsonb_build_object('issued',(select count(*) from visible),'items',coalesce((select jsonb_agg(to_jsonb(q) order by q.issued_at,q.id) from (select * from visible order by issued_at,id limit 3) q),'[]'::jsonb)) into client_reviews;
 end if;
 return jsonb_build_object('scope',scope,'today',today,'images',images,'client_reviews',client_reviews,'definitions',jsonb_build_object('images','Counts use permitted image inventory records, not task counts or approvals.','client_reviews','Issued client review requests are open requests, not a count of unanswered images or client approvals.'));
end $$;

revoke all on function public.nam_home_member(uuid),public.nam_home_audience_valid(text[]),public.nam_home_announcements_page(uuid,jsonb),public.nam_home_announcement_history(uuid,uuid,integer),public.nam_save_home_announcement(uuid,uuid,integer,jsonb,text),public.nam_home_work_context(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.nam_home_member(uuid),public.nam_home_audience_valid(text[]),public.nam_home_announcements_page(uuid,jsonb),public.nam_home_announcement_history(uuid,uuid,integer),public.nam_save_home_announcement(uuid,uuid,integer,jsonb,text),public.nam_home_work_context(uuid,text) to authenticated;
commit;
