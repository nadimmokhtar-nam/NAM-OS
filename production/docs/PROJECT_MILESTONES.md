# Project milestones

Migration `202611250034_project_milestones.sql` adds real project checkpoints.
Every milestone has a title, an explicitly selected `target_date`, an optional
shared project note, a `pending`, `complete` or `cancelled` status and an
independent version. The migration seeds no checkpoints or dates. Milestone
status is independent of tasks, phases, images, client decisions and approvals.

Current project participants can read the same shared checkpoint records.
Founder manages their dates, notes and status. A member with Projects access
still needs explicit participation in that project. Every raw table/API read
uses the existing project access policy, including managed-session validity,
optional enrolled-factor MFA, active membership and current section grants.
There is no service-role identity fallback or self-assignment capability.

Completion and cancellation record the Founder and timestamp. Explicitly
reopening a checkpoint clears its current terminal timestamps while retaining
the complete prior state in the audit. Editing a completed/cancelled checkpoint
preserves its original terminal timestamp unless the status changes. Cancelled
checkpoints remain discoverable with their dates, notes and versions. Archived
projects remain readable to authorized participants and reject milestone changes
until the project is restored. There is no destructive milestone delete route.

All mutations call migration 029's private `nam_task_schedule_lock` before
project or milestone locks. It serializes the workspace scheduling boundary and
pins the exact current membership, account and managed session before a queued
project write can block. Founder assurance is checked after both the project and
record locks. The lock order is identity/session, project, then milestone.

Every create and update requires a stable `Idempotency-Key` and records its
actor, expected version, exact payload, before-state and after-state. A matching
retry returns the originally acknowledged record without another event or
mutation. Reusing a key for a different request conflicts. Updates also compare
`expectedVersion` with the current record. A stale save never adopts another
editor's version or silently overwrites its note/date. The UI retains the typed
draft and offers an explicit saved-record reload. A saved acknowledgment is
followed by a fresh list read; failure of that read is reported as a saved change
with an unavailable refresh.

## Routes and bounded reads

Register `dispatchProjectMilestones` from `lib/api/project-milestones.ts` in the
authenticated catch-all after the existing context and Origin/CSRF gates. The
dispatcher returns `null` for unrelated project routes.

| Route | Request/response |
| --- | --- |
| `GET /projects/:projectId/milestones` | Returns `items`, `total`, `next_offset`, `can_manage`, `project_archived`, `today`, `page_size` and `offset`. |
| `POST /projects/:projectId/milestones` | `{changes:{title,target_date,note?,status?}}` plus `Idempotency-Key`; returns the actual saved record, status 201. |
| `GET /projects/:projectId/milestones/:id` | The actual record and at most 50 audit events for Founder. Participants receive no history. History continuation uses `offset`. |
| `PATCH /projects/:projectId/milestones/:id` | `{expectedVersion,changes:{title?,target_date?,note?,status?}}` plus `Idempotency-Key`; returns the saved record. |

The list accepts `status=all|pending|complete|cancelled`, literal `search` up to
200 characters, optional inclusive `from` and `to` dates, `page_size` 1–100
(default 50) and `offset` 0–100000. Unknown or repeated query fields are rejected.
Date strings must be actual ISO calendar dates within 0001–9999. A checkpoint
date is mandatory and is not inferred from a task or phase. Date ranges must be
ordered. Titles are at most 200 characters and shared notes at most 5000. A
project retains at most 1000 milestones; each read remains paged.

Only `title`, `target_date`, `note` and `status` can be written. Workspace,
project, creator, terminal actors/timestamps, versions and approval/task
relationships cannot be forged in client JSON. Raw milestone tables are
SELECT-only for authenticated users; RLS enforces participation. Audit request
keys and retry payloads have no authenticated column privilege.

## Project UI integration

Import `public/project-milestones.css` through the shared stylesheet entry and
instantiate the controller once:

```js
const projectMilestones=createProjectMilestones({
 request:(...args)=>api(...args),
 getProject:()=>production.getProject(),getData:()=>state.data,
 openDialog,render:()=>render(),toast,
 canLeave:()=>!dirtyDialog()||confirm('Discard your unsaved changes?'),
 onBusy:()=>syncTaskBusy(),
 contextKey:()=>state.routeVersion+':'+state.view+':'+state.projectView
});
```

Add a real Milestones project view. On entry call
`await projectMilestones.load()` and render `projectMilestones.render()`.
The controller owns its `data-milestone-action` and `data-milestone-form`
listeners. All selectors, filters, continuation, detail/edit/status dialogs,
retry keys and accepted-save refreshes are handled internally. Forms disable
their controls while saving. Shared Inter/Newsreader, neutral surfaces, compact
controls, fine separators and mobile touch sizes are reused; no inline styles,
new fonts or packages are introduced.

Include `isSaving()` in shared project/dialog/navigation guards. Include
`hasUnsavedChanges()` and `discardUnsavedChanges()` in accepted-discard handling
and `dirtyDialog` checks. Call `reset()` when the project/account workspace is
reset. `syncBusy()` is available for the shell's busy-state synchronization.
Read and detail replies capture the actor, project, generation and supplied
route key, so a late response cannot open a checkpoint over a different project
view or account. Modal reads also retain the same dialog element/body/open
state; closing or replacing that dialog invalidates an outstanding detail or
history page. A denied current list read clears prior rows and marker coverage.

`markers()` returns `{project_id, items, total, complete, filters}`. Each loaded
marker contains only the real `id`, `title`, `target_date`, `status` and `version`.
`complete` describes pagination coverage for the returned filters; it does not
claim that a filtered subset covers every project milestone. No timeline overlay
is implemented in this change. A later timeline caller must explicitly load the
desired range and account for pagination before drawing dated markers.

## Export and verification

Include these workspace-scoped persistent tables in the aggregate business
export: `nam_project_milestones` and `nam_project_milestone_events`. Events retain
the before/after state needed to recover cancelled or reopened checkpoints and
the command identity needed for deterministic retry.

`test/project-milestones-api.test.mjs` exercises the real TypeScript dispatcher
and PostgreSQL/RLS harness: participant privacy, direct-write denial, explicit
completion/cancellation/reopening, independent task/image/project state, retry
identity, stale versions, bounded date/status/search paging, malformed fields,
archive recovery, current grants/membership/session/MFA, and safe unavailable
responses. Fixtures are synthetic, isolated and never contact NAM's project.
`test/project-milestones-ui.test.mjs` executes the actual controller for dated
rows, explicit-date forms, draft/retry recovery, permitted conflict reloads,
versioned terminal transitions, marker coverage/paging, stale route replies,
delayed-read dialog closure/replacement, denied refreshes and in-flight controls.

Local controller checks and syntax validation are available using the bundled
Node runtime. PostgreSQL/TypeScript dependency-based execution, native browser
integration, shared UI routing, direct visual comparison and eventual timeline
markers require subsequent validation. No hosted migration, project data change,
notification, approval or deployment is performed by this source change.
