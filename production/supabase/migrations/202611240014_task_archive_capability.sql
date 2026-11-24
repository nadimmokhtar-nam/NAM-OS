-- No delegated archive capability exists yet. Keep the action matrix closed
-- to non-founders, including creators and assigned freelancers. The row trigger
-- preserves all current/future task RPC validation rather than copying it.
begin;
create function public.nam_guard_task_archive() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not public.nam_founder(new.workspace_id) then
  raise exception 'Founder access and two-factor authentication are required to archive or restore tasks' using errcode='42501';
 end if;
 return new;
end $$;
create trigger nam_task_archive_capability before update of archived on public.nam_tasks
for each row when (old.archived is distinct from new.archived)
execute function public.nam_guard_task_archive();
revoke all on function public.nam_guard_task_archive() from public,anon,authenticated,service_role;
commit;
