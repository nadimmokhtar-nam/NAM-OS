-- Attio remains the CRM. These tables hold NAM objectives and links to central
-- tasks; provider records are read only, fingerprint-bound snapshots.
begin;
create table public.nam_sales_followup_links(
 task_id uuid primary key references public.nam_tasks(id),
 workspace_id uuid not null references public.nam_workspaces(id),
 source text not null check(source in ('attio','lemlist','justcall')),
 kind text not null check(kind in ('lead','company','deal','campaign','campaign_report','outreach','call')),
 external_id text not null check(length(external_id) between 1 and 300),
 credential_fingerprint text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 updated_at timestamptz not null default now());
create index nam_sales_followup_record on public.nam_sales_followup_links(workspace_id,source,kind,external_id);
create table public.nam_sales_followup_requests(
 workspace_id uuid not null references public.nam_workspaces(id),actor_id uuid not null references auth.users(id),
 request_key text not null check(length(request_key) between 8 and 128),payload jsonb not null,
 task_id uuid not null references public.nam_tasks(id),created_at timestamptz not null default now(),
 primary key(workspace_id,actor_id,request_key));
create table public.nam_sales_revenue_targets(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.nam_workspaces(id),owner_id uuid not null,
 period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and period between '1900-01' and '2200-12'),
 currency text not null check(currency ~ '^[A-Z]{3}$'),amount numeric(18,2) not null check(amount>0 and amount<=1000000000000),
 note text not null default '' check(length(note)<=1000),version integer not null default 1 check(version>0),
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 foreign key(workspace_id,owner_id) references public.nam_memberships(workspace_id,user_id),
 unique(workspace_id,owner_id,period,currency));
create table public.nam_sales_revenue_target_events(
 id bigint generated always as identity primary key,target_id uuid not null references public.nam_sales_revenue_targets(id),
 workspace_id uuid not null,owner_id uuid not null,actor_id uuid not null references auth.users(id),
 before_value jsonb,after_value jsonb not null,created_at timestamptz not null default now());

alter table public.nam_sales_followup_links enable row level security;
alter table public.nam_sales_followup_requests enable row level security;
alter table public.nam_sales_revenue_targets enable row level security;
alter table public.nam_sales_revenue_target_events enable row level security;
create function public.nam_sales_followup_visible(w uuid,tid uuid,s text,k text,ref text,fp text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nam_section(w,'sales') and exists(select 1 from public.nam_tasks t where t.id=tid and t.workspace_id=w and t.section='sales' and t.deleted_at is null and public.nam_task_access(t.id))
 and exists(select 1 from public.nam_integration_records r where r.workspace_id=w and r.source=s and r.kind=k and r.external_id=ref and r.credential_fingerprint=fp and public.nam_integration_record_visible(w,r.source,r.external_owner_id,r.credential_fingerprint))
$$;
create policy sales_followups_read on public.nam_sales_followup_links for select to authenticated using(public.nam_sales_followup_visible(workspace_id,task_id,source,kind,external_id,credential_fingerprint));
create policy sales_revenue_targets_read on public.nam_sales_revenue_targets for select to authenticated using(public.nam_sales_visible(workspace_id,owner_id));
create policy sales_revenue_target_events_read on public.nam_sales_revenue_target_events for select to authenticated using(public.nam_sales_visible(workspace_id,owner_id));

create function public.nam_link_sales_followup(w uuid,tid uuid,s text,k text,ref text,expected_task_version integer,source_fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare task public.nam_tasks; provider public.nam_integration_records; previous public.nam_sales_followup_links;
begin
 perform public.nam_task_schedule_lock(w);
 if not public.nam_section(w,'sales') then raise exception 'Sales access denied' using errcode='42501';end if;
 if s is null or k is null or ref is null or length(ref) not between 1 and 300 or expected_task_version is null or source_fingerprint is null then raise exception 'Invalid follow-up link' using errcode='22023';end if;
 select * into task from public.nam_tasks t where t.workspace_id=w and t.id=tid and t.section='sales' and t.deleted_at is null for update;
 if not found or not public.nam_task_access(tid) then raise exception 'Task unavailable' using errcode='P0002';end if;
 if task.version<>expected_task_version then raise exception 'Task changed' using errcode='40001';end if;
 select * into provider from public.nam_integration_records r where r.workspace_id=w and r.source=s and r.kind=k and r.external_id=ref and r.credential_fingerprint=source_fingerprint and public.nam_integration_record_visible(w,r.source,r.external_owner_id,r.credential_fingerprint) for share;
 if not found then raise exception 'Source record unavailable' using errcode='P0002';end if;
 select * into previous from public.nam_sales_followup_links l where l.task_id=tid;
 if previous.task_id is not null and (previous.source,previous.kind,previous.external_id,previous.credential_fingerprint) is distinct from (s,k,ref,provider.credential_fingerprint) then raise exception 'This task already has another source record' using errcode='40001';end if;
 if previous.task_id is null then
  insert into public.nam_sales_followup_links(task_id,workspace_id,source,kind,external_id,credential_fingerprint,created_by) values(tid,w,s,k,ref,provider.credential_fingerprint,auth.uid());
  update public.nam_tasks set version=version+1,updated_at=now() where id=tid;
  insert into public.nam_task_events(task_id,actor_id,kind,body) values(tid,auth.uid(),'sales_context',jsonb_build_object('message','Linked a sales source record.'));
 end if;
 return tid;
end $$;

create function public.nam_unlink_sales_followup(w uuid,tid uuid,expected_task_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare task public.nam_tasks;
begin
 perform public.nam_task_schedule_lock(w);
 if not public.nam_section(w,'sales') then raise exception 'Sales access denied' using errcode='42501';end if;
 select * into task from public.nam_tasks t where t.workspace_id=w and t.id=tid and t.section='sales' and t.deleted_at is null for update;
 if not found or not public.nam_task_access(tid) then raise exception 'Task unavailable' using errcode='P0002';end if;
 if expected_task_version is null or task.version<>expected_task_version then raise exception 'Task changed' using errcode='40001';end if;
 delete from public.nam_sales_followup_links l where l.workspace_id=w and l.task_id=tid;
 if found then
  update public.nam_tasks set version=version+1,updated_at=now() where id=tid;
  insert into public.nam_task_events(task_id,actor_id,kind,body) values(tid,auth.uid(),'sales_context',jsonb_build_object('message','Removed the sales source link.'));
 end if;
 return tid;
end $$;

create function public.nam_create_sales_followup(w uuid,s text,k text,ref text,changes jsonb,retry_key text,source_fingerprint text) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
declare previous public.nam_sales_followup_requests; task public.nam_tasks; body jsonb;
begin
 perform public.nam_task_schedule_lock(w);
 if not public.nam_section(w,'sales') then raise exception 'Sales access denied' using errcode='42501';end if;
 if jsonb_typeof(changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(changes) key where key not in ('title','description','priority','due_date')) or retry_key is null or retry_key!~'^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid follow-up fields' using errcode='22023';end if;
 body:=jsonb_build_object('source',s,'kind',k,'external_id',ref,'changes',changes);
 perform pg_advisory_xact_lock(hashtextextended('nam-sales-followup:'||w::text||auth.uid()::text||retry_key,0));
 select * into previous from public.nam_sales_followup_requests r where r.workspace_id=w and r.actor_id=auth.uid() and r.request_key=retry_key;
 if found then
  if previous.payload is distinct from body then raise exception 'Retry key reused for different data' using errcode='40001';end if;
  select * into task from public.nam_tasks t where t.workspace_id=w and t.id=previous.task_id and t.deleted_at is null and public.nam_task_access(t.id);
  if not found then raise exception 'Follow-up unavailable' using errcode='P0002';end if;
  return task;
 end if;
 task:=public.nam_create_task(w,changes||jsonb_build_object('section','sales','owner_id',auth.uid()),null);
 perform public.nam_link_sales_followup(w,task.id,s,k,ref,task.version,source_fingerprint);
 select * into task from public.nam_tasks t where t.id=task.id;
 insert into public.nam_sales_followup_requests(workspace_id,actor_id,request_key,payload,task_id) values(w,auth.uid(),retry_key,body,task.id);
 return task;
end $$;

create function public.nam_set_sales_revenue_target(w uuid,payload jsonb) returns public.nam_sales_revenue_targets
language plpgsql security definer set search_path='' as $$
declare previous public.nam_sales_revenue_targets; result public.nam_sales_revenue_targets; member uuid; month text; ccy text; target numeric; revision integer;
begin
 perform public.nam_task_schedule_lock(w);
 if not public.nam_founder(w) then raise exception 'Founder access denied' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) key where key not in ('owner_id','period','currency','amount','note','expectedVersion')) then raise exception 'Invalid target fields' using errcode='22023';end if;
 member:=(payload->>'owner_id')::uuid;month:=payload->>'period';ccy:=payload->>'currency';target:=(payload->>'amount')::numeric;revision:=(payload->>'expectedVersion')::integer;
 if member is null or month is null or ccy is null or target is null or target::text in ('NaN','Infinity','-Infinity') or target<=0 or target>1000000000000 or scale(target)>2 or length(coalesce(payload->>'note',''))>1000 or not public.nam_member_section(w,member,'sales') then raise exception 'Invalid revenue objective' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||member::text||month||ccy,0));
 select * into previous from public.nam_sales_revenue_targets t where t.workspace_id=w and t.owner_id=member and t.period=month and t.currency=ccy for update;
 if previous.id is not null and (revision is null or revision<>previous.version) then raise exception 'Target changed' using errcode='40001';end if;
 if previous.id is null and revision is not null then raise exception 'Target changed' using errcode='40001';end if;
 insert into public.nam_sales_revenue_targets(workspace_id,owner_id,period,currency,amount,note,updated_by)
 values(w,member,month,ccy,target,coalesce(payload->>'note',''),auth.uid())
 on conflict(workspace_id,owner_id,period,currency) do update set amount=excluded.amount,note=excluded.note,version=nam_sales_revenue_targets.version+1,updated_by=auth.uid(),updated_at=now() returning * into result;
 insert into public.nam_sales_revenue_target_events(target_id,workspace_id,owner_id,actor_id,before_value,after_value) values(result.id,w,member,auth.uid(),case when previous.id is null then null else to_jsonb(previous) end,to_jsonb(result));
 return result;
end $$;

create function public.nam_sales_workspace_data(w uuid,fingerprints jsonb,filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare founder boolean; actor uuid; selected_owner text; view_name text; search text; month text; page_size integer; page_offset integer; result jsonb;
begin
 if not public.nam_section(w,'sales') then raise exception 'Sales access denied' using errcode='42501';end if;
 if jsonb_typeof(filters) is distinct from 'object' or jsonb_typeof(fingerprints) is distinct from 'object' then raise exception 'Invalid sales query' using errcode='22023';end if;
 founder:=public.nam_founder(w);actor:=auth.uid();selected_owner:=coalesce(filters->>'owner','');view_name:=coalesce(filters->>'view','contacts');search:=coalesce(filters->>'q','');month:=coalesce(filters->>'period',to_char(current_date,'YYYY-MM'));page_size:=coalesce((filters->>'limit')::integer,30);page_offset:=coalesce((filters->>'offset')::integer,0);
 if view_name not in ('contacts','leads','companies','opportunities','pipeline','followups','campaigns','outreach','calls','performance','revenue') or length(search)>200 or month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or month not between '1900-01' and '2200-12' or page_size not between 1 and 100 or page_offset not between 0 and 150000 or (selected_owner<>'' and selected_owner!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Invalid sales filters' using errcode='22023';end if;
 if not founder and selected_owner<>'' and selected_owner<>actor::text then raise exception 'Individual scope required' using errcode='42501';end if;
 with visible as materialized (
  select r.source,r.kind,r.external_id,r.external_owner_id,r.payload,r.synced_at,r.credential_fingerprint,m.member_id
  from public.nam_integration_records r
  join public.nam_integration_state st on st.workspace_id=r.workspace_id and st.source=r.source and st.credential_fingerprint=r.credential_fingerprint and st.last_success_fingerprint=r.credential_fingerprint
  left join public.nam_integration_owner_map m on m.workspace_id=r.workspace_id and m.source=r.source and m.external_owner_id=r.external_owner_id
  where r.workspace_id=w and r.credential_fingerprint=fingerprints->>r.source and (founder or m.member_id=actor) and (selected_owner='' or m.member_id::text=selected_owner)
 ), tasks as materialized (
  select t.id,t.number,t.title,t.owner_id,t.status,t.priority,t.due_date,t.completed_at,t.version,l.source,l.kind,l.external_id,l.task_id is not null as has_source_link,v.payload->>'title' as record_title
  from public.nam_tasks t
  left join public.nam_sales_followup_links l on l.task_id=t.id and l.workspace_id=t.workspace_id
  left join visible v on v.source=l.source and v.kind=l.kind and v.external_id=l.external_id and v.credential_fingerprint=l.credential_fingerprint
  where t.workspace_id=w and t.section='sales' and t.deleted_at is null and not t.archived and (founder or t.owner_id=actor) and (selected_owner='' or t.owner_id::text=selected_owner)
  -- The task itself remains accessible after disconnection. Its linked source
  -- context is redacted when the provider record is no longer in scope.
 ), matched_tasks as (
  select t.id,t.number,t.title,t.owner_id,t.status,t.priority,t.due_date,t.completed_at,t.version,t.has_source_link,
   case when t.record_title is not null then t.source else null end as source,
   case when t.record_title is not null then t.kind else null end as kind,
   case when t.record_title is not null then t.external_id else null end as external_id,t.record_title
  from tasks t where search='' or position(lower(search) in lower(t.title||' '||coalesce(t.record_title,'')))>0
 ), filtered as (
  select v.* from visible v where
   (case view_name when 'contacts' then v.source='attio' and v.kind='lead' when 'leads' then v.source='attio' and v.kind='lead' and nullif(v.payload->>'lead_status','') is not null when 'companies' then v.source='attio' and v.kind='company' when 'opportunities' then v.source='attio' and v.kind='deal' when 'pipeline' then v.source='attio' and v.kind='deal' when 'campaigns' then v.source='lemlist' and v.kind='campaign_report' when 'outreach' then v.source='lemlist' and v.kind='outreach' when 'calls' then v.source='justcall' and v.kind='call' else false end)
   and (search='' or position(lower(search) in lower(v.payload::text))>0)
 ), record_page as (select * from filtered order by coalesce(payload->>'occurred_at',synced_at::text) desc,source,kind,external_id limit page_size offset page_offset),
 task_page as (select * from matched_tasks order by case when status in ('Done','Canceled') then 1 else 0 end,due_date nulls last,number limit page_size offset page_offset),
 pipeline as (
  select coalesce(nullif(payload->>'currency',''),'Unavailable') as currency,coalesce(nullif(payload->>'stage',''),'Unavailable') as stage,nullif(payload->>'stage_category','') as category,count(*) as deals,
   sum((payload->>'amount')::numeric) filter(where jsonb_typeof(payload->'amount')='number' and payload->>'currency'~'^[A-Z]{3}$') as known_amount,
   count(*) filter(where jsonb_typeof(payload->'amount') is distinct from 'number' or coalesce(payload->>'currency','')!~'^[A-Z]{3}$') as missing_value
  from visible where source='attio' and kind='deal' group by 1,2,3
 ), deals as materialized (
  select member_id,payload->>'currency' as currency,payload->>'stage_category' as category,payload->>'projected_close_on' as projected_close_on,payload->>'closed_on' as closed_on,
   case when jsonb_typeof(payload->'amount')='number' then (payload->>'amount')::numeric end as amount,
   case when jsonb_typeof(payload->'probability')='number' and (payload->>'probability')::numeric between 0 and 1 then (payload->>'probability')::numeric end as probability
  from visible where source='attio' and kind='deal'
 ), forecast as (
  select currency,count(*) as deals,sum(amount) as known_amount,count(*) filter(where amount is null) as missing_value,count(*) filter(where probability is null) as missing_probability,
   case when count(*) filter(where amount is null or probability is null)=0 then sum(amount*probability) end as weighted_amount
  from deals where category='open' and currency~'^[A-Z]{3}$' and left(projected_close_on,7)=month group by currency
 ), target_progress as (
  select t.id,t.owner_id,t.period,t.currency,t.amount,t.note,t.version,
   (select count(*) from deals d where d.member_id=t.owner_id and d.category='won' and (d.closed_on is null or (left(d.closed_on,7)=month and (d.amount is null or d.currency is null or d.currency!~'^[A-Z]{3}$')))) as missing_won_data,
   (select sum(d.amount) from deals d where d.member_id=t.owner_id and d.category='won' and d.currency=t.currency and left(d.closed_on,7)=month) as known_won_value
  from public.nam_sales_revenue_targets t where t.workspace_id=w and t.period=month and (founder or t.owner_id=actor) and (selected_owner='' or t.owner_id::text=selected_owner)
 ), member_ids as (
  select member_id as owner_id from visible where member_id is not null union select owner_id from tasks
  union select a.owner_id from public.nam_sales_activities a where a.workspace_id=w and a.deleted_at is null and (founder or a.owner_id=actor) and (selected_owner='' or a.owner_id::text=selected_owner) and to_char(a.occurred_on,'YYYY-MM')=month
 ), performance as (
  select id.owner_id,
   (select count(*) from visible v where v.member_id=id.owner_id and v.source='attio' and v.kind='lead') as crm_contacts,
   (select count(*) from visible v where v.member_id=id.owner_id and v.source='attio' and v.kind='deal') as opportunities,
   (select count(*) from visible v where v.member_id=id.owner_id and v.source='lemlist' and v.kind='outreach') as outreach_events,
   (select count(*) from visible v where v.member_id=id.owner_id and v.source='lemlist' and v.kind='outreach' and v.payload->>'activity_type' in ('emailsReplied','linkedinReplied','linkedinVoiceNoteReplied','smsReplied','whatsappReplied','whatsappVoiceNoteReplied')) as reply_events,
   (select count(*) from visible v where v.member_id=id.owner_id and v.source='justcall' and v.kind='call') as calls,
   (select count(*) from tasks t where t.owner_id=id.owner_id and t.status not in ('Done','Canceled')) as open_followups,
   (select count(*) from tasks t where t.owner_id=id.owner_id and t.status not in ('Done','Canceled') and t.due_date<current_date) as overdue_followups,
   (select count(*) from public.nam_sales_activities a where a.workspace_id=w and a.owner_id=id.owner_id and a.deleted_at is null and to_char(a.occurred_on,'YYYY-MM')=month) as manual_activities
  from member_ids id
 )
 select jsonb_build_object(
  'view',view_name,'period',month,'limit',page_size,'offset',page_offset,
  'records_total',case when view_name='followups' then (select count(*) from matched_tasks) else (select count(*) from filtered) end,
  'records',case when view_name='followups' then coalesce((select jsonb_agg(to_jsonb(t)) from task_page t),'[]'::jsonb) else coalesce((select jsonb_agg(r.payload||jsonb_build_object('source',r.source,'kind',r.kind,'external_id',r.external_id,'owner_member_id',r.member_id,'last_synced_at',r.synced_at,
   'companies',coalesce((select jsonb_agg(jsonb_build_object('external_id',c.external_id,'title',c.payload->>'title')) from visible c where c.source='attio' and c.kind='company' and r.payload->'company_ids' @> jsonb_build_array(c.external_id)),'[]'::jsonb),
   'people',coalesce((select jsonb_agg(jsonb_build_object('external_id',p.external_id,'title',p.payload->>'title')) from visible p where p.source='attio' and p.kind='lead' and r.payload->'people_ids' @> jsonb_build_array(p.external_id)),'[]'::jsonb),
   'followups',coalesce((select jsonb_agg(to_jsonb(f)) from (select t.id,t.number,t.title,t.status,t.due_date,t.owner_id,t.version from tasks t where t.source=r.source and t.kind=r.kind and t.external_id=r.external_id and t.record_title is not null order by case when t.status in ('Done','Canceled') then 1 else 0 end,t.due_date nulls last,t.number limit 5) f),'[]'::jsonb),
   'followups_total',(select count(*) from tasks t where t.source=r.source and t.kind=r.kind and t.external_id=r.external_id and t.record_title is not null)
  )) from record_page r),'[]'::jsonb) end,
  'counts',coalesce((select jsonb_agg(to_jsonb(c)) from (select source,kind,count(*) as n from visible group by source,kind) c),'[]'::jsonb),
  'pipeline',coalesce((select jsonb_agg(to_jsonb(p) order by p.currency,p.stage) from pipeline p),'[]'::jsonb),
  'forecast',coalesce((select jsonb_agg(to_jsonb(f) order by f.currency) from forecast f),'[]'::jsonb),
  'forecast_limits',jsonb_build_object('undated_open_deals',(select count(*) from deals where category='open' and projected_close_on is null),'unclassified_deals',(select count(*) from deals where category is null),'won_without_close_date',(select count(*) from deals where category='won' and closed_on is null),'unknown_currency_deals',(select count(*) from deals where currency is null or currency!~'^[A-Z]{3}$')),
  'conversion',jsonb_build_object('won',(select count(*) from deals where category='won'),'lost',(select count(*) from deals where category='lost'),'unclassified',(select count(*) from deals where category is null),'definition','Current snapshot won / (won + lost), using explicitly configured Attio stages. This is not a historic funnel conversion rate.'),
  'targets',coalesce((select jsonb_agg(to_jsonb(t)) from target_progress t),'[]'::jsonb),
  'performance',coalesce((select jsonb_agg(to_jsonb(p)) from performance p),'[]'::jsonb),
  'followup_summary',jsonb_build_object('open',(select count(*) from tasks where status not in ('Done','Canceled')),'overdue',(select count(*) from tasks where status not in ('Done','Canceled') and due_date<current_date),'linked',(select count(*) from tasks where record_title is not null))
 ) into result;
 return result;
end $$;

revoke all on public.nam_sales_followup_links,public.nam_sales_followup_requests,public.nam_sales_revenue_targets,public.nam_sales_revenue_target_events from public,anon,authenticated;
grant select(task_id,workspace_id,source,kind,external_id,created_by,created_at,updated_at) on public.nam_sales_followup_links to authenticated;
grant select on public.nam_sales_revenue_targets,public.nam_sales_revenue_target_events to authenticated;
revoke all on function public.nam_sales_followup_visible(uuid,uuid,text,text,text,text),public.nam_link_sales_followup(uuid,uuid,text,text,text,integer,text),public.nam_unlink_sales_followup(uuid,uuid,integer),public.nam_create_sales_followup(uuid,text,text,text,jsonb,text,text),public.nam_set_sales_revenue_target(uuid,jsonb),public.nam_sales_workspace_data(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.nam_sales_followup_visible(uuid,uuid,text,text,text,text),public.nam_link_sales_followup(uuid,uuid,text,text,text,integer,text),public.nam_unlink_sales_followup(uuid,uuid,integer),public.nam_create_sales_followup(uuid,text,text,text,jsonb,text,text),public.nam_set_sales_revenue_target(uuid,jsonb),public.nam_sales_workspace_data(uuid,jsonb,jsonb) to authenticated;
commit;
