-- Founder target corrections are optimistic, tenant-bound and audited.
begin;
alter table public.nam_sales_targets add column version integer not null default 1 check(version>0);
alter table public.nam_sales_events add column details jsonb not null default '{}' check(jsonb_typeof(details)='object');

create or replace function public.nam_set_sales_target(w uuid,payload jsonb) returns public.nam_sales_targets
language plpgsql security definer set search_path='' as $$
declare result public.nam_sales_targets; old public.nam_sales_targets; target_owner uuid; next_target integer; expected integer;
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501'; end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) as f(key) where f.key not in ('owner_id','metric','period','target','expectedVersion')) then raise exception 'Invalid target fields'; end if;
 target_owner:=(payload->>'owner_id')::uuid;
 if not exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=target_owner and m.active and m.role in ('sales','sales_manager','founder')) then raise exception 'Target owner unavailable'; end if;
 if jsonb_typeof(payload->'target') is distinct from 'number' or coalesce(payload->>'target','')!~'^[0-9]{1,6}$' then raise exception 'Target must be a positive whole number'; end if;
 next_target:=(payload->>'target')::integer;
 if next_target not between 1 and 100000 then raise exception 'Target must be a positive whole number'; end if;
 if coalesce(payload->>'metric','') not in ('Meetings held','Outreach','Proposal','Reply','Research') or coalesce(payload->>'period','')!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid target metric or period'; end if;
 if payload?'expectedVersion' then
  if jsonb_typeof(payload->'expectedVersion') is distinct from 'number' or coalesce(payload->>'expectedVersion','')!~'^[0-9]{1,10}$' then raise exception 'Invalid target revision'; end if;
  if (payload->>'expectedVersion')::numeric not between 1 and 2147483647 then raise exception 'Invalid target revision'; end if;
  expected:=(payload->>'expectedVersion')::integer;
 end if;
 select * into old from public.nam_sales_targets t where t.workspace_id=w and t.owner_id=target_owner and t.metric=payload->>'metric' and t.period=payload->>'period' for update;
 if found then
  if expected is distinct from old.version then raise exception 'Target changed elsewhere' using errcode='40001'; end if;
  if next_target=old.target then return old; end if;
  update public.nam_sales_targets t set target=next_target,version=old.version+1,updated_at=now() where t.id=old.id returning * into result;
 else
  if expected is not null then raise exception 'Target changed elsewhere' using errcode='40001'; end if;
  insert into public.nam_sales_targets(workspace_id,owner_id,metric,period,target,created_by)
  values(w,target_owner,payload->>'metric',payload->>'period',next_target,auth.uid())
  on conflict(workspace_id,owner_id,metric,period) do nothing returning * into result;
  if not found then raise exception 'Target changed elsewhere' using errcode='40001'; end if;
 end if;
 insert into public.nam_sales_events(workspace_id,owner_id,actor_id,record_id,kind,details)
 values(w,target_owner,auth.uid(),result.id,'target_updated',jsonb_build_object('before',old.target,'after',result.target,'version',result.version,'metric',result.metric,'period',result.period));
 return result;
end $$;
revoke all on function public.nam_set_sales_target(uuid,jsonb) from public,anon;
grant execute on function public.nam_set_sales_target(uuid,jsonb) to authenticated;
commit;
