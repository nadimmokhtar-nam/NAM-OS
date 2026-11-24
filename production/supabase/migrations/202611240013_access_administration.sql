-- Basic P0 access administration. Assigned-only grants do not implement
-- managed teams, collaborators, restricted-task sharing or delegated Academy.
begin;
alter table public.nam_memberships add column access_revision integer not null default 1 check(access_revision>0);
create function public.nam_template_sections(member_role text) returns text[] language sql immutable set search_path='' as $$
 select case when member_role='founder' then array['sales','academy','projects','library','team','operations']::text[]
 when member_role in ('sales','sales_manager') then array['sales','academy','operations']::text[]
 when member_role in ('production_manager','artist','freelancer') then array['projects','academy','library','operations']::text[]
 else array[]::text[] end $$;
create table public.nam_section_grants(
 workspace_id uuid not null,user_id uuid not null,section text not null check(section in ('sales','academy','projects','library','team','operations')),
 scope text not null default 'assigned_only' check(scope='assigned_only'),can_create boolean not null default false,
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),
 primary key(workspace_id,user_id,section),foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id) on delete cascade);
create table public.nam_access_events(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.nam_workspaces(id),
 actor_id uuid not null references auth.users(id),target_id uuid not null references auth.users(id),
 kind text not null check(kind in ('access_updated','invitation_access')),old_role text,new_role text not null,
 old_grants jsonb not null,new_grants jsonb not null,revision integer not null,created_at timestamptz not null default now());
alter table public.nam_section_grants enable row level security;
alter table public.nam_access_events enable row level security;
create policy section_grants_read on public.nam_section_grants for select to authenticated using(public.nam_assured() and public.nam_role(workspace_id) is not null and (user_id=(select auth.uid()) or public.nam_founder(workspace_id)));
create policy access_events_read on public.nam_access_events for select to authenticated using(public.nam_founder(workspace_id));
revoke all on public.nam_section_grants,public.nam_access_events from anon,authenticated;
grant select on public.nam_section_grants,public.nam_access_events to authenticated;

-- One-time compatibility backfill: preserve the pre-migration assigned-only
-- access of existing memberships. Subsequent direct inserts get no grants.
insert into public.nam_section_grants(workspace_id,user_id,section,can_create)
 select m.workspace_id,m.user_id,s.section,true from public.nam_memberships m
 cross join lateral unnest(public.nam_template_sections(m.role)) s(section) where m.role<>'founder';

-- Owner eligibility intentionally checks membership/grants, not whether the
-- assignee currently has a browser session. Only trusted helpers can call it.
create function public.nam_member_section(w uuid,member_id uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=member_id and m.active
 and s=any(public.nam_template_sections(m.role)) and (m.role='founder' or exists(select 1 from public.nam_section_grants g where g.workspace_id=w and g.user_id=member_id and g.section=s))) $$;
create or replace function public.nam_section(w uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select public.nam_assured() and public.nam_role(w) is not null and public.nam_member_section(w,(select auth.uid()),s)
 and (public.nam_role(w)<>'founder' or (select auth.jwt()->>'aal')='aal2') $$;
create function public.nam_can_create_task(w uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select public.nam_section(w,s) and (public.nam_founder(w) or exists(select 1 from public.nam_section_grants g where g.workspace_id=w and g.user_id=(select auth.uid()) and g.section=s and g.can_create)) $$;

-- Keep migration 011's set-based task policy consistent with the same grants.
create or replace function public.nam_task_read_scopes() returns table(workspace_id uuid,section text,all_tasks boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.nam_assured() then return;end if;
 return query select m.workspace_id,s.section,m.role='founder' from public.nam_memberships m
 cross join lateral unnest(public.nam_template_sections(m.role)) s(section)
 where m.user_id=(select auth.uid()) and m.active and (m.role<>'founder' or (select auth.jwt()->>'aal')='aal2')
 and (m.role='founder' or exists(select 1 from public.nam_section_grants g where g.workspace_id=m.workspace_id and g.user_id=m.user_id and g.section=s.section));
end $$;

create function public.nam_effective_access(w uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sections',coalesce((select jsonb_agg(s.section order by s.ordinality) from unnest(public.nam_template_sections(public.nam_role(w))) with ordinality s(section,ordinality) where public.nam_section(w,s.section)),'[]'::jsonb),
 'create_sections',coalesce((select jsonb_agg(s.section order by s.ordinality) from unnest(public.nam_template_sections(public.nam_role(w))) with ordinality s(section,ordinality) where public.nam_can_create_task(w,s.section)),'[]'::jsonb),
 'revision',(select m.access_revision from public.nam_memberships m where m.workspace_id=w and m.user_id=(select auth.uid()) and m.active),
 'member_sections',coalesce((select jsonb_object_agg(m.user_id::text,coalesce((select jsonb_agg(s.section order by s.ordinality) from unnest(public.nam_template_sections(m.role)) with ordinality s(section,ordinality) where public.nam_member_section(w,m.user_id,s.section)),'[]'::jsonb)) from public.nam_memberships m where m.workspace_id=w and m.active and public.nam_assured() and public.nam_role(w) is not null and (m.user_id=(select auth.uid()) or public.nam_founder(w))),'{}'::jsonb)) $$;
create function public.nam_access_member(w uuid,target_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.nam_memberships;result jsonb;
begin
 if not public.nam_founder(w) then raise exception 'Verified founder required' using errcode='42501';end if;
 select * into member from public.nam_memberships m where m.workspace_id=w and m.user_id=target_user;
 if not found then raise exception 'Member not found' using errcode='P0002';end if;
 select jsonb_build_object('id',member.user_id,'name',member.name,'role',member.role,'active',member.active,'revision',member.access_revision,
 'editable',member.role<>'founder' and member.user_id<>auth.uid(), 'eligible_sections',to_jsonb(public.nam_template_sections(member.role)),
 'grants',coalesce((select jsonb_agg(jsonb_build_object('section',g.section,'scope',g.scope,'can_create',g.can_create) order by g.section) from public.nam_section_grants g where g.workspace_id=w and g.user_id=target_user),'[]'::jsonb)) into result;
 return result;
end $$;
create function public.nam_save_member_access(w uuid,target_user uuid,expected_revision integer,next_role text,section_grants jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare member public.nam_memberships;old_grants jsonb;next_grants jsonb;entry jsonb;next_revision integer;
begin
 if not public.nam_founder(w) then raise exception 'Verified founder required' using errcode='42501';end if;
 if target_user=auth.uid() then raise exception 'Self access changes are not allowed' using errcode='42501';end if;
 select * into member from public.nam_memberships m where m.workspace_id=w and m.user_id=target_user for update;
 if not found then raise exception 'Member not found' using errcode='P0002';end if;
 -- A lock wait must not carry founder authority past a completed revocation.
 if not public.nam_founder(w) then raise exception 'Verified founder required' using errcode='42501';end if;
 -- A stronger founder/last-founder lockout guard: this UI cannot promote,
 -- demote or alter any founder. Operator-controlled transfer stays separate.
 if member.role='founder' or next_role='founder' then raise exception 'Founder access is protected' using errcode='42501';end if;
 if next_role not in ('sales_manager','sales','production_manager','artist','freelancer') or next_role is null then raise exception 'Choose a fixed role template' using errcode='22023';end if;
 if expected_revision is distinct from member.access_revision then raise exception 'Access changed elsewhere. Reload before saving' using errcode='40001';end if;
 if exists(select 1 from public.nam_invitations i where i.workspace_id=w and i.user_id=target_user and i.accepted_at is null and i.revoked_at is null) then raise exception 'Accept the invitation before editing access' using errcode='42501';end if;
 if jsonb_typeof(section_grants) is distinct from 'array' or jsonb_array_length(section_grants)>6 then raise exception 'Invalid section grants' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(section_grants) loop
  if jsonb_typeof(entry) is distinct from 'object' then raise exception 'Invalid grant' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(entry) f(key) where f.key not in ('section','can_create')) or jsonb_typeof(entry->'section') is distinct from 'string' or jsonb_typeof(entry->'can_create') is distinct from 'boolean' or not ((entry->>'section')=any(public.nam_template_sections(next_role))) then raise exception 'Grant exceeds the role template' using errcode='22023';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(section_grants))<>(select count(distinct value->>'section') from jsonb_array_elements(section_grants)) then raise exception 'Duplicate section grant' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('section',g.section,'can_create',g.can_create) order by g.section),'[]'::jsonb) into old_grants from public.nam_section_grants g where g.workspace_id=w and g.user_id=target_user;
 select coalesce(jsonb_agg(jsonb_build_object('section',x.value->>'section','can_create',(x.value->>'can_create')::boolean) order by x.value->>'section'),'[]'::jsonb) into next_grants from jsonb_array_elements(section_grants) x(value);
 if member.role=next_role and old_grants=next_grants then return public.nam_access_member(w,target_user);end if;
 delete from public.nam_section_grants where workspace_id=w and user_id=target_user;
 insert into public.nam_section_grants(workspace_id,user_id,section,can_create,updated_by)
 select w,target_user,x.value->>'section',(x.value->>'can_create')::boolean,auth.uid() from jsonb_array_elements(next_grants) x(value);
 next_revision:=member.access_revision+1;
 update public.nam_memberships set role=next_role,access_revision=next_revision where workspace_id=w and user_id=target_user;
 insert into public.nam_access_events(workspace_id,actor_id,target_id,kind,old_role,new_role,old_grants,new_grants,revision)
 values(w,auth.uid(),target_user,'access_updated',member.role,next_role,old_grants,next_grants,next_revision);
 return public.nam_access_member(w,target_user);
end $$;

-- Status/name/role changes through existing trusted flows invalidate stale
-- access forms too. Changing grants never changes a provider JWT's role.
create function public.nam_membership_access_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if new.role is distinct from old.role or new.active is distinct from old.active or new.name is distinct from old.name then new.access_revision:=greatest(old.access_revision+1,new.access_revision);end if;
 return new;
end $$;
create trigger membership_access_revision before update on public.nam_memberships for each row execute function public.nam_membership_access_revision();

-- Preserve the original verified invitation path; its private implementation
-- cannot be called to bypass the explicit initial-grant transaction.
alter function public.nam_issue_invite(uuid,uuid,uuid,text,text,text) rename to nam_issue_invite_identity_only;
revoke all on function public.nam_issue_invite_identity_only(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.nam_issue_invite(w uuid,target_user uuid,invite_id uuid,invite_email text,invite_name text,invite_role text) returns public.nam_invitations
language plpgsql security definer set search_path='' as $$
declare invitation public.nam_invitations;previous public.nam_memberships;old_grants jsonb;new_grants jsonb;revision integer;
begin
 if not public.nam_founder(w) then raise exception 'Verified founder required' using errcode='42501';end if;
 select * into previous from public.nam_memberships m where m.workspace_id=w and m.user_id=target_user for update;
 select coalesce(jsonb_agg(jsonb_build_object('section',g.section,'can_create',g.can_create) order by g.section),'[]'::jsonb) into old_grants from public.nam_section_grants g where g.workspace_id=w and g.user_id=target_user;
 invitation:=public.nam_issue_invite_identity_only(w,target_user,invite_id,invite_email,invite_name,invite_role);
 if previous.user_id is null then
  insert into public.nam_section_grants(workspace_id,user_id,section,can_create,updated_by) select w,target_user,s.section,true,auth.uid() from unnest(public.nam_template_sections(invite_role)) s(section);
 else
  -- Reinvitation and a role change never resurrect revoked/new sections.
  delete from public.nam_section_grants where workspace_id=w and user_id=target_user and not (section=any(public.nam_template_sections(invite_role)));
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('section',g.section,'can_create',g.can_create) order by g.section),'[]'::jsonb) into new_grants from public.nam_section_grants g where g.workspace_id=w and g.user_id=target_user;
 select m.access_revision into revision from public.nam_memberships m where m.workspace_id=w and m.user_id=target_user;
 insert into public.nam_access_events(workspace_id,actor_id,target_id,kind,old_role,new_role,old_grants,new_grants,revision) values(w,auth.uid(),target_user,'invitation_access',previous.role,invite_role,old_grants,new_grants,revision);
 return invitation;
end $$;

-- Existing task mutations retain their validation/audit semantics; add the
-- create capability and validate assignee access against actual section grants.
create or replace function public.nam_save_task(w uuid,task_id uuid,expected_version integer,changes jsonb) returns public.nam_tasks
language plpgsql security definer set search_path='' as $$
declare old public.nam_tasks; result public.nam_tasks; next_owner uuid; next_section text; next_status text; founder boolean;
begin
 if auth.uid() is null or jsonb_typeof(changes) is distinct from 'object' then raise exception 'Access denied' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(changes) as fields(key) where fields.key not in ('title','description','section','owner_id','status','priority','due_date','archived','confirmOpenSubtasks')) then raise exception 'Unsupported field' using errcode='22023'; end if;
 if changes?'title' and (jsonb_typeof(changes->'title')<>'string' or length(trim(changes->>'title')) not between 1 and 200) then raise exception 'Invalid task name' using errcode='22023'; end if;
 if changes?'description' and (jsonb_typeof(changes->'description')<>'string' or length(changes->>'description')>10000) then raise exception 'Invalid description' using errcode='22023'; end if;
 if changes?'archived' and jsonb_typeof(changes->'archived')<>'boolean' then raise exception 'Invalid archive value' using errcode='22023'; end if;
 founder:=public.nam_founder(w);
 if task_id is not null then
  select * into old from public.nam_tasks t where t.id=task_id and t.workspace_id=w and t.deleted_at is null for update;
  if not found or not public.nam_task_access(task_id) then raise exception 'Task not found' using errcode='P0002'; end if;
  if expected_version is distinct from old.version then raise exception 'Task changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 end if;
 next_owner:=coalesce((changes->>'owner_id')::uuid,old.owner_id,auth.uid());next_section:=coalesce(changes->>'section',old.section);next_status:=coalesce(changes->>'status',old.status,'Todo');
 if not public.nam_section(w,next_section) then raise exception 'Section denied' using errcode='42501';end if;
 if old.id is null and not public.nam_can_create_task(w,next_section) then raise exception 'Task creation is not granted' using errcode='42501';end if;
 if not founder and (next_owner<>auth.uid() or (old.id is not null and next_section<>old.section)) then raise exception 'Assignment denied' using errcode='42501';end if;
 if not public.nam_member_section(w,next_owner,next_section) then raise exception 'Owner ineligible' using errcode='22023';end if;
 if next_status='Done' and old.status is distinct from 'Done' and exists(select 1 from public.nam_task_subtasks s where s.task_id=old.id and not s.completed) and coalesce(changes->'confirmOpenSubtasks','false'::jsonb)<>'true'::jsonb then raise exception 'This task has open subtasks. Complete them or confirm finishing the parent.' using errcode='40001';end if;
 if old.id is null then
  insert into public.nam_tasks(workspace_id,title,description,section,status,priority,due_date,owner_id,created_by,completed_at) values(w,trim(changes->>'title'),coalesce(changes->>'description',''),next_section,next_status,coalesce(changes->>'priority','Normal'),nullif(changes->>'due_date','')::date,next_owner,auth.uid(),case when next_status='Done' then now() end) returning * into result;
 else
  update public.nam_tasks set title=coalesce(trim(changes->>'title'),old.title),description=coalesce(changes->>'description',old.description),section=next_section,owner_id=next_owner,status=next_status,priority=coalesce(changes->>'priority',old.priority),due_date=case when changes?'due_date' then nullif(changes->>'due_date','')::date else old.due_date end,archived=coalesce((changes->>'archived')::boolean,old.archived),version=old.version+1,updated_at=now(),completed_at=case when next_status='Done' then coalesce(old.completed_at,now()) end where id=old.id returning * into result;
 end if;
 insert into public.nam_task_events(task_id,actor_id,kind,body) values(result.id,auth.uid(),case when old.id is null then 'created' else 'updated' end,changes);
 if result.owner_id<>auth.uid() and (old.id is null or old.owner_id<>result.owner_id) then insert into public.nam_notifications(workspace_id,recipient_id,task_id,body,kind,dedupe_key) values(w,result.owner_id,result.id,'Assigned to you: '||result.title,'assignment','assignment:'||result.id||':'||result.version) on conflict do nothing;end if;
 return result;
end $$;

-- Trusted byte verification must also observe a grant revoked while an upload
-- was in flight. Holding the membership row serializes this with access edits.
alter function public.nam_attest_attachment(uuid,uuid,uuid,uuid,boolean) rename to nam_attest_attachment_identity_only;
revoke all on function public.nam_attest_attachment_identity_only(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function public.nam_attest_attachment(w uuid,attachment_id uuid,verified_actor uuid,verified_session uuid,verified_aal2 boolean)
returns public.nam_task_attachments language plpgsql security definer set search_path='' as $$
declare section_name text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted file verification required' using errcode='42501';end if;
 perform 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=verified_actor and m.active for share;
 if not found then raise exception 'Active membership required' using errcode='42501';end if;
 select t.section into section_name from public.nam_task_attachments a join public.nam_tasks t on t.id=a.task_id and t.workspace_id=a.workspace_id where a.id=attachment_id and a.workspace_id=w and t.deleted_at is null for update of t;
 if not found then raise exception 'Attachment not found' using errcode='P0002';end if;
 if not public.nam_member_section(w,verified_actor,section_name) then raise exception 'Upload authorization changed' using errcode='42501';end if;
 return public.nam_attest_attachment_identity_only(w,attachment_id,verified_actor,verified_session,verified_aal2);
end $$;
revoke all on function public.nam_attest_attachment(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.nam_attest_attachment(uuid,uuid,uuid,uuid,boolean) to service_role;

revoke all on function public.nam_template_sections(text),public.nam_member_section(uuid,uuid,text),public.nam_can_create_task(uuid,text),public.nam_effective_access(uuid),public.nam_access_member(uuid,uuid),public.nam_save_member_access(uuid,uuid,integer,text,jsonb),public.nam_membership_access_revision(),public.nam_issue_invite(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.nam_can_create_task(uuid,text),public.nam_effective_access(uuid),public.nam_access_member(uuid,uuid),public.nam_save_member_access(uuid,uuid,integer,text,jsonb),public.nam_issue_invite(uuid,uuid,uuid,text,text,text) to authenticated;
commit;
