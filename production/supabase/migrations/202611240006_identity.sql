begin;
create table public.nam_invitations(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.nam_workspaces(id),
 user_id uuid not null references auth.users(id),email text not null check(length(email) between 3 and 254),name text not null check(length(trim(name)) between 1 and 100),
 role text not null check(role in ('sales_manager','sales','production_manager','artist','freelancer')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),expires_at timestamptz not null,
 accepted_at timestamptz,revoked_at timestamptz,foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id));
create unique index nam_invitation_pending on public.nam_invitations(workspace_id,lower(email)) where accepted_at is null and revoked_at is null;
create table public.nam_identity_events(id bigint generated always as identity primary key,workspace_id uuid not null references public.nam_workspaces(id),actor_id uuid references auth.users(id),target_id uuid references auth.users(id),kind text not null,created_at timestamptz not null default now());
-- Short-lived password setup proofs are hashed and consumed atomically. A
-- browser deleting its cookie alone is not evidence of one-use server state.
create table public.nam_password_setups(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),reason text not null check(reason in ('invite','recovery')),created_at timestamptz not null default now(),expires_at timestamptz not null,used_at timestamptz);
alter table public.nam_password_setups enable row level security;
revoke all on public.nam_password_setups from anon,authenticated;
grant select,insert,update,delete on public.nam_password_setups to service_role;
alter table public.nam_invitations enable row level security;
alter table public.nam_identity_events enable row level security;
create policy invitation_read on public.nam_invitations for select to authenticated using(public.nam_founder(workspace_id));
create policy identity_events_read on public.nam_identity_events for select to authenticated using(public.nam_founder(workspace_id));
revoke all on public.nam_invitations,public.nam_identity_events from anon,authenticated;
grant select on public.nam_invitations,public.nam_identity_events to authenticated;

-- User-scoped RPC checks the real caller's AAL2 claims. Provider user creation
-- happens separately server-side; an orphan identity has no active membership.
create function public.nam_issue_invite(w uuid,target_user uuid,invite_id uuid,invite_email text,invite_name text,invite_role text)
returns public.nam_invitations language plpgsql security definer set search_path='' as $$
declare result public.nam_invitations; previous public.nam_memberships;
begin
 if not public.nam_founder(w) then raise exception 'Verified founder required' using errcode='42501'; end if;
 if invite_role not in ('sales_manager','sales','production_manager','artist','freelancer') or length(trim(invite_name)) not between 1 and 100 or length(invite_email) not between 3 and 254 then raise exception 'Invalid invitation'; end if;
 -- A trusted provider identity must match the requested email, rather than an
 -- arbitrary UUID supplied by the browser.
 if not exists(select 1 from auth.users u where u.id=target_user and lower(u.email)=lower(trim(invite_email))) then raise exception 'Identity mismatch' using errcode='42501'; end if;
 select * into previous from public.nam_memberships where workspace_id=w and user_id=target_user for update;
 if found and previous.active then raise exception 'Member already active' using errcode='23505'; end if;
 if previous.role='founder' then raise exception 'Founder invitation not permitted' using errcode='42501'; end if;
 update public.nam_invitations set revoked_at=now() where workspace_id=w and lower(email)=lower(trim(invite_email)) and accepted_at is null and revoked_at is null;
 insert into public.nam_memberships(workspace_id,user_id,name,role,active) values(w,target_user,trim(invite_name),invite_role,false)
 on conflict(workspace_id,user_id) do update set name=excluded.name,role=excluded.role,active=false;
 insert into public.nam_invitations(id,workspace_id,user_id,email,name,role,created_by,expires_at)
 values(invite_id,w,target_user,lower(trim(invite_email)),trim(invite_name),invite_role,auth.uid(),now()+interval '1 hour') returning * into result;
 insert into public.nam_identity_events(workspace_id,actor_id,target_id,kind) values(w,auth.uid(),target_user,'invitation_issued');return result;
end $$;

-- Only the server's service client can accept. It first verifies the provider
-- OTP and getUser, then supplies that verified user ID; neither browser role nor
-- editable auth metadata participates in access assignment.
create function public.nam_accept_invite(invite_id uuid,verified_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.nam_invitations;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service verification required' using errcode='42501'; end if;
 select * into invitation from public.nam_invitations where id=invite_id for update;
 if not found or invitation.user_id<>verified_user or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Invitation invalid or expired' using errcode='42501'; end if;
 if invitation.accepted_at is not null then raise exception 'Invitation already accepted' using errcode='42501'; end if;
 update public.nam_memberships set active=true where workspace_id=invitation.workspace_id and user_id=verified_user and role=invitation.role and not active;
 if not found then raise exception 'Pending membership unavailable' using errcode='42501'; end if;
 update public.nam_invitations set accepted_at=now() where id=invite_id;
 insert into public.nam_identity_events(workspace_id,actor_id,target_id,kind) values(invitation.workspace_id,verified_user,verified_user,'invitation_accepted');return invitation.workspace_id;
end $$;
create function public.nam_revoke_invite(w uuid,invite_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare invitation public.nam_invitations;
begin
 if not public.nam_founder(w) then raise exception 'Verified founder required' using errcode='42501'; end if;
 select * into invitation from public.nam_invitations where id=invite_id and workspace_id=w for update;
 if not found or invitation.accepted_at is not null or invitation.revoked_at is not null then raise exception 'Pending invitation not found' using errcode='42501'; end if;
 update public.nam_invitations set revoked_at=now() where id=invite_id;
 update public.nam_memberships set active=false where workspace_id=w and user_id=invitation.user_id and role<>'founder';
 insert into public.nam_identity_events(workspace_id,actor_id,target_id,kind) values(w,auth.uid(),invitation.user_id,'invitation_revoked');return true;
end $$;
create function public.nam_set_member_active(w uuid,target_user uuid,make_active boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.nam_founder(w) or target_user=auth.uid() then raise exception 'Verified founder required' using errcode='42501'; end if;
 -- Unaccepted invitations must use the verified acceptance flow, never Restore.
 if make_active and exists(select 1 from public.nam_invitations where workspace_id=w and user_id=target_user and accepted_at is null) and not exists(select 1 from public.nam_invitations where workspace_id=w and user_id=target_user and accepted_at is not null) then raise exception 'Invitation has not been accepted' using errcode='42501'; end if;
 update public.nam_memberships set active=make_active where workspace_id=w and user_id=target_user and role<>'founder';
 if not found then raise exception 'Member not found' using errcode='42501'; end if;
 if not make_active then update public.nam_invitations set revoked_at=now() where workspace_id=w and user_id=target_user and accepted_at is null and revoked_at is null;end if;
 insert into public.nam_identity_events(workspace_id,actor_id,target_id,kind) values(w,auth.uid(),target_user,case when make_active then 'membership_restored' else 'membership_suspended' end);return true;
end $$;
revoke all on function public.nam_issue_invite(uuid,uuid,uuid,text,text,text),public.nam_revoke_invite(uuid,uuid),public.nam_set_member_active(uuid,uuid,boolean),public.nam_accept_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function public.nam_issue_invite(uuid,uuid,uuid,text,text,text),public.nam_revoke_invite(uuid,uuid),public.nam_set_member_active(uuid,uuid,boolean) to authenticated;
grant execute on function public.nam_accept_invite(uuid,uuid) to service_role;
commit;
