-- The Auth service credential does not need table-wide membership SELECT.
-- A caller-scoped, Founder-only directory includes suspended accounts so the
-- existing Restore action remains usable. Ordinary membership RLS is unchanged.
begin;
create function public.nam_member_directory(w uuid)
returns table(user_id uuid,name text,role text,active boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.nam_founder(w) then
  raise exception 'Current Founder access required' using errcode='42501';
 end if;
 return query
 select m.user_id,m.name,m.role,m.active
 from public.nam_memberships m
 where m.workspace_id=w
 order by m.name,m.user_id;
end $$;
revoke all on function public.nam_member_directory(uuid) from public,anon,authenticated,service_role;
grant execute on function public.nam_member_directory(uuid) to authenticated;
commit;
