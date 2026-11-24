-- INITIAL OWNER BOOTSTRAP: trusted Supabase SQL Editor/operator only.
-- This is not a migration, a public function or a self-signup endpoint.
-- First create/verify the owner's Supabase Auth identity and let the owner set
-- a private password through the provider's secure flow. Then copy this file
-- to a private temporary location and replace the two placeholders below.
-- NEVER commit the personalized copy. No password or service key goes here.
begin;
do $bootstrap$
declare
 owner_user_id uuid := '00000000-0000-0000-0000-000000000000'; -- confirmed Auth UUID
 expected_email text := 'REPLACE_WITH_CONFIRMED_OWNER_EMAIL';
 owner_name text := 'Nadim Mokhtar';
 workspace_name text := 'NAM Studio';
 workspace_id uuid := gen_random_uuid();
 actual_email text; confirmed_at timestamptz; banned_until timestamptz;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Run this initial bootstrap through the trusted database operator' using errcode='42501'; end if;
 if owner_user_id='00000000-0000-0000-0000-000000000000'::uuid or expected_email='REPLACE_WITH_CONFIRMED_OWNER_EMAIL' or length(trim(expected_email)) not between 3 and 254 then raise exception 'Replace the owner UUID/email placeholders in a private copy'; end if;
 if length(trim(owner_name)) not between 1 and 100 or length(trim(workspace_name)) not between 1 and 100 then raise exception 'Invalid owner or workspace name'; end if;
 if exists(select 1 from public.nam_workspaces) or exists(select 1 from public.nam_memberships) then raise exception 'Workspace already provisioned. Do not use initial bootstrap to change memberships'; end if;
 select u.email,u.email_confirmed_at,u.banned_until into actual_email,confirmed_at,banned_until from auth.users u where u.id=owner_user_id;
 if not found or lower(actual_email) is distinct from lower(trim(expected_email)) or confirmed_at is null or (banned_until is not null and banned_until>now()) then raise exception 'Owner Auth UUID must match an existing confirmed, unbanned identity'; end if;
 insert into public.nam_workspaces(id,name) values(workspace_id,trim(workspace_name));
 insert into public.nam_memberships(workspace_id,user_id,name,role,active) values(workspace_id,owner_user_id,trim(owner_name),'founder',true);
 insert into public.nam_identity_events(workspace_id,actor_id,target_id,kind) values(workspace_id,owner_user_id,owner_user_id,'initial_owner_provisioned');
 raise notice 'NAM workspace created: %. Set this UUID as NAM_WORKSPACE_ID. Founder MFA is still required.',workspace_id;
end
$bootstrap$;
commit;
