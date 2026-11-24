-- Sales accountability and read-only connected-source snapshots.
-- Apply after foundation/tasks/academy on staging; no credentials are stored.
begin;
create function public.nam_sales_visible(w uuid,owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_section(w,'sales') and (owner=auth.uid() or public.nam_founder(w)) $$;
create table public.nam_sales_activities(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),
 owner_id uuid not null,type text not null check(type in ('Outreach','Reply','Meeting held','Proposal','Research')),
 context text not null check(length(trim(context)) between 1 and 200),outcome text not null check(length(trim(outcome)) between 1 and 500),
 note text not null default '' check(length(note)<=3000),occurred_on date not null check(occurred_on between date '0001-01-01' and date '9999-12-31'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
 version integer not null default 1,request_key text check(length(request_key)<=128),request_fingerprint text,
 foreign key(workspace_id,owner_id) references public.nam_memberships(workspace_id,user_id),
 unique(workspace_id,owner_id,request_key));
create index nam_sales_activity_owner on public.nam_sales_activities(workspace_id,owner_id,occurred_on) where deleted_at is null;
create table public.nam_sales_reports(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),owner_id uuid not null,
 week_start date not null check(week_start between date '0001-01-01' and date '9999-12-31' and extract(isodow from week_start)=1),outcomes text not null check(length(trim(outcomes)) between 1 and 5000),
 blockers text not null default '' check(length(blockers)<=5000),next_week text not null check(length(trim(next_week)) between 1 and 5000),
 submitted_at timestamptz not null default now(),reviewed_at timestamptz,reviewed_by uuid references auth.users(id),
 foreign key(workspace_id,owner_id) references public.nam_memberships(workspace_id,user_id),unique(workspace_id,owner_id,week_start));
create table public.nam_sales_targets(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),owner_id uuid not null,
 metric text not null check(metric in ('Meetings held','Outreach','Proposal','Reply','Research')),
 period text not null check(period~'^\d{4}-(0[1-9]|1[0-2])$'),target integer not null check(target between 1 and 100000),
 created_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 foreign key(workspace_id,owner_id) references public.nam_memberships(workspace_id,user_id),unique(workspace_id,owner_id,metric,period));
create table public.nam_sales_events(id bigint generated always as identity primary key,workspace_id uuid not null references public.nam_workspaces(id),owner_id uuid not null,actor_id uuid not null references auth.users(id),record_id uuid not null,kind text not null,created_at timestamptz not null default now());
alter table public.nam_sales_activities enable row level security;
alter table public.nam_sales_reports enable row level security;
alter table public.nam_sales_targets enable row level security;
alter table public.nam_sales_events enable row level security;
create policy sales_activities_read on public.nam_sales_activities for select to authenticated using(deleted_at is null and public.nam_sales_visible(workspace_id,owner_id));
create policy sales_reports_read on public.nam_sales_reports for select to authenticated using(public.nam_sales_visible(workspace_id,owner_id));
create policy sales_targets_read on public.nam_sales_targets for select to authenticated using(public.nam_sales_visible(workspace_id,owner_id));
create policy sales_events_read on public.nam_sales_events for select to authenticated using(public.nam_sales_visible(workspace_id,owner_id));
create function public.nam_sales_activity_counts(w uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with visible as (select a.owner_id,a.type,a.occurred_on from public.nam_sales_activities a where a.workspace_id=w and a.deleted_at is null), grouped as (select v.owner_id,v.type,to_char(v.occurred_on,'YYYY-MM') as period,count(*) as n from visible v group by v.owner_id,v.type,to_char(v.occurred_on,'YYYY-MM'))
 select jsonb_build_object('total',(select count(*) from visible),'by_month',coalesce((select jsonb_agg(to_jsonb(g)) from grouped g),'[]'::jsonb)) $$;

create function public.nam_save_sales_activity(w uuid,activity_id uuid,expected_version integer,payload jsonb,p_request_key text default null)
returns public.nam_sales_activities language plpgsql security definer set search_path='' as $$
declare old public.nam_sales_activities; result public.nam_sales_activities; fingerprint text;
begin
 if not public.nam_section(w,'sales') then raise exception 'Sales access denied' using errcode='42501'; end if;
 if jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) as f(key) where f.key not in ('type','context','outcome','note','occurred_on','deleted')) then raise exception 'Invalid activity fields'; end if;
 if activity_id is not null then
  select * into old from public.nam_sales_activities a where a.id=activity_id and a.workspace_id=w and a.deleted_at is null for update;
  if not found or not public.nam_sales_visible(w,old.owner_id) then raise exception 'Activity unavailable' using errcode='42501'; end if;
  if expected_version is distinct from old.version then raise exception 'Activity changed elsewhere' using errcode='40001'; end if;
  update public.nam_sales_activities a set type=coalesce(payload->>'type',old.type),context=coalesce(trim(payload->>'context'),old.context),outcome=coalesce(trim(payload->>'outcome'),old.outcome),note=coalesce(payload->>'note',old.note),occurred_on=coalesce((payload->>'occurred_on')::date,old.occurred_on),deleted_at=case when payload->>'deleted'='true' then now() else old.deleted_at end,updated_at=now(),version=old.version+1 where a.id=old.id returning * into result;
 else
  if payload?'deleted' then raise exception 'Cannot delete a new activity'; end if;
  fingerprint:=encode(sha256(convert_to(payload::text,'utf8')),'hex');
  if p_request_key is not null then select * into result from public.nam_sales_activities a where a.workspace_id=w and a.owner_id=auth.uid() and a.request_key=p_request_key; if found then if result.request_fingerprint is distinct from fingerprint then raise exception 'Request key reused for different data' using errcode='40001'; end if; return result; end if; end if;
  insert into public.nam_sales_activities(workspace_id,owner_id,type,context,outcome,note,occurred_on,request_key,request_fingerprint)
  values(w,auth.uid(),payload->>'type',trim(payload->>'context'),trim(payload->>'outcome'),coalesce(payload->>'note',''),(payload->>'occurred_on')::date,p_request_key,fingerprint)
  on conflict(workspace_id,owner_id,request_key) do nothing returning * into result;
  if not found then select * into result from public.nam_sales_activities a where a.workspace_id=w and a.owner_id=auth.uid() and a.request_key=p_request_key;if result.request_fingerprint is distinct from fingerprint then raise exception 'Request key reused for different data' using errcode='40001';end if;return result;end if;
 end if;
 insert into public.nam_sales_events(workspace_id,owner_id,actor_id,record_id,kind) values(w,result.owner_id,auth.uid(),result.id,case when old.id is null then 'activity_created' when result.deleted_at is not null then 'activity_deleted' else 'activity_updated' end);
 return result;
end $$;
create function public.nam_submit_sales_report(w uuid,payload jsonb) returns public.nam_sales_reports
language plpgsql security definer set search_path='' as $$
declare result public.nam_sales_reports;
begin
 if not public.nam_section(w,'sales') then raise exception 'Sales access denied' using errcode='42501'; end if;
 if jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) as f(key) where f.key not in ('week_start','outcomes','blockers','next_week')) then raise exception 'Invalid report fields'; end if;
 insert into public.nam_sales_reports(workspace_id,owner_id,week_start,outcomes,blockers,next_week)
 values(w,auth.uid(),(payload->>'week_start')::date,trim(payload->>'outcomes'),coalesce(payload->>'blockers',''),trim(payload->>'next_week'))
 on conflict(workspace_id,owner_id,week_start) do update set outcomes=excluded.outcomes,blockers=excluded.blockers,next_week=excluded.next_week,submitted_at=now(),reviewed_at=null,reviewed_by=null returning * into result;
 insert into public.nam_sales_events(workspace_id,owner_id,actor_id,record_id,kind) values(w,auth.uid(),auth.uid(),result.id,'report_submitted');return result;
end $$;
create function public.nam_review_sales_report(w uuid,report_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501'; end if;
 update public.nam_sales_reports r set reviewed_at=now(),reviewed_by=auth.uid() where r.workspace_id=w and r.id=report_id returning r.owner_id into owner;
 if not found then raise exception 'Report not found' using errcode='P0002'; end if;
 insert into public.nam_sales_events(workspace_id,owner_id,actor_id,record_id,kind) values(w,owner,auth.uid(),report_id,'report_reviewed');
end $$;
create function public.nam_set_sales_target(w uuid,payload jsonb) returns public.nam_sales_targets
language plpgsql security definer set search_path='' as $$
declare result public.nam_sales_targets; target_owner uuid;
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501'; end if;
 if jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) as f(key) where f.key not in ('owner_id','metric','period','target')) then raise exception 'Invalid target fields'; end if;
 target_owner:=(payload->>'owner_id')::uuid;
 if not exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=target_owner and m.active and m.role in ('sales','sales_manager','founder')) then raise exception 'Target owner unavailable'; end if;
 insert into public.nam_sales_targets(workspace_id,owner_id,metric,period,target,created_by) values(w,target_owner,payload->>'metric',payload->>'period',(payload->>'target')::integer,auth.uid())
 on conflict(workspace_id,owner_id,metric,period) do update set target=excluded.target,updated_at=now() returning * into result;
 insert into public.nam_sales_events(workspace_id,owner_id,actor_id,record_id,kind) values(w,target_owner,auth.uid(),result.id,'target_updated');return result;
end $$;

create table public.nam_integration_state(
 workspace_id uuid not null references public.nam_workspaces(id),source text not null check(source in ('attio','lemlist','justcall')),
 status text not null default 'not_connected' check(status in ('not_connected','syncing','connected','expired','rate_limited','error')),
 last_attempt_at timestamptz,last_success_at timestamptz,error_code text,error_message text check(length(error_message)<=500),retry_at timestamptz,
 coverage jsonb not null default '{}',warnings jsonb not null default '[]',credential_fingerprint text,last_success_fingerprint text,
 lease_token uuid,lease_until timestamptz,primary key(workspace_id,source));
create table public.nam_integration_records(
 workspace_id uuid not null,source text not null,kind text not null,external_id text not null check(length(external_id) between 1 and 300),
 external_owner_id text check(length(external_owner_id)<=300),payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=30000),
 synced_at timestamptz not null default now(),credential_fingerprint text not null,
 primary key(workspace_id,source,kind,external_id),foreign key(workspace_id,source) references public.nam_integration_state(workspace_id,source),
 check((source='attio' and kind in ('lead','company','deal')) or (source='lemlist' and kind in ('campaign','campaign_report','outreach')) or (source='justcall' and kind='call')));
create index nam_integration_records_owner on public.nam_integration_records(workspace_id,source,external_owner_id);
create table public.nam_integration_owner_map(
 workspace_id uuid not null,source text not null,external_owner_id text not null check(length(external_owner_id) between 1 and 300),member_id uuid not null,updated_at timestamptz not null default now(),
 primary key(workspace_id,source,external_owner_id),foreign key(workspace_id,source) references public.nam_integration_state(workspace_id,source),foreign key(workspace_id,member_id) references public.nam_memberships(workspace_id,user_id));
alter table public.nam_integration_state enable row level security;
alter table public.nam_integration_records enable row level security;
alter table public.nam_integration_owner_map enable row level security;
create function public.nam_integration_record_visible(w uuid,s text,owner text,fingerprint text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_section(w,'sales') and exists(select 1 from public.nam_integration_state st where st.workspace_id=w and st.source=s and st.credential_fingerprint=fingerprint and st.last_success_fingerprint=fingerprint)
 and (public.nam_founder(w) or exists(select 1 from public.nam_integration_owner_map m where m.workspace_id=w and m.source=s and m.external_owner_id=owner and m.member_id=auth.uid())) $$;
create policy integration_state_read on public.nam_integration_state for select to authenticated using(public.nam_section(workspace_id,'sales'));
create policy integration_records_read on public.nam_integration_records for select to authenticated using(public.nam_integration_record_visible(workspace_id,source,external_owner_id,credential_fingerprint));
create policy integration_mapping_read on public.nam_integration_owner_map for select to authenticated using(public.nam_section(workspace_id,'sales') and (public.nam_founder(workspace_id) or member_id=auth.uid()));
create function public.nam_integration_connection_state(w uuid,fingerprints jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('source',s.source,'status',s.status,'last_attempt_at',s.last_attempt_at,'last_success_at',s.last_success_at,'error_code',s.error_code,'error_message',s.error_message,'retry_at',s.retry_at,'coverage',s.coverage,'warnings',s.warnings,'lease_until',s.lease_until,'snapshot_current',s.last_success_fingerprint=fingerprints->>s.source)), '[]'::jsonb)
 from public.nam_integration_state s where s.workspace_id=w and (public.nam_section(w,'sales') or auth.role()='service_role') $$;

create function public.nam_begin_integration_sync(w uuid,s text,fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare current public.nam_integration_state; token uuid:=gen_random_uuid();
begin
 if not (public.nam_founder(w) or auth.role()='service_role') then raise exception 'Founder MFA required' using errcode='42501'; end if;
 if s is null or s not in ('attio','lemlist','justcall') or fingerprint is null or fingerprint!~'^[a-f0-9]{64}$' then raise exception 'Invalid source configuration'; end if;
 insert into public.nam_integration_state(workspace_id,source) values(w,s) on conflict do nothing;
 select * into current from public.nam_integration_state st where st.workspace_id=w and st.source=s for update;
 if current.retry_at>now() then raise exception 'Retry time not reached' using errcode='55000'; end if;
 if current.lease_until>now() then raise exception 'Connection already syncing' using errcode='55000'; end if;
 if current.credential_fingerprint is not null and current.credential_fingerprint<>fingerprint then delete from public.nam_integration_owner_map m where m.workspace_id=w and m.source=s; end if;
 update public.nam_integration_state st set status='syncing',last_attempt_at=now(),error_code=null,error_message=null,credential_fingerprint=fingerprint,lease_token=token,lease_until=now()+interval '60 seconds' where st.workspace_id=w and st.source=s;
 return token;
end $$;
create function public.nam_renew_integration_lease(w uuid,s text,token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not (public.nam_founder(w) or auth.role()='service_role') then raise exception 'Founder MFA required' using errcode='42501'; end if;
 update public.nam_integration_state st set lease_until=now()+interval '60 seconds' where st.workspace_id=w and st.source=s and st.lease_token=token and st.lease_until>now();
 if not found then raise exception 'Sync lease expired' using errcode='55000'; end if;
end $$;
create function public.nam_finish_integration_sync(w uuid,s text,token uuid,records jsonb,coverage jsonb,warnings jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare current public.nam_integration_state; count_records integer;
begin
 if not (public.nam_founder(w) or auth.role()='service_role') then raise exception 'Founder MFA required' using errcode='42501'; end if;
 select * into current from public.nam_integration_state st where st.workspace_id=w and st.source=s for update;
 if not found or token is null or current.lease_token is null or current.lease_until is null or current.lease_token is distinct from token or current.lease_until<=now() then raise exception 'Sync lease expired' using errcode='55000'; end if;
 if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>50000 or jsonb_typeof(coverage) is distinct from 'object' or jsonb_typeof(warnings) is distinct from 'array' then raise exception 'Invalid snapshot'; end if;
 delete from public.nam_integration_records r where r.workspace_id=w and r.source=s;
 insert into public.nam_integration_records(workspace_id,source,kind,external_id,external_owner_id,payload,synced_at,credential_fingerprint)
 select w,s,item->>'kind',item->>'external_id',nullif(item->>'external_owner_id',''),item||jsonb_build_object('source',s),now(),current.credential_fingerprint from (select distinct on (value->>'kind',value->>'external_id') value as item from jsonb_array_elements(records) with ordinality as elements(value,n) order by value->>'kind',value->>'external_id',n) dedup;
 get diagnostics count_records=row_count;
 update public.nam_integration_state st set status='connected',last_success_at=now(),last_success_fingerprint=current.credential_fingerprint,error_code=null,error_message=null,retry_at=null,coverage=nam_finish_integration_sync.coverage,warnings=nam_finish_integration_sync.warnings,lease_token=null,lease_until=null where st.workspace_id=w and st.source=s;
 return count_records;
end $$;
create function public.nam_fail_integration_sync(w uuid,s text,token uuid,code text,message text,retry_time timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not (public.nam_founder(w) or auth.role()='service_role') then raise exception 'Founder MFA required' using errcode='42501'; end if;
 if code is null or message is null or code not in ('expired','permission_denied','rate_limited','unavailable','invalid_response','configuration_error','limit_exceeded','credentials_changed','sync_failed') or length(message)>500 then raise exception 'Invalid failure state'; end if;
 update public.nam_integration_state st set status=case when code='expired' then 'expired' when code='rate_limited' then 'rate_limited' else 'error' end,error_code=code,error_message=message,retry_at=retry_time,lease_token=null,lease_until=null where st.workspace_id=w and st.source=s and st.lease_token=token;
end $$;
create function public.nam_map_integration_owner(w uuid,s text,external_owner text,member uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501'; end if;
 if not exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=member and m.active and m.role in ('founder','sales_manager','sales')) then raise exception 'Member unavailable'; end if;
 if not exists(select 1 from public.nam_integration_records r join public.nam_integration_state st on st.workspace_id=r.workspace_id and st.source=r.source and st.last_success_fingerprint=r.credential_fingerprint and st.credential_fingerprint=r.credential_fingerprint where r.workspace_id=w and r.source=s and r.external_owner_id=external_owner) then raise exception 'External owner unavailable'; end if;
 insert into public.nam_integration_owner_map(workspace_id,source,external_owner_id,member_id) values(w,s,external_owner,member) on conflict(workspace_id,source,external_owner_id) do update set member_id=excluded.member_id,updated_at=now();
end $$;
create function public.nam_connected_sales_data(w uuid,fingerprints jsonb,record_limit integer default 20,record_offset integer default 0,filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; founder boolean; actor uuid;
begin
 if not public.nam_section(w,'sales') then raise exception 'Sales access denied' using errcode='42501'; end if;
 if record_limit is null or record_offset is null or record_limit not between 1 and 500 or record_offset not between 0 and 150000 or jsonb_typeof(filters) is distinct from 'object' or length(coalesce(filters->>'q',''))>200 then raise exception 'Invalid record filters'; end if;
 founder:=public.nam_founder(w);actor:=auth.uid();
 with visible as materialized (
  select r.source,r.kind,r.external_id,r.external_owner_id,r.payload,r.synced_at,m.member_id
  from public.nam_integration_records r left join public.nam_integration_owner_map m on m.workspace_id=r.workspace_id and m.source=r.source and m.external_owner_id=r.external_owner_id
  join public.nam_integration_state st on st.workspace_id=r.workspace_id and st.source=r.source and st.credential_fingerprint=r.credential_fingerprint and st.last_success_fingerprint=r.credential_fingerprint
  where r.workspace_id=w and r.credential_fingerprint=fingerprints->>r.source and (founder or m.member_id=actor)
 ), filtered as (
  select * from visible v where (coalesce(filters->>'kind','')='' or v.kind=filters->>'kind') and (coalesce(filters->>'source','')='' or v.source=filters->>'source') and (coalesce(filters->>'owner','')='' or v.member_id::text=filters->>'owner') and (coalesce(filters->>'q','')='' or position(lower(filters->>'q') in lower(v.payload::text))>0)
 ), counts as (select v.source,v.kind,count(*) as n from visible v group by v.source,v.kind), values_by_stage as (
  select v.payload->>'currency' as currency,coalesce(nullif(v.payload->>'stage',''),'Unspecified') as stage,sum(case when jsonb_typeof(v.payload->'amount')='number' then (v.payload->>'amount')::numeric else 0 end) as amount
  from visible v where v.kind='deal' and v.payload->>'currency'~'^[A-Z]{3}$' and jsonb_typeof(v.payload->'amount')='number' group by v.payload->>'currency',coalesce(nullif(v.payload->>'stage',''),'Unspecified')
 ), page as (select f.* from filtered f order by coalesce(f.payload->>'occurred_at',f.synced_at::text) desc,f.source,f.kind,f.external_id limit record_limit offset record_offset)
 select jsonb_build_object(
  'counts',coalesce((select jsonb_agg(to_jsonb(c)) from counts c),'[]'::jsonb),
  'reply_events',(select count(*) from visible v where v.kind='outreach' and v.payload->>'activity_type' ilike '%replied%'),
  'pipeline',coalesce((select jsonb_agg(to_jsonb(p)) from values_by_stage p),'[]'::jsonb),
  'records_total',(select count(*) from filtered),
  'records',coalesce((select jsonb_agg(p.payload||jsonb_build_object('source',p.source,'last_synced_at',p.synced_at,'owner_member_id',p.member_id)) from page p),'[]'::jsonb),
  'external_owners',case when founder then coalesce((select jsonb_agg(jsonb_build_object('source',o.source,'external_owner_id',o.external_owner_id)) from (select distinct v.source,v.external_owner_id from visible v where v.external_owner_id is not null) o),'[]'::jsonb) else '[]'::jsonb end
 ) into result;
 return result;
end $$;

-- Secret fingerprints and lease tokens are not exposed by direct client selects.
revoke all on public.nam_sales_activities,public.nam_sales_reports,public.nam_sales_targets,public.nam_sales_events,public.nam_integration_state,public.nam_integration_records,public.nam_integration_owner_map from anon,authenticated;
grant select on public.nam_sales_activities,public.nam_sales_reports,public.nam_sales_targets,public.nam_sales_events,public.nam_integration_owner_map to authenticated;
grant select(workspace_id,source,status,last_attempt_at,last_success_at,error_code,error_message,retry_at,coverage,warnings,lease_until) on public.nam_integration_state to authenticated;
grant select(workspace_id,source,kind,external_id,external_owner_id,payload,synced_at) on public.nam_integration_records to authenticated;
revoke all on function public.nam_sales_visible(uuid,uuid),public.nam_save_sales_activity(uuid,uuid,integer,jsonb,text),public.nam_submit_sales_report(uuid,jsonb),public.nam_review_sales_report(uuid,uuid),public.nam_set_sales_target(uuid,jsonb),public.nam_integration_record_visible(uuid,text,text,text),public.nam_begin_integration_sync(uuid,text,text),public.nam_renew_integration_lease(uuid,text,uuid),public.nam_finish_integration_sync(uuid,text,uuid,jsonb,jsonb,jsonb),public.nam_fail_integration_sync(uuid,text,uuid,text,text,timestamptz),public.nam_map_integration_owner(uuid,text,text,uuid) from public,anon;
revoke all on function public.nam_integration_connection_state(uuid,jsonb) from public,anon;
grant execute on function public.nam_integration_connection_state(uuid,jsonb) to authenticated,service_role;
revoke all on function public.nam_sales_activity_counts(uuid) from public,anon;
grant execute on function public.nam_sales_activity_counts(uuid) to authenticated;
revoke all on function public.nam_connected_sales_data(uuid,jsonb,integer,integer,jsonb) from public,anon;
grant execute on function public.nam_connected_sales_data(uuid,jsonb,integer,integer,jsonb) to authenticated;
grant execute on function public.nam_sales_visible(uuid,uuid),public.nam_save_sales_activity(uuid,uuid,integer,jsonb,text),public.nam_submit_sales_report(uuid,jsonb),public.nam_review_sales_report(uuid,uuid),public.nam_set_sales_target(uuid,jsonb),public.nam_integration_record_visible(uuid,text,text,text),public.nam_begin_integration_sync(uuid,text,text),public.nam_renew_integration_lease(uuid,text,uuid),public.nam_finish_integration_sync(uuid,text,uuid,jsonb,jsonb,jsonb),public.nam_fail_integration_sync(uuid,text,uuid,text,text,timestamptz),public.nam_map_integration_owner(uuid,text,text,uuid) to authenticated;
grant execute on function public.nam_begin_integration_sync(uuid,text,text),public.nam_renew_integration_lease(uuid,text,uuid),public.nam_finish_integration_sync(uuid,text,uuid,jsonb,jsonb,jsonb),public.nam_fail_integration_sync(uuid,text,uuid,text,text,timestamptz) to service_role;
commit;
