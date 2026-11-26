# Home announcements and role-specific pointers

Implemented 25 November 2026. Home keeps the existing `renderDaily` overview and `nam_daily_brief` unchanged. The extension adds persisted studio announcements and small links into real Sales, project/image, client-review and Academy records. No sample announcements or invented KPI values are seeded.

## Records and access

Migration `202611250036_home_announcements.sql` adds:

| Table | Purpose | Read access |
| --- | --- | --- |
| `nam_home_announcements` | Title, plain-text message, role audience, inclusive start/end dates, archive state, revision and attribution | Current active NAM members with a live session and any elected MFA verified; ordinary readers see only applicable current announcements |
| `nam_home_announcement_events` | Immutable revision history with actor, operation and before/after record snapshots | Founder only |
| `nam_home_announcement_requests` | Private normalized command and original result for exact retries | No direct authenticated or service-role table access |

An empty `audience_roles` array addresses all active NAM roles. A nonempty array addresses only its exact roles: `founder`, `sales_manager`, `sales`, `production_manager`, `artist`, `freelancer`. It never grants a section, project, course, task or client permission. A studio member with no section grants can still read an applicable announcement. Client-only identities and foreign/inactive memberships cannot read it.

Dates follow the studio’s Europe/Paris date. Both endpoints of an announcement’s date window are inclusive; a null end date remains open-ended. Future, expired and archived announcements stay out of ordinary Home reads. Founder management is explicit and can inspect all states, including role-specific updates not addressed to the Founder. Ordinary direct PostgreSQL reads enforce the same audience/date/archive conditions through RLS. History is Founder-only because earlier revisions may have had another audience.

Only the Founder can create, edit, archive or restore. The server accepts only supported fields, validates real calendar dates and role audiences, and requires an expected revision plus an `Idempotency-Key`. New records use expected revision `0`. Updates use the exact current positive revision. Every accepted command has one durable result and one history event; an exact retry returns the original result even after another edit. Reusing its key for a different normalized command or saving a stale revision returns a conflict.

Mutation RPCs lock the original membership, account and session rows and recheck live assurance before applying or replaying the command. The shared route retains its session/origin/CSRF controls. The handler rechecks live context after request-body reads before writes, and after successful page/context/history reads before returning a response. It also compares the current database role with the captured actor role so a changed audience role cannot receive the former role’s page. This preserves the application’s existing elected-MFA policy.

Announcements are plain text, escaped in every public and management view. Date ranges are limited to 1900–2200. Direct business-table writes are not granted. There are no emails, external messages, schedules or provider credentials associated with this feature.

## Role-specific Home pointers

| Pointer | Real source and scope |
| --- | --- |
| Next decision | Existing daily-brief review totals and a permitted Sales report/Academy submission ID; complete totals are used instead of capped preview lengths |
| Client reviews | Existing `nam_client_review_requests` records with `status='issued'` and `purpose='review'`, excluding archived projects; Founder studio scope only |
| Sales day | The actual actor’s manually logged weekly activity row from the existing brief; otherwise a link without a fabricated count |
| Image work | Existing permitted `nam_deliverables` inventory, grouped by actual review/revision stages, with up to three permitted image links |
| Learning | An actual assigned, incomplete course from the existing bootstrap, or a link to assigned learning |

`nam_home_work_context` is a read-only security-invoker query. Existing project/image/client RLS remains authoritative. It counts all permitted matching records and returns small preview lists separately. Founder personal scope includes only their assigned/linked image work; client-review totals appear only in Founder studio scope. Sections without access return unavailable context rather than inferred zeroes.

Image inventory counts are not task counts or approvals. Issued client-review requests are not unanswered-image counts or client acceptance rates. CRM/provider figures are not synthesized for Home. The current daily task, review, workload and learning data keeps its existing meaning and permissions.

## Root integration

No bootstrap schema change is required. Add `dispatchHomeAnnouncements` to the shared dispatcher and load `home-announcements.css` alongside workspace styles.

```js
const homeAnnouncements = createHomeAnnouncements({
  request: (...args) => api(...args),
  getData: () => state.data,
  openDialog,
  closeDialog: () => dialog.close(),
  render: () => render(),
  toast,
  onBusy: () => syncTaskBusy(),
  canLeave: () => !dirtyDialog() || confirm('Discard your unsaved changes?'),
  contextKey: () => state.routeVersion + ':' + state.view
});

function overview() {
  return homeAnnouncements.inject(renderDaily({
    data: state.data, taskRows, newTaskButton, icon
  }));
}
```

`inject` preserves the original overview markup: role pointers appear before its existing metrics, and announcements appear first in the existing Studio context aside. Standalone `render()` is also available. The feed loads three real announcements per request and offers Load more. Founder management uses 20-record pages; history uses 25-record pages.

- Call `load()` on overview entry and after the existing daily-brief refresh/scope switch.
- Call `reset()` when the session, actor, role or effective access changes.
- Include `isSaving()` in the shared close/navigation/logout busy guard. `syncBusy()` can reapply disabled controls after rendering.
- Use `canLeave()` for `form[data-home-form]` on close, native cancel and navigation; avoid also issuing the generic draft prompt for that same form.
- Existing generic dialog draft tracking covers normal edits. Include `hasUnsavedChanges()` to cover an uncertain save result, and call `discardUnsavedChanges()` only after a confirmed discard.

Pending writes freeze their controls. An uncertain network/server result keeps the original body and retry key immutable, exposes Retry original change, and allows a deliberate reload/discard. Delayed management/history reads retain a same-dialog body/open witness and close invalidation, so they cannot reopen a dismissed dialog or replace a different record.

## API

| Method/path | Action |
| --- | --- |
| `GET /api/home/announcements?scope=mine&limit=3&offset=0` | Current audience/date-filtered announcements and permitted supplemental context |
| `GET /api/home/announcements?mode=manage&state=all&limit=20&offset=0` | Founder management; states: all, current, scheduled, expired, archived |
| `POST /api/home/announcements` | Founder create with `{expectedVersion:0, changes:{title,body,audience_roles,starts_on,ends_on}}` |
| `PATCH /api/home/announcements/:id` | Founder supported-field edit/archive/restore with exact positive expected version |
| `GET /api/home/announcements/:id/history?offset=0` | Founder revision history |

Unknown and duplicate query parameters are rejected. Read sizes are bounded to 50. Request retries/history are separate from record pages and are never presented as new posts or duplicate audit events.

## Verification and release status

Locally verified with the bundled Node runtime:

| Suite | Result |
| --- | --- |
| `test/home-announcements.test.mjs` | 11/11 passed: escaped saved content, role/scoped real counts, unchanged overview, late actor/reset responses, dismissed/replaced-dialog reads, exact uncertain retries and CSP |
| `test/home-announcements-api.test.mjs` | 7/7 passed: actual TypeScript handler after Node type erasure, bounded/duplicate filter rejection, supported writes, Founder authority, slow-body revocation, error mapping and post-read liveness checks |
| JavaScript syntax checks | Passed |

`test/home-announcements-db.test.mjs` adds real PostgreSQL/RLS scenarios for current/date/role visibility, section independence, tenant denial, live sessions/elected MFA, CAS/exact retries/history/archive, invalid input rollback, source-pointer RLS and personal/studio scopes. It also runs the actual handler against PostgreSQL, revoking sessions, electing MFA and changing audience roles after successful source reads. This suite requires the CI PGlite/TypeScript dependencies and has not been run in the local dependency-free workspace.

Run in the release test environment:

```sh
node --test test/home-announcements.test.mjs test/home-announcements-api.test.mjs test/home-announcements-db.test.mjs
```

Business export migration 035 pre-allows the two Home business tables after 036 is applied and excludes private retry-command rows. Its export regression exercises archived announcement content/history when 036 exists. Release still requires the root typecheck, PostgreSQL execution, integrated browser/accessibility/layout checks and hosted staging gates. No migration, deployment, GitHub operation or external message is performed by this extension.
