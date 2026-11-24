-- Close direct-user finalize bypass. Only a trusted server, after downloading
-- and validating actual private object bytes, may attest a reservation. The
-- service credential is never used for ordinary file upload/download queries.
begin;
alter table public.nam_task_attachments add column attested_at timestamptz;
alter table public.nam_task_attachments add column attested_by uuid references auth.users(id);
-- Existing ready files predate trusted byte validation. Quarantine rather than
-- silently grandfathering them; the uploader can retry the same valid file.
update public.nam_task_attachments set status='pending',ready_at=null where status='ready';
revoke all on function public.nam_finish_attachment(uuid,uuid) from public,anon,authenticated,service_role;

create function public.nam_attest_attachment(w uuid,attachment_id uuid,verified_actor uuid,verified_session uuid,verified_aal2 boolean)
returns public.nam_task_attachments language plpgsql security definer set search_path='' as $$
declare a public.nam_task_attachments; task public.nam_tasks; member public.nam_memberships;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted file verification required' using errcode='42501'; end if;
 if verified_actor is null or verified_session is null then raise exception 'Verified identity and session required' using errcode='42501'; end if;
 -- The server supplies getContext's verified identity. An authenticated client
 -- cannot execute this function even by supplying somebody else's UUID or by
 -- passing forged actor/MFA fields in its upload JSON. Founder AAL2 and an
 -- enrolled user's MFA are verified by that trusted server context, not by
 -- editable user metadata or by the service JWT pretending to be a user JWT.
 select * into member from public.nam_memberships m where m.workspace_id=w and m.user_id=verified_actor and m.active for share;
 if not found then raise exception 'Active membership required' using errcode='42501'; end if;
 if (member.role='founder' or exists(select 1 from auth.mfa_factors f where f.user_id=verified_actor and f.status='verified')) and verified_aal2 is distinct from true then raise exception 'Current two-factor verification required' using errcode='42501'; end if;
 perform 1 from auth.users u where u.id=verified_actor and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found then raise exception 'Account unavailable' using errcode='42501'; end if;
 perform 1 from auth.sessions s where s.id=verified_session and s.user_id=verified_actor and (s.not_after is null or s.not_after>now()) for share;
 if not found then raise exception 'The verified upload session has ended' using errcode='42501'; end if;
 select * into a from public.nam_task_attachments x where x.id=attachment_id and x.workspace_id=w;
 if not found then raise exception 'Attachment not found' using errcode='P0002'; end if;
 select * into task from public.nam_tasks t where t.id=a.task_id and t.workspace_id=w and t.deleted_at is null for update;
 if not found then raise exception 'Task not found' using errcode='P0002'; end if;
 select * into a from public.nam_task_attachments x where x.id=attachment_id and x.workspace_id=w for update;
 if a.created_by<>verified_actor or not (member.role='founder' or task.owner_id=verified_actor) or not (
  member.role='founder' or (member.role in ('sales','sales_manager') and task.section in ('sales','academy','operations')) or
  (member.role in ('artist','production_manager','freelancer') and task.section in ('projects','academy','library','operations')))
 then raise exception 'Upload authorization changed' using errcode='42501'; end if;
 if a.status='ready' and a.attested_at is not null and a.attested_by=verified_actor then return a; end if;
 if a.status<>'pending' then raise exception 'Upload cannot be verified' using errcode='40001'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='nam-task-attachments' and o.name=a.storage_path and o.owner_id=verified_actor::text and
  case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint=a.byte_size else false end and o.metadata->>'mimetype'=a.mime)
 then raise exception 'Private upload is incomplete' using errcode='40001'; end if;
 update public.nam_task_attachments set status='ready',ready_at=now(),attested_at=now(),attested_by=verified_actor,cleanup_error=false where id=a.id returning * into a;
 insert into public.nam_task_events(task_id,actor_id,kind,body) values(a.task_id,verified_actor,'attachment',jsonb_build_object('message','Added verified attachment: '||a.name));
 return a;
end $$;
revoke all on function public.nam_attest_attachment(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.nam_attest_attachment(uuid,uuid,uuid,uuid,boolean) to service_role;

create or replace function public.nam_attachment_storage_access(object_path text,operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nam_task_attachments a where a.storage_path=object_path and public.nam_role(a.workspace_id) is not null and case operation
 when 'read' then (a.status='ready' and a.attested_at is not null and public.nam_task_access(a.task_id)) or
   (a.status in ('pending','deleting') and public.nam_task_access(a.task_id) and (a.created_by=(select auth.uid()) or public.nam_founder(a.workspace_id))) or
   (a.status='deleting' and public.nam_founder(a.workspace_id))
 when 'insert' then a.status='pending' and a.created_by=(select auth.uid()) and public.nam_task_access(a.task_id)
 -- Pending objects are immutable too. Cancellation must first atomically move
 -- metadata to deleting, which makes a simultaneous attestation fail. This
 -- prevents replacing bytes after the server's download/validation step.
 when 'delete' then (a.status='deleting' and a.created_by=(select auth.uid()) and public.nam_task_access(a.task_id)) or
   (a.status='deleting' and public.nam_founder(a.workspace_id))
 else false end)
$$;
drop policy attachment_metadata_read on public.nam_task_attachments;
create policy attachment_metadata_read on public.nam_task_attachments for select to authenticated
using(status<>'deleted' and (status<>'ready' or attested_at is not null) and (public.nam_task_access(task_id) or (status='deleting' and public.nam_founder(workspace_id))));
commit;
