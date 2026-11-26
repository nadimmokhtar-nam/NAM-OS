# Professional profiles, departments and task inbox preferences

Migration `202611250032_team_profiles.sql` adds professional metadata to the
existing identity/access implementation. It does not introduce a second user,
invitation or authorization system. This is a bounded supporting workflow for
Projects, Tasks, Academy and Sales.

An active member can edit their own existing display name and professional job
title, and choose whether the three currently supported task events create an
in-app notification. The Founder can create, rename and archive departments and
assign an active member to one department. No personal phone numbers, home
addresses, dates of birth, compensation, employment records or arbitrary HR
fields are collected. A department is a professional label and never a grant.

## Visibility and existing access

The active professional directory requires the existing `team` section. Under
the current fixed role ceilings, this is Founder-only. It shows name, job title,
department and the existing role label; it does not expose another member's
notification preferences, provider email, private tasks or account secrets.
Ordinary members can read and edit their own profile/preferences even when they
have no section grants. A member can see the label of their assigned department.

Founder department assignment can return the saved profile and its revision;
Founder audit history includes the before/after values of metadata changes.
Ordinary members can read only their own metadata history. Existing invitation,
pending account, suspension, recovery, role-template and section-grant controls
remain in Account & access. There is no department-based task, project, Academy
or Sales access. Giving two people the same department does not let them read
each other's work.

All metadata RPCs use the original caller's user-JWT Supabase client. They check
live membership, managed session validity and elected MFA. Migration 015's
password-only default applies to Founder as well; a verified enrolled factor
requires AAL2. Mutations recheck after locks; an exact retry cannot recover a
revoked session's authority. The service role receives no metadata-table grants
or metadata-RPC execution. Internal projections and the notification trigger
are not callable by ordinary users or the service role. Existing Origin/CSRF
enforcement remains the enclosing route's responsibility.

## Supported preferences and their effect

| Preference | Existing producer | Effect |
| --- | --- | --- |
| `assignment` | `nam_save_task` / `nam_create_task` when someone assigns a task to another eligible member | Suppresses the new assignment inbox row when unchecked. |
| `due` | `nam_process_reminders` for a task due today in Europe/Paris | Suppresses the new due-today inbox row when unchecked. |
| `overdue` | `nam_process_reminders` for an overdue task | Suppresses the new overdue inbox row when unchecked. |

A `BEFORE INSERT` trigger on the existing `nam_notifications` table applies the
recipient's saved preferences to every existing creation path, including the
scheduled service-identity reminder job. Missing profile rows preserve all three
existing defaults as enabled. The trigger also requires an active recipient,
current eligible section grant, matching task owner/workspace and a live,
unarchived task. It does not broaden notification reads: the existing
recipient/task RLS policy still decides whether an inbox item is visible.

A preference save creates no notifications. It does not delete old inbox items
or replay suppressed assignment events. Subsequent scheduled runs evaluate the
then-current preferences and currently due tasks, with the existing daily dedupe
key. The scheduler must actually be configured for reminders to exist. This
slice adds no email, push, comment, mention, Academy or client-review delivery
channel, and exposes no switches for those unsupported events.

## Concurrency, history and bounds

Profiles and notification settings share one metadata revision. Founder
department assignment advances that same revision, so an old personal form
cannot overwrite a concurrent assignment. Department records use separate
revisions. Successful no-op saves do not add history or advance revisions.
Before/after history records take their actor from `auth.uid()`.

Every mutation needs a stable `Idempotency-Key`, scoped to workspace and actor.
The database serializes a key and stores its complete request fingerprint and
result. An exact replay returns the original result without repeating history;
reusing the key for another change conflicts. Stale revisions return 409. The UI
retains a conflict draft and offers an explicit reload. An ambiguous network
failure retains the exact body/key and disables editing until retry or a
deliberate decision to leave. Navigation and native modal closing are guarded.

Directory, department and history responses contain at most 50 records per page.
Directory search is limited to 100 characters. A workspace has at most 200
department records, including archived departments. Names are unique within a
workspace ignoring case and surrounding whitespace, including archived names.
Archival preserves existing profile labels and history; new assignments require
an active department. The assignment dialog loads at most four bounded pages.

## Integration contract

| Hook | Integration |
| --- | --- |
| API | Import `dispatchTeamProfiles` from `lib/api/team-profiles.ts` and call it within the existing authenticated, CSRF-protected dispatcher. |
| UI | Import `createTeamProfiles` from `public/team-profiles.js`; supply `request`, `getData`, `openDialog`, `toast`, `render`, `onChange`, and optionally `onBusy`/`contextKey`. |
| Settings | Load `loadSettings()` on normal Settings entry and render `settings(securityUI.render())`. Preserve the existing security-required/MFA setup path. Founder Departments load lazily. |
| Team | Load `loadDirectory()` on Team Directory entry and use `directory()`. Retain the existing Team Tasks tab. |
| Reset/guards | Call `reset()` with identity/session resets. Include `canLeave()` in shell navigation guards and `isBusy()` in existing busy/native-close checks. `canLeave()` performs the actual discard decision. |
| Styles | Add `public/team-profiles.css` through the existing central stylesheet mechanism; no global token or layout change is required. |

`loadSettings({force:true})` is available for an explicit saved-state reload.
Ordinary background loads retain an active personal draft. Directory buttons use
the existing `data-security-action="invite"` and
`data-access-action="open"` controls rather than a second administrative flow.

| Route | Method | Input |
| --- | --- | --- |
| `/team/profile` | GET | Own profile, department and supported preferences. |
| `/team/profile` | PATCH | `{expectedRevision, changes:{name,job_title}}` |
| `/team/preferences` | PATCH | `{expectedRevision, changes:{assignment,due,overdue}}` booleans |
| `/team/directory` | GET | Optional `page`, `search`, `department` UUID. Founder Team access. |
| `/team/departments` | GET | Optional `page`, `archived=0\|1`. Founder. |
| `/team/departments` | POST | `{changes:{name,archived}}`. Founder. |
| `/team/departments/:id` | PATCH | `{expectedRevision,changes:{name,archived}}`. Founder. |
| `/team/members/:id/department` | PATCH | `{expectedRevision,changes:{department_id:uuid\|null}}`. Founder. |
| `/team/history` | GET | Optional `page`; own history or Founder workspace history. |

All mutations also require `Idempotency-Key`. Client-supplied actor, role, grant,
personal-data and unsupported event fields are rejected by both API and SQL.

## Programa reference and implementation evidence

The existing [reference audit](PROGRAMA_REFERENCE_AUDIT.md) records the dedicated
settings sidebar, compact named personal inputs, team rows/invitation action and
named checkbox notification events with separators and Save. The existing
[measurement record](PROGRAMA_REFERENCE_MEASUREMENTS.json) supplies the 188px
navigation width, 28px desktop small actions, 32px controls, 24px/30px heading,
warm neutral surfaces and shared spacing. This slice uses shared tokens, Inter
for UI and NAM's approved Newsreader for headings. Mobile navigation scrolls
horizontally, controls follow the existing 44px shared touch sizes and the
directory table has an explicit horizontal scrolling region. No inline style
attributes or CSP relaxation are introduced.

Local Node 24.22.3 execution passed all 11 new UI interaction tests plus JS/test
syntax checks. The UI suite executes the actual module and verifies supported
preferences, saved revisions, conflicts/draft retention, exact ambiguous
retries, busy navigation, stale account responses, revocation clearing,
delegation to existing controls, escaping, native department Escape handling,
background-draft retention, malformed-metadata rejection and late directory replies.

The new database suite executes real migrations and covers caller boundaries,
service-role denial, no implicit grants, department CAS/archive/cross-workspace
checks, assigned-only task privacy, audit/retry behavior, actual assignment and
scheduled reminder filtering, current session/MFA/suspension and bounded paging.
The new API suite executes the real TypeScript dispatcher against those RPCs,
including malformed fields/events/filters, conflicts and revocation while a
request body is still arriving. Both suites were attempted locally but could
not start because `@electric-sql/pglite` is absent; TypeScript is also absent in
this workspace. They require the repository's dependency-equipped CI runtime.
No successful database/API execution is claimed by the local UI passes.

This slice has not applied a hosted migration, deployed, created real invites,
sent messages or used the shared reference browser. Real Supabase/PostgREST
permissions, scheduled job configuration, current-session/MFA behavior and
desktop/mobile visual/keyboard comparison remain staging verification. Existing
export allowlists were deliberately left unchanged for the owning integration
workstream; the new business tables are `nam_departments`,
`nam_member_profiles` and `nam_team_events`. `nam_team_requests` is internal
retry bookkeeping. Full requested HR, manager-team scope and notification
channels beyond the three supported inbox events are outside this slice.
