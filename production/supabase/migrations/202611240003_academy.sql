-- NAM Academy: version-pinned published learning, founder authoring and review.
-- Apply after 001_foundation and 002. No service-role key is used by the API.
begin;

alter table public.nam_courses add column summary text not null default '' check(length(summary)<=3000);
alter table public.nam_courses add column revision integer not null default 1 check(revision>0);
alter table public.nam_courses add column publication_status text not null default 'draft' check(publication_status in ('draft','published'));
alter table public.nam_courses add column created_at timestamptz not null default now();
alter table public.nam_courses add column updated_at timestamptz not null default now();
alter table public.nam_courses add constraint academy_course_title_length check(length(trim(title)) between 1 and 200);
alter table public.nam_course_versions add column area text;
update public.nam_course_versions v set area=c.area from public.nam_courses c where c.id=v.course_id;
alter table public.nam_course_versions alter column area set not null;
alter table public.nam_course_versions add constraint academy_publication_area check(area in ('sales','3d','post_production'));
alter table public.nam_lessons add column source_lesson_id uuid;
alter table public.nam_lessons add constraint academy_lesson_title_length check(length(trim(title)) between 1 and 200);
alter table public.nam_lessons add constraint academy_lesson_body_length check(length(trim(body)) between 1 and 50000);

create table public.nam_course_draft_lessons(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,course_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),body text not null check(length(trim(body)) between 1 and 50000),
 position integer not null check(position>0),unique(course_id,position) deferrable initially deferred,
 foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id));
-- Adopt any foundation publication without rewriting its historical content.
insert into public.nam_course_draft_lessons(id,workspace_id,course_id,title,body,position)
 select l.id,l.workspace_id,v.course_id,l.title,l.body,l.position from public.nam_lessons l
 join public.nam_course_versions v on v.id=l.course_version_id
 where not exists(select 1 from public.nam_course_versions n where n.course_id=v.course_id and n.version>v.version);
update public.nam_courses c set publication_status='published',summary=v.summary from public.nam_course_versions v
 where v.course_id=c.id and not exists(select 1 from public.nam_course_versions n where n.course_id=v.course_id and n.version>v.version);

alter table public.nam_enrollments add column course_id uuid;
update public.nam_enrollments e set course_id=v.course_id from public.nam_course_versions v where v.id=e.course_version_id;
alter table public.nam_enrollments alter column course_id set not null;
alter table public.nam_enrollments add constraint academy_enrollment_course foreign key(workspace_id,course_id) references public.nam_courses(workspace_id,id);
-- Keep historical enrollment rows; only the latest publication stays active.
update public.nam_enrollments e set revoked_at=now() where e.revoked_at is null and exists(
 select 1 from public.nam_enrollments n join public.nam_course_versions nv on nv.id=n.course_version_id
 join public.nam_course_versions ov on ov.id=e.course_version_id
 where n.workspace_id=e.workspace_id and n.user_id=e.user_id and n.course_id=e.course_id and n.revoked_at is null and nv.version>ov.version);
create unique index nam_academy_one_active_enrollment on public.nam_enrollments(workspace_id,course_id,user_id) where revoked_at is null;
create index nam_academy_enrollment_user on public.nam_enrollments(workspace_id,user_id,course_id) where revoked_at is null;

create table public.nam_course_completions(
 workspace_id uuid not null,course_version_id uuid not null,user_id uuid not null,course_id uuid not null,course_version integer not null,title text not null,completed_at timestamptz not null default now(),
 basis text not null default 'self_reported' check(basis='self_reported'),primary key(course_version_id,user_id),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id),
 foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id));
create table public.nam_academy_completion_events(
 id bigint generated always as identity primary key,workspace_id uuid not null,course_version_id uuid not null,user_id uuid not null,course_id uuid not null,course_version integer not null,
 kind text not null check(kind in ('completed','reopened')),created_at timestamptz not null default now(),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id),
 foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id));
create table public.nam_academy_events(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.nam_workspaces(id),course_id uuid not null,
 actor_id uuid not null references auth.users(id),kind text not null,detail text not null,created_at timestamptz not null default now());
create index nam_academy_event_course on public.nam_academy_events(workspace_id,course_id,id desc);

create table public.nam_academy_assignments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,course_version_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),instructions text not null check(length(trim(instructions)) between 1 and 20000),
 created_at timestamptz not null default now(),unique(workspace_id,id),
 foreign key(workspace_id,course_version_id) references public.nam_course_versions(workspace_id,id));
create table public.nam_academy_submissions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,assignment_id uuid not null,user_id uuid not null,
 body text not null check(length(trim(body)) between 1 and 20000),status text not null default 'submitted' check(status in ('submitted','approved','changes_requested')),
 revision integer not null default 1 check(revision>0),submitted_at timestamptz not null default now(),reviewed_at timestamptz,
 reviewer_id uuid references auth.users(id),feedback text not null default '' check(length(feedback)<=5000),
 unique(assignment_id,user_id),unique(workspace_id,id),foreign key(workspace_id,assignment_id) references public.nam_academy_assignments(workspace_id,id),
 foreign key(workspace_id,user_id) references public.nam_memberships(workspace_id,user_id));
create table public.nam_academy_submission_events(
 id bigint generated always as identity primary key,workspace_id uuid not null,submission_id uuid not null,actor_id uuid not null references auth.users(id),
 kind text not null check(kind in ('submitted','approved','changes_requested')),body text not null,feedback text not null default '',created_at timestamptz not null default now(),
 foreign key(workspace_id,submission_id) references public.nam_academy_submissions(workspace_id,id));
create index nam_academy_submission_assignment on public.nam_academy_submissions(workspace_id,assignment_id,user_id);

-- Reads use the authenticated caller's JWT and RLS. Published lessons are never
-- exposed merely because a learner knows a publication or lesson UUID.
alter table public.nam_course_draft_lessons enable row level security;
alter table public.nam_course_completions enable row level security;
alter table public.nam_academy_completion_events enable row level security;
alter table public.nam_academy_events enable row level security;
alter table public.nam_academy_assignments enable row level security;
alter table public.nam_academy_submissions enable row level security;
alter table public.nam_academy_submission_events enable row level security;
drop policy courses_read on public.nam_courses;
drop policy versions_read on public.nam_course_versions;
drop policy lessons_read on public.nam_lessons;
drop policy enrollments_read on public.nam_enrollments;
drop policy progress_read on public.nam_lesson_progress;
create policy academy_course_read on public.nam_courses for select to authenticated using(public.nam_section(workspace_id,'academy') and
 (public.nam_founder(workspace_id) or (not archived and exists(select 1 from public.nam_enrollments e where e.course_id=nam_courses.id and e.user_id=(select auth.uid()) and e.revoked_at is null))));
create policy academy_enrollment_read on public.nam_enrollments for select to authenticated using(public.nam_section(workspace_id,'academy') and (public.nam_founder(workspace_id) or user_id=(select auth.uid())));
create policy academy_version_read on public.nam_course_versions for select to authenticated using(public.nam_section(workspace_id,'academy') and
 (public.nam_founder(workspace_id) or exists(select 1 from public.nam_enrollments e join public.nam_courses c on c.id=e.course_id where e.course_version_id=nam_course_versions.id and e.user_id=(select auth.uid()) and e.revoked_at is null and not c.archived)));
create policy academy_lesson_read on public.nam_lessons for select to authenticated using(exists(select 1 from public.nam_course_versions v where v.id=course_version_id and v.workspace_id=nam_lessons.workspace_id));
create policy academy_progress_read on public.nam_lesson_progress for select to authenticated using((user_id=(select auth.uid()) or exists(select 1 from public.nam_lessons l where l.id=lesson_id and public.nam_founder(l.workspace_id))) and exists(select 1 from public.nam_lessons l where l.id=lesson_id));
create policy academy_draft_read on public.nam_course_draft_lessons for select to authenticated using(public.nam_founder(workspace_id));
create policy academy_completion_read on public.nam_course_completions for select to authenticated using(public.nam_section(workspace_id,'academy') and (user_id=(select auth.uid()) or public.nam_founder(workspace_id)));
create policy academy_completion_event_read on public.nam_academy_completion_events for select to authenticated using(public.nam_section(workspace_id,'academy') and (user_id=(select auth.uid()) or public.nam_founder(workspace_id)));
create policy academy_event_read on public.nam_academy_events for select to authenticated using(public.nam_founder(workspace_id));
create policy academy_assignment_read on public.nam_academy_assignments for select to authenticated using(exists(select 1 from public.nam_course_versions v where v.id=course_version_id and v.workspace_id=nam_academy_assignments.workspace_id));
create policy academy_submission_read on public.nam_academy_submissions for select to authenticated using(public.nam_section(workspace_id,'academy') and
 (public.nam_founder(workspace_id) or (user_id=(select auth.uid()) and exists(select 1 from public.nam_academy_assignments a where a.id=assignment_id))));
create policy academy_submission_event_read on public.nam_academy_submission_events for select to authenticated using(exists(select 1 from public.nam_academy_submissions s where s.id=submission_id and s.workspace_id=nam_academy_submission_events.workspace_id));

-- JSON DTOs match the browser's local-preview contract. Learner read functions
-- use INVOKER and retain RLS. Founder catalog/detail functions separately check
-- founder AAL2/workspace, then read column-private working metadata as DEFINER.
create function public.nam_academy_assignment(w uuid,a_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.nam_academy_assignments;v public.nam_course_versions;result jsonb;
begin
 if not public.nam_section(w,'academy') then raise exception 'Access denied' using errcode='42501';end if;
 select * into a from public.nam_academy_assignments t where t.id=a_id and t.workspace_id=w;
 if not found then raise exception 'Assignment not found' using errcode='P0002';end if;
 if not public.nam_founder(w) and not exists(select 1 from public.nam_enrollments e join public.nam_courses c on c.id=e.course_id where e.workspace_id=w and e.course_version_id=a.course_version_id and e.user_id=auth.uid() and e.revoked_at is null and not c.archived) then raise exception 'Assignment not found' using errcode='P0002';end if;
 select * into v from public.nam_course_versions t where t.id=a.course_version_id and t.workspace_id=w;
 result:=jsonb_build_object('id',a.id,'course_id',v.course_id,'course_version',v.version,'title',a.title,'instructions',a.instructions,'created_at',a.created_at,
 'submissions',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('member_id',s.user_id,'name',m.name,'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.nam_academy_submission_events h where h.submission_id=s.id and h.workspace_id=w),'[]'::jsonb)) order by s.submitted_at desc)
 from public.nam_academy_submissions s left join public.nam_memberships m on m.workspace_id=w and m.user_id=s.user_id where s.assignment_id=a.id and s.workspace_id=w and (s.user_id=auth.uid() or public.nam_founder(w))),'[]'::jsonb));
 return result;
end $$;

create function public.nam_academy_course(w uuid,c_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.nam_courses;e public.nam_enrollments;v public.nam_course_versions;total integer;done integer;result jsonb;
begin
 if not public.nam_section(w,'academy') then raise exception 'Access denied' using errcode='42501';end if;
 select t.id,t.workspace_id,t.archived into c.id,c.workspace_id,c.archived from public.nam_courses t where t.id=c_id and t.workspace_id=w and not t.archived;
 if not found then raise exception 'Course not found' using errcode='P0002';end if;
 select * into e from public.nam_enrollments t where t.workspace_id=w and t.course_id=c.id and t.user_id=auth.uid() and t.revoked_at is null;
 if not found then raise exception 'Course not found' using errcode='P0002';end if;
 select * into v from public.nam_course_versions t where t.id=e.course_version_id and t.workspace_id=w;
 select count(*) into total from public.nam_lessons l where l.course_version_id=v.id and l.workspace_id=w;
 select count(*) into done from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id where l.course_version_id=v.id and l.workspace_id=w and p.user_id=auth.uid();
 result:=jsonb_build_object('id',c.id,'course_id',c.id,'version',v.version,'publication_id',v.id,'title',v.title,'area',v.area,'summary',v.summary,'mandatory',e.mandatory,'published_at',v.published_at,'total',total,'completed',done,
 'completion',case when total>0 and done=total then (select to_jsonb(r)||jsonb_build_object('member_id',r.user_id,'course_id',c.id,'course_version',v.version) from public.nam_course_completions r where r.course_version_id=v.id and r.user_id=auth.uid() and r.workspace_id=w) else null end,
 'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'course_id',c.id,'course_version',v.version,'position',l.position,'title',l.title,'body',l.body,'completed_at',p.completed_at) order by l.position) from public.nam_lessons l left join public.nam_lesson_progress p on p.lesson_id=l.id and p.user_id=auth.uid() where l.course_version_id=v.id and l.workspace_id=w),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'course_id',c.id,'course_version',v.version,'title',a.title,'instructions',a.instructions,'created_at',a.created_at,'submission_id',s.id,'submission_body',s.body,'submission_status',s.status,'submission_revision',s.revision,'submitted_at',s.submitted_at,'reviewed_at',s.reviewed_at,'feedback',s.feedback) order by a.created_at,a.id) from public.nam_academy_assignments a left join public.nam_academy_submissions s on s.assignment_id=a.id and s.user_id=auth.uid() where a.workspace_id=w and a.course_version_id=v.id),'[]'::jsonb));
 return result;
end $$;

create function public.nam_academy_catalog(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('version',coalesce((select max(v.version) from public.nam_course_versions v where v.course_id=c.id and v.workspace_id=w),0),'lesson_count',(select count(*) from public.nam_course_draft_lessons l where l.course_id=c.id and l.workspace_id=w),'enrollment_count',(select count(*) from public.nam_enrollments e where e.course_id=c.id and e.workspace_id=w and e.revoked_at is null)) order by c.archived,c.area,c.title) from public.nam_courses c where c.workspace_id=w),'[]'::jsonb);
end $$;

create function public.nam_academy_list(w uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not public.nam_section(w,'academy') then raise exception 'Access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'course_id',c.id,'version',v.version,'publication_id',v.id,'title',v.title,'area',v.area,'summary',v.summary,'mandatory',e.mandatory,'published_at',v.published_at,
 'total',(select count(*) from public.nam_lessons l where l.course_version_id=v.id and l.workspace_id=w),
 'completed',(select count(*) from public.nam_lesson_progress p join public.nam_lessons l on l.id=p.lesson_id where p.user_id=auth.uid() and l.course_version_id=v.id and l.workspace_id=w),
 'completion',case when exists(select 1 from public.nam_lessons l where l.course_version_id=v.id and l.workspace_id=w) and not exists(select 1 from public.nam_lessons l where l.course_version_id=v.id and l.workspace_id=w and not exists(select 1 from public.nam_lesson_progress p where p.lesson_id=l.id and p.user_id=auth.uid())) then (select to_jsonb(r)||jsonb_build_object('member_id',r.user_id,'course_id',c.id,'course_version',v.version) from public.nam_course_completions r where r.workspace_id=w and r.course_version_id=v.id and r.user_id=auth.uid()) else null end) order by v.area,v.title)
 from public.nam_enrollments e join public.nam_courses c on c.id=e.course_id and c.workspace_id=w join public.nam_course_versions v on v.id=e.course_version_id and v.workspace_id=w where e.workspace_id=w and e.user_id=auth.uid() and e.revoked_at is null and not c.archived),'[]'::jsonb);
end $$;

create function public.nam_academy_admin_course(w uuid,c_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.nam_courses;
begin
 if not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501';end if;
 select * into c from public.nam_courses t where t.id=c_id and t.workspace_id=w;
 if not found then raise exception 'Course not found' using errcode='P0002';end if;
 return to_jsonb(c)||jsonb_build_object('version',coalesce((select max(v.version) from public.nam_course_versions v where v.course_id=c.id and v.workspace_id=w),0),
 'lessons',coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from public.nam_course_draft_lessons l where l.course_id=c.id and l.workspace_id=w),'[]'::jsonb),
 'publications',coalesce((select jsonb_agg(to_jsonb(v) order by v.version desc) from public.nam_course_versions v where v.course_id=c.id and v.workspace_id=w),'[]'::jsonb),
 'enrollments',coalesce((select jsonb_agg(jsonb_build_object('member_id',e.user_id,'course_id',c.id,'course_version',v.version,'mandatory',e.mandatory,'name',coalesce(m.name,e.user_id::text),'role',m.role) order by m.name) from public.nam_enrollments e join public.nam_course_versions v on v.id=e.course_version_id left join public.nam_memberships m on m.workspace_id=w and m.user_id=e.user_id where e.course_id=c.id and e.workspace_id=w and e.revoked_at is null),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(public.nam_academy_assignment(w,a.id) order by a.created_at,a.id) from public.nam_academy_assignments a join public.nam_course_versions v on v.id=a.course_version_id where v.course_id=c.id and a.workspace_id=w),'[]'::jsonb),
 'completion_records',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('member_id',r.user_id,'course_id',c.id,'course_version',v.version,'name',coalesce(m.name,r.user_id::text)) order by r.completed_at desc) from public.nam_course_completions r join public.nam_course_versions v on v.id=r.course_version_id left join public.nam_memberships m on m.workspace_id=w and m.user_id=r.user_id where v.course_id=c.id and r.workspace_id=w),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(z) order by z.id desc) from (select * from public.nam_academy_events a where a.workspace_id=w and a.course_id=c.id order by a.id desc limit 100) z),'[]'::jsonb));
end $$;

create function public.nam_academy_keys(changes jsonb,allowed text[]) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(changes)='object' and not exists(select 1 from jsonb_object_keys(changes) as fields(key) where fields.key<>all(allowed)),false)
$$;

-- A single transactional command function protects field-level rules, row locks,
-- workspace boundaries, publication immutability and trusted audit identity.
create function public.nam_academy_admin(w uuid,op text,p_course_id uuid,expected_revision integer,changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.nam_courses;draft public.nam_course_draft_lessons;v public.nam_course_versions;
 learner uuid;lesson_id uuid;ids uuid[];next_position integer;n integer;i integer;allowed text[];result jsonb;event_detail text;
begin
 if auth.uid() is null or not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501';end if;
 allowed:=case op when 'create' then array['title','area','summary'] when 'edit' then array['title','area','summary','archived']
 when 'lesson' then array['id','title','body','position'] when 'remove-lesson' then array['id'] when 'reorder' then array['lesson_ids']
 when 'publish' then array[]::text[] when 'enroll' then array['member_id','mandatory','course_version'] when 'revoke' then array['member_id']
 when 'assignments' then array['course_version','title','instructions'] when 'delete' then array[]::text[] else null end;
 if allowed is null or not public.nam_academy_keys(changes,allowed) then raise exception 'Unsupported Academy fields or operation' using errcode='22023';end if;
 if op='create' then
  if jsonb_typeof(changes->'title') is distinct from 'string' or jsonb_typeof(changes->'area') is distinct from 'string' or (changes?'summary' and jsonb_typeof(changes->'summary')<>'string') then raise exception 'Invalid course fields' using errcode='22023';end if;
  insert into public.nam_courses(workspace_id,title,area,summary) values(w,trim(changes->>'title'),changes->>'area',coalesce(changes->>'summary','')) returning * into c;
 else
  select * into c from public.nam_courses t where t.id=p_course_id and t.workspace_id=w for update;
  if not found then raise exception 'Course not found' using errcode='P0002';end if;
  if op in ('edit','lesson','remove-lesson','reorder','publish','delete') and expected_revision is distinct from c.revision then raise exception 'This course changed elsewhere. Reload before saving.' using errcode='40001';end if;
  if c.archived and op in ('lesson','remove-lesson','reorder','publish','enroll','assignments') then raise exception 'Restore the course before this action' using errcode='22023';end if;
 end if;
 if op='edit' then
  if (changes?'title' and jsonb_typeof(changes->'title')<>'string') or (changes?'area' and jsonb_typeof(changes->'area')<>'string') or (changes?'summary' and jsonb_typeof(changes->'summary')<>'string') or (changes?'archived' and jsonb_typeof(changes->'archived')<>'boolean') then raise exception 'Invalid course fields' using errcode='22023';end if;
  update public.nam_courses set title=coalesce(trim(changes->>'title'),c.title),area=coalesce(changes->>'area',c.area),summary=coalesce(changes->>'summary',c.summary),archived=coalesce((changes->>'archived')::boolean,c.archived),publication_status=case when changes?'title' or changes?'area' or changes?'summary' then 'draft' else c.publication_status end,revision=revision+1,updated_at=now() where id=c.id and workspace_id=w;
 elsif op='lesson' then
  if jsonb_typeof(changes->'title') is distinct from 'string' or jsonb_typeof(changes->'body') is distinct from 'string' or (changes?'id' and jsonb_typeof(changes->'id')<>'string') or (changes?'position' and jsonb_typeof(changes->'position')<>'number') then raise exception 'Invalid lesson fields' using errcode='22023';end if;
  select count(*) into n from public.nam_course_draft_lessons l where l.workspace_id=w and l.course_id=c.id;
  if changes?'id' then
   select * into draft from public.nam_course_draft_lessons l where l.id=(changes->>'id')::uuid and l.workspace_id=w and l.course_id=c.id;
   if not found then raise exception 'Lesson not found' using errcode='P0002';end if;
   lesson_id:=draft.id;next_position:=coalesce((changes->>'position')::integer,draft.position);
  else lesson_id:=gen_random_uuid();next_position:=coalesce((changes->>'position')::integer,n+1);end if;
  if next_position<1 or next_position>(n+(case when draft.id is null then 1 else 0 end)) then raise exception 'Invalid lesson position' using errcode='22023';end if;
  if draft.id is null then
   update public.nam_course_draft_lessons set position=position+1 where workspace_id=w and course_id=c.id and position>=next_position;
   insert into public.nam_course_draft_lessons(id,workspace_id,course_id,title,body,position) values(lesson_id,w,c.id,trim(changes->>'title'),changes->>'body',next_position);
  else
   update public.nam_course_draft_lessons set position=case when next_position<draft.position and position>=next_position and position<draft.position then position+1 when next_position>draft.position and position>draft.position and position<=next_position then position-1 else position end where workspace_id=w and course_id=c.id and id<>draft.id;
   update public.nam_course_draft_lessons set title=trim(changes->>'title'),body=changes->>'body',position=next_position where id=draft.id and workspace_id=w;
  end if;
  update public.nam_courses set publication_status='draft',revision=revision+1,updated_at=now() where id=c.id and workspace_id=w;
 elsif op='remove-lesson' then
  select * into draft from public.nam_course_draft_lessons l where l.id=(changes->>'id')::uuid and l.workspace_id=w and l.course_id=c.id;
  if not found then raise exception 'Lesson not found' using errcode='P0002';end if;
  delete from public.nam_course_draft_lessons where id=draft.id and workspace_id=w;
  update public.nam_course_draft_lessons set position=position-1 where workspace_id=w and course_id=c.id and position>draft.position;
  update public.nam_courses set publication_status='draft',revision=revision+1,updated_at=now() where id=c.id and workspace_id=w;
 elsif op='reorder' then
  if jsonb_typeof(changes->'lesson_ids') is distinct from 'array' then raise exception 'Supply the ordered lesson IDs' using errcode='22023';end if;
  select coalesce(array_agg(x::uuid),array[]::uuid[]) into ids from jsonb_array_elements_text(changes->'lesson_ids') x;
  select count(*) into n from public.nam_course_draft_lessons l where l.workspace_id=w and l.course_id=c.id;
  if cardinality(ids)<>n or (select count(distinct x) from unnest(ids) x)<>n or exists(select 1 from unnest(ids) x where not exists(select 1 from public.nam_course_draft_lessons l where l.id=x and l.workspace_id=w and l.course_id=c.id)) then raise exception 'Supply each lesson exactly once' using errcode='22023';end if;
  i:=0;foreach lesson_id in array ids loop i:=i+1;update public.nam_course_draft_lessons set position=i where id=lesson_id and workspace_id=w and course_id=c.id;end loop;
  update public.nam_courses set publication_status='draft',revision=revision+1,updated_at=now() where id=c.id and workspace_id=w;
 elsif op='publish' then
  if c.publication_status<>'draft' then raise exception 'This working copy is already published' using errcode='40001';end if;
  if not exists(select 1 from public.nam_course_draft_lessons l where l.course_id=c.id and l.workspace_id=w) then raise exception 'Add at least one lesson before publishing' using errcode='22023';end if;
  select coalesce(max(t.version),0)+1 into n from public.nam_course_versions t where t.course_id=c.id and t.workspace_id=w;
  insert into public.nam_course_versions(workspace_id,course_id,version,title,summary,area) values(w,c.id,n,c.title,c.summary,c.area) returning * into v;
  insert into public.nam_lessons(workspace_id,course_version_id,title,body,position,source_lesson_id) select w,v.id,l.title,l.body,l.position,l.id from public.nam_course_draft_lessons l where l.course_id=c.id and l.workspace_id=w;
  update public.nam_courses set publication_status='published',revision=revision+1,updated_at=now() where id=c.id and workspace_id=w;
 elsif op in ('enroll','revoke') then
  if jsonb_typeof(changes->'member_id') is distinct from 'string' then raise exception 'A member identifier is required' using errcode='22023';end if;learner:=(changes->>'member_id')::uuid;
  if not exists(select 1 from public.nam_memberships m where m.workspace_id=w and m.user_id=learner and m.active) then raise exception 'Member not found' using errcode='P0002';end if;
  if op='revoke' then
   update public.nam_enrollments set revoked_at=now() where workspace_id=w and course_id=c.id and user_id=learner and revoked_at is null;
   if not found then raise exception 'Enrollment not found' using errcode='P0002';end if;
  else
   if (changes?'course_version' and jsonb_typeof(changes->'course_version')<>'number') or (changes?'mandatory' and jsonb_typeof(changes->'mandatory')<>'boolean') then raise exception 'Invalid enrollment fields' using errcode='22023';end if;
   select * into v from public.nam_course_versions t where t.course_id=c.id and t.workspace_id=w and (not changes?'course_version' or t.version=(changes->>'course_version')::integer) order by t.version desc limit 1;
   if not found then raise exception 'Publish a course before enrolling learners' using errcode='P0002';end if;
   update public.nam_enrollments set revoked_at=now() where workspace_id=w and course_id=c.id and user_id=learner and revoked_at is null and course_version_id<>v.id;
   insert into public.nam_enrollments(workspace_id,course_version_id,user_id,mandatory,course_id) values(w,v.id,learner,coalesce((changes->>'mandatory')::boolean,false),c.id) on conflict(course_version_id,user_id) do update set mandatory=excluded.mandatory,revoked_at=null;
  end if;
 elsif op='assignments' then
  if jsonb_typeof(changes->'title') is distinct from 'string' or jsonb_typeof(changes->'instructions') is distinct from 'string' or (changes?'course_version' and jsonb_typeof(changes->'course_version')<>'number') then raise exception 'Invalid assignment fields' using errcode='22023';end if;
  select * into v from public.nam_course_versions t where t.workspace_id=w and t.course_id=c.id and (not changes?'course_version' or t.version=(changes->>'course_version')::integer) order by t.version desc limit 1;
  if not found then raise exception 'Publish a course before adding assignments' using errcode='P0002';end if;
  insert into public.nam_academy_assignments(workspace_id,course_version_id,title,instructions) values(w,v.id,trim(changes->>'title'),changes->>'instructions') returning id into lesson_id;
 elsif op='delete' then
  if exists(select 1 from public.nam_course_versions t where t.course_id=c.id and t.workspace_id=w) then raise exception 'Archive published courses to retain training history' using errcode='40001';end if;
  delete from public.nam_course_draft_lessons where course_id=c.id and workspace_id=w;
  delete from public.nam_courses where id=c.id and workspace_id=w;
 end if;
 insert into public.nam_academy_events(workspace_id,course_id,actor_id,kind,detail) values(w,c.id,auth.uid(),op,case when op='publish' then 'Published immutable version '||n::text when op in ('enroll','revoke') then learner::text else 'Course action: '||op end);
 if op='delete' then return jsonb_build_object('id',c.id,'deleted',true);end if;
 if op='assignments' then return public.nam_academy_assignment(w,lesson_id);end if;
 return public.nam_academy_admin_course(w,c.id);
end $$;

create function public.nam_academy_progress(w uuid,l_id uuid,mark_complete boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.nam_lessons;e public.nam_enrollments;v public.nam_course_versions;total integer;before_done integer;after_done integer;
begin
 if auth.uid() is null or not public.nam_section(w,'academy') or mark_complete is null then raise exception 'Access denied' using errcode='42501';end if;
 select * into l from public.nam_lessons t where t.id=l_id and t.workspace_id=w;
 if not found then raise exception 'Lesson not found' using errcode='P0002';end if;
 select * into v from public.nam_course_versions t where t.id=l.course_version_id and t.workspace_id=w;
 select * into e from public.nam_enrollments t where t.workspace_id=w and t.course_version_id=v.id and t.user_id=auth.uid() and t.revoked_at is null for update;
 if not found or not exists(select 1 from public.nam_courses c where c.id=v.course_id and c.workspace_id=w and not c.archived) then raise exception 'Lesson not found' using errcode='P0002';end if;
 select count(*) into total from public.nam_lessons t where t.course_version_id=v.id and t.workspace_id=w;
 select count(*) into before_done from public.nam_lesson_progress p join public.nam_lessons t on t.id=p.lesson_id where p.user_id=auth.uid() and t.course_version_id=v.id and t.workspace_id=w;
 if mark_complete then insert into public.nam_lesson_progress(user_id,lesson_id) values(auth.uid(),l.id) on conflict(user_id,lesson_id) do nothing;
 else delete from public.nam_lesson_progress where user_id=auth.uid() and lesson_id=l.id;end if;
 select count(*) into after_done from public.nam_lesson_progress p join public.nam_lessons t on t.id=p.lesson_id where p.user_id=auth.uid() and t.course_version_id=v.id and t.workspace_id=w;
 if total>0 and after_done=total and before_done<total then
  insert into public.nam_course_completions(workspace_id,course_version_id,user_id,course_id,course_version,title) values(w,v.id,auth.uid(),v.course_id,v.version,v.title) on conflict(course_version_id,user_id) do nothing;
  insert into public.nam_academy_completion_events(workspace_id,course_version_id,user_id,course_id,course_version,kind) values(w,v.id,auth.uid(),v.course_id,v.version,'completed');
 elsif before_done=total and after_done<total then insert into public.nam_academy_completion_events(workspace_id,course_version_id,user_id,course_id,course_version,kind) values(w,v.id,auth.uid(),v.course_id,v.version,'reopened');end if;
 return public.nam_academy_course(w,v.course_id);
end $$;

create function public.nam_academy_submit(w uuid,a_id uuid,expected_revision integer,response_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.nam_academy_assignments;e public.nam_enrollments;s public.nam_academy_submissions;submission_id uuid;
begin
 if auth.uid() is null or not public.nam_section(w,'academy') then raise exception 'Access denied' using errcode='42501';end if;
 if response_body is null or length(trim(response_body)) not between 1 and 20000 then raise exception 'Response must contain 1 to 20000 characters' using errcode='22023';end if;
 select * into a from public.nam_academy_assignments t where t.id=a_id and t.workspace_id=w;
 if not found then raise exception 'Assignment not found' using errcode='P0002';end if;
 select * into e from public.nam_enrollments t where t.workspace_id=w and t.course_version_id=a.course_version_id and t.user_id=auth.uid() and t.revoked_at is null for update;
 if not found or not exists(select 1 from public.nam_courses c where c.id=e.course_id and c.workspace_id=w and not c.archived) then raise exception 'Assignment not found' using errcode='P0002';end if;
 select * into s from public.nam_academy_submissions t where t.workspace_id=w and t.assignment_id=a.id and t.user_id=auth.uid() for update;
 if (s.id is not null and expected_revision is distinct from s.revision) or (s.id is null and coalesce(expected_revision,0)<>0) then raise exception 'This response changed elsewhere. Reload before saving.' using errcode='40001';end if;
 if s.id is null then insert into public.nam_academy_submissions(workspace_id,assignment_id,user_id,body) values(w,a.id,auth.uid(),trim(response_body)) returning id into submission_id;
 else update public.nam_academy_submissions set body=trim(response_body),status='submitted',revision=revision+1,submitted_at=now(),reviewed_at=null,reviewer_id=null,feedback='' where id=s.id and workspace_id=w returning id into submission_id;end if;
 insert into public.nam_academy_submission_events(workspace_id,submission_id,actor_id,kind,body) values(w,submission_id,auth.uid(),'submitted',trim(response_body));
 return public.nam_academy_assignment(w,a.id);
end $$;

create function public.nam_academy_review(w uuid,s_id uuid,expected_revision integer,review_status text,review_feedback text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.nam_academy_submissions;
begin
 if auth.uid() is null or not public.nam_founder(w) then raise exception 'Founder MFA required' using errcode='42501';end if;
 if review_status is null or review_status not in ('approved','changes_requested') or review_feedback is null or length(review_feedback)>5000 or (review_status='changes_requested' and length(trim(review_feedback))=0) then raise exception 'Choose a review decision and provide feedback for changes requested' using errcode='22023';end if;
 select * into s from public.nam_academy_submissions t where t.id=s_id and t.workspace_id=w for update;
 if not found then raise exception 'Submission not found' using errcode='P0002';end if;
 if expected_revision is distinct from s.revision then raise exception 'This response changed elsewhere. Reload before reviewing.' using errcode='40001';end if;
 update public.nam_academy_submissions set status=review_status,feedback=trim(review_feedback),reviewer_id=auth.uid(),reviewed_at=now(),revision=revision+1 where id=s.id and workspace_id=w;
 insert into public.nam_academy_submission_events(workspace_id,submission_id,actor_id,kind,body,feedback) values(w,s.id,auth.uid(),review_status,s.body,trim(review_feedback));
 return public.nam_academy_assignment(w,s.assignment_id);
end $$;

-- The course row holds editable working metadata. Enrolled learners may read
-- its identity/archive state, but cannot fetch unpublished titles/summaries via
-- a direct Data API SELECT. Founder DTOs above check AAL2 and workspace before
-- reading these fields through their narrowly scoped definer functions.
revoke select on public.nam_courses from authenticated;
grant select(id,workspace_id,archived) on public.nam_courses to authenticated;
revoke all on public.nam_course_draft_lessons,public.nam_course_completions,public.nam_academy_completion_events,public.nam_academy_events,public.nam_academy_assignments,public.nam_academy_submissions,public.nam_academy_submission_events from public,anon,authenticated;
grant select on public.nam_course_draft_lessons,public.nam_course_completions,public.nam_academy_completion_events,public.nam_academy_events,public.nam_academy_assignments,public.nam_academy_submissions,public.nam_academy_submission_events to authenticated;
revoke all on function public.nam_academy_assignment(uuid,uuid),public.nam_academy_course(uuid,uuid),public.nam_academy_list(uuid),public.nam_academy_catalog(uuid),public.nam_academy_admin_course(uuid,uuid),public.nam_academy_keys(jsonb,text[]),public.nam_academy_admin(uuid,text,uuid,integer,jsonb),public.nam_academy_progress(uuid,uuid,boolean),public.nam_academy_submit(uuid,uuid,integer,text),public.nam_academy_review(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.nam_academy_assignment(uuid,uuid),public.nam_academy_course(uuid,uuid),public.nam_academy_list(uuid),public.nam_academy_catalog(uuid),public.nam_academy_admin_course(uuid,uuid),public.nam_academy_keys(jsonb,text[]),public.nam_academy_admin(uuid,text,uuid,integer,jsonb),public.nam_academy_progress(uuid,uuid,boolean),public.nam_academy_submit(uuid,uuid,integer,text),public.nam_academy_review(uuid,uuid,integer,text,text) to authenticated;
commit;
