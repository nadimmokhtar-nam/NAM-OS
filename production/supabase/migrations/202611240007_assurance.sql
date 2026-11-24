-- Match database access to the API's optional-MFA policy: every enrolled
-- identity must use AAL2, including non-founders accessing PostgREST directly.
begin;
-- Supabase documents session_id -> auth.sessions as the immediate post-signout
-- revocation check. A JWT may remain cryptographically valid after logout.
-- Managed auth tables stay private; authenticated users execute only this
-- narrowly scoped wrapper, never SELECT the sessions table themselves.
create function public.nam_session_valid() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.user_id=(select auth.uid())
  and s.id=case when (select auth.jwt()->>'session_id')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (select auth.jwt()->>'session_id')::uuid else null end
  and (s.not_after is null or s.not_after>now()) and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))
$$;
create or replace function public.nam_role(w uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.nam_memberships m where m.workspace_id=w and m.user_id=(select auth.uid()) and m.active and public.nam_session_valid()
$$;
create function public.nam_assured() returns boolean language sql stable security definer set search_path='' as $$
 select public.nam_session_valid() and (
  coalesce((select auth.jwt()->>'aal')='aal2',false) or
  not exists(select 1 from auth.mfa_factors f where f.user_id=(select auth.uid()) and f.status='verified'))
$$;
create or replace function public.nam_founder(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.nam_role(w)='founder' and public.nam_assured() and (select auth.jwt()->>'aal')='aal2',false)
$$;
create or replace function public.nam_section(w uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select public.nam_assured() and coalesce(case public.nam_role(w)
 when 'founder' then s in ('sales','academy','projects','library','team','operations') and (select auth.jwt()->>'aal')='aal2'
 when 'sales_manager' then s in ('sales','academy','operations')
 when 'sales' then s in ('sales','academy','operations')
 when 'production_manager' then s in ('projects','academy','library','operations')
 when 'artist' then s in ('projects','academy','library','operations')
 when 'freelancer' then s in ('projects','academy','library','operations') else false end,false)
$$;
drop policy workspaces_read on public.nam_workspaces;
create policy workspaces_read on public.nam_workspaces for select to authenticated using(public.nam_assured() and public.nam_role(id) is not null);
-- Own active membership remains readable at AAL1 to identify the account and
-- require enrollment/verification; it does not grant access to business rows.
drop policy membership_read on public.nam_memberships;
create policy membership_read on public.nam_memberships for select to authenticated using(active and public.nam_session_valid() and (user_id=(select auth.uid()) or public.nam_founder(workspace_id)));
revoke all on function public.nam_session_valid() from public,anon;
grant execute on function public.nam_session_valid() to authenticated;
revoke all on function public.nam_assured() from public,anon;
grant execute on function public.nam_assured() to authenticated;
commit;
