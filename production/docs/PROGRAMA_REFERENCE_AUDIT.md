# NAM OS — Programa reference and recovery audit

25 November 2026. This checkpoint records recovery, reference evidence and the
remaining implementation. It does not establish redesign or release acceptance.

## Implementation continuation

The next increment adds a real project camera/deliverable inventory, linked
existing tasks and all ten production stages. Its additive schema, access rules,
interaction behavior and remaining render-review scope are documented in
`PROJECT_DELIVERABLES.md`. Local UI/navigation checks pass 130 cases. The new
schema, server endpoints and browser workflows are awaiting complete CI and
isolated-provider verification; no hosted migration or deployment has occurred.

The user authorized a different display font on 25 November 2026. NAM now selects
Newsreader for editorial headings, paired with the existing Inter UI face.
Newsreader's normal variable Latin/Latin Extended files and OFL licence are
self-hosted; automatic optical sizing follows the existing 24px/30px headings.
This replaces the Times fallback and removes the need to acquire Rhymes Display.
Font provenance is recorded in `public/fonts/README.md`. Programa remains the
layout, density and interaction reference. The authenticated session was reopened
successfully; current task controls were inspected without changing records.

The continuation now implements linkable task workspaces through the existing
authorized task API. Task pages retain the sidebar, use a nonmodal native surface,
keep the underlying list out of the focus/accessibility tree, and support direct
URLs, reload and browser Back/Forward. Unsaved-change and save-in-progress guards
also cover sidebar navigation. Existing task forms, versions, comments, subtasks
and private-file behavior are reused.

Project navigation now replaces the global module links while inside a project.
The header provides a Back action and an authorized project switcher. Shared
desktop actions/pills use the measured 28px size, warm control surfaces and subtle
elevation; mobile controls keep 44px touch targets. Task properties use a fixed
400px desktop rail. Mobile comments precede the properties/files area.

The shared task list now groups the existing records by their authoritative
status. All six NAM statuses remain visible when populated, including Backlog and
Canceled. Group creation actions use the existing permission checks and create
records with that group's status. The 720px groups, 44px warm headers and 46px
rows follow the live reference; counts describe loaded records and the existing
pagination total remains separate.

The updated local source passes 138 existing/new source checks, including the
upload recovery suite. Upload timing checks now await transfer/refresh signals
instead of counting event-loop cycles; cancellation assertions remain intact.
New disposable-provider browser coverage checks real task routing, native nonmodal behavior,
400px geometry, mobile reading order, unsaved navigation and denied task links.
The font/task-workspace baseline at commit `1b60f76` passes TypeScript, all 446
source/database checks, the production build and all 58 native-provider browser
scenarios. This covers Back/Forward, direct URLs, native nonmodal behavior,
measured desktop geometry, mobile reading order and denied task links. Grouped
rows omit duplicate status badges, and geometry checks require their shared
status header to remain visible. Direct visual review remains pending. These
baseline results do not establish the newly added image inventory's verification.

Task navigation clears the old page synchronously and consumes its deferred
native close without invalidating the new request. A source regression case and
the passing native Back/Forward case cover that order. Keyboard and cross-module
browser checks use the nonmodal task page and Back-to-projects navigation. The
earlier UI differences and execution limits below describe the recovered baseline.

## Authoritative acceptance brief

Programa's actual application is the single visual, experiential and interaction
reference: https://programa.design/ and its linked application. Implement NAM's
branding and independent components while preserving existing working logic,
data, authentication, permissions and database relationships. Quality and fidelity
take priority over speed; a conceptual dashboard or generic SaaS restyling fails.

Centralize colour, type, spacing, radiuses, shadows, dimensions, icons, states,
timings and breakpoints. Match the reference's composition, density, warm neutral
palette, borders, typography, controls, navigation, tables and tactile detail.
Avoid excessive rounding, gradients, accent colours, oversized headings,
decorative containers and whitespace that reduces usability.

| Module | Acceptance scope |
| --- | --- |
| Home | Role/permission-sensitive projects, assigned work, deadlines, activity, pending approvals, announcements, quick actions and relevant indicators. |
| Projects | Reference-like directory, project sidebar and management workflow; overview, clients, team, timeline, deliverables/camera lists, artists, stages, internal/client feedback, revision rounds, approvals, references/mood boards, documents/files, meetings and history. |
| Production | Briefing, Modelling, Camera approval, Materials and lighting, Draft production, Internal review, Client review, Revisions, Final approval and Delivery. |
| Tasks | Personal/team/project/recurring tasks; priorities, deadlines, assignees, subtasks, dependencies, comments/files; List/Board/Calendar; sorting/filters. Project and central views use the same records. |
| Academy | Library, paths, interior/exterior, lighting/composition, materials/texturing, post-production, AI, NAM quality standards/SOPs and onboarding; video, written lessons, downloads, progress and completion. Editorial presentation within the shared system. |
| Sales | Leads, companies, contacts, pipeline/opportunities, follow-ups, work/meetings, campaign/person performance, revenue targets/forecasting, conversions and outreach. Preserve Attio/Lemlist/JustCall plans and source attribution. |
| Team/settings | Directory, profiles, roles/permissions, invitations, departments, access, account/integration settings and notification preferences. |
| Authentication | Login, recovery, reset, invitation acceptance, activation and errors, with Programa's proportions and interaction quality. |

Follow the user's sequence: reference analysis → shared design system →
authentication/shell/navigation/Home → project management → remaining modules →
functional and visual QA. Keep Next/Supabase/GitHub/Vercel compatibility and
eventual macOS/Windows distribution. The current Netlify host remains part of the
existing architecture. Completion requires working features and direct visual
comparison; test counts alone do not establish fidelity.

## Recovered working source

- Repository: `nadimmokhtar-nam/NAM-OS`; application directory: `production/`.
- Starting branch: `nam-os/programa-redesign`.
- Starting commit: `1c6ac26612606376ed6e19c2c10993d49edcf4ae`.
- Starting tree: `f40ee15820d673511b8b8db21f6b9a40c91a52c9`.
- Current continuation branch: `nam-os/programa-fidelity-review-2026-11-25`.
- Current draft review: https://github.com/nadimmokhtar-nam/NAM-OS/pull/15.
- The earlier continuation branch and closed PR 14 are superseded by that draft.
- All 252 tracked files were restored locally. Each file's bytes were verified
  against its Git blob SHA before writing.

The current local folder is a verified source copy, not a complete Git checkout.
The continuation branch exists on GitHub. The old computer's Git metadata,
dependencies, ignored files, credentials and possible unpushed edits are not part
of this recovery. Inspect and reconcile an original working copy before replacing
it. The saved development guide identifies the former cloud checkout as
`/workspace/NAM-OS`.

## Actual application study

The current browser already had an authenticated Programa session. These screens
were inspected directly; no records, approvals or invitations were submitted.
Private account identifiers, client artwork and signed links are excluded from
these public repository notes.

| Reference | Live evidence |
| --- | --- |
| Project directory | Compact title/actions, All/Archived pills, Grid/List menu, landscape thumbnails and unboxed captions. Empty Archived view. |
| Project overview | Project sidebar replaces studio navigation; brief, status/date chips, people, cover image, summary strip and recent files. |
| Task List | Status groups in centered 720px sections; task links 46px high. |
| Product details | Live populated item drawer measured at 480px, 8px viewport inset, Inter title and 32px/13px/500 tabs for Summary, Financial, Procurement, Attachments and Activity. Underlying schedule remains visible alongside it. No item values or status were changed. |
| Task Board | Warm column wells, 280px task links, subtle card edges, phase labels, subtask counts and bottom Add Task controls. |
| Timeline | Project/phase rows, date scale, Today marker and Month/Quarter/Year controls. |
| Task detail | Full workspace page, retained project navigation/breadcrumb, title/description, subtasks/comments, and a fixed 400px properties/files rail. |
| Task detail at 390px | Sidebar concealed; title/subtasks/comments precede the stacked properties area. An 8px outer inset remains. |
| Home | Date and serif greeting on the current Pulse landing. This initial account state does not establish a populated role-specific NAM dashboard layout. |
| Schedule data | Classic and compact List modes; search, filters, field visibility, grouping and sorting. List rows 48px high with 2px gaps. |
| Client dashboard | Owner preview of project overview, action items and timeline. Action items were empty. |
| Approvals | A 560px right drawer with 8px inset, Outstanding/History tabs, scope control and empty state. |
| Mood boards/presentations | Sectioned imagery in project/files context; presentation canvas/rulers, compact tools and floating add/pin control. |
| Settings/team | Dedicated settings sidebar, compact personal inputs, team rows and invitation action. |
| Notification preferences | Named task/comment events, checkboxes, separators and Save. |
| Menus/search | Account settings/invite/appearance menu; scoped command search, recent destinations and keyboard guidance. |
| Modal forms/date picker | Large inset project/team forms with fixed action footer; anchored two-month date grid. Forms were cancelled. |

Desktop measurements used 1440 × 1000; the default also exposed 1280px geometry.
Mobile task geometry used 390 × 844. Temporary viewport changes were reset.
Project Grid, task List and schedule Classic preferences were restored.

[Measured values](PROGRAMA_REFERENCE_MEASUREMENTS.json) are implementation inputs,
not a claim that NAM already matches them. Inter/InterVariable is the reference UI
face; Rhymes Display is the reference page-heading face. NAM's approved adaptation
uses Newsreader for headings and retains Inter for the UI. The reference names are
kept in the measurement record. Do not redistribute Programa's fonts, branding or
imagery.

Remaining evidence: invitation/activation/reset-error screens, populated client
decision/history and notification-inbox states, hover/transition recordings,
tablet and broader mobile coverage, and deliberate network/server error flows.
The previous login/recovery measurements are inherited; this session redirects
sign-in into the application. Request actual missing references rather than
inventing those interfaces. Navigation/panel loading states were observed, but
reference error behavior was not deliberately triggered.

## Existing implementation and functional gaps

The source uses Next.js 16, React 19, Node 24 and Supabase. A React scaffold mounts
imperative workspace modules. Preserve the bridge, server APIs and database/RLS
boundaries while changing presentation.

Existing working source includes password/recovery, managed sessions and optional
MFA; explicit section/create grants and assigned-only work; project briefs,
participants/deadlines/references/events/archive; shared task identity, owners,
statuses, dates, comments/checklists/private files, paging, version conflicts and
retry protection; course/module authoring, immutable publications/enrollments,
progress and private video; sales activity/reports/targets and provider interfaces;
team/invitation/security administration and PWA installation affordances.

The current numbered migrations include 001–023. Live hosted migration state was
not checked. Existing schema/API relationships and tenant data must be preserved.
Current source stages are Brief, Modelling, Materials, Lighting, Internal review,
Client review, Revisions and Delivery. Add requested stage support without
invalidating historical records.

Revision rounds, render assets/versions and image approval decisions need real
production workflows. A Done task is not an approved image. Small private task
attachments are not a render-review system. Project milestones, camera/deliverable
types, recurring/dependent work and calendar views also need implementation or
explicit verification, rather than decorative tabs. Academy paths/catalog and the
full requested CRM/forecast scope require a feature-by-feature completion pass.

Attio remains the CRM source of truth. App credentials and tenant reconciliation
for Attio, Lemlist and JustCall have not been verified by this recovery. Preserve
source/freshness/unavailable states; a connected ChatGPT service does not supply
an application credential or make provider metrics live.

The current styling enters through `app/design-tokens.css`, `app/styles.css` and
`public/workspace.css`; `public/styles.css` is a legacy copy. A partial Programa
system and project navigation already exist. The earlier note that no Programa
UI had been implemented is historical.

At recovery, measured differences included NAM's 32px generic controls versus Programa's 28px
small actions; pill and menu-elevation differences; modal task detail that hides
project navigation; a proportional properties rail instead of 400px; and mobile
properties appearing before comments. The continuation above addresses those
structural differences; direct visual acceptance remains open.

## Recovery verification and execution limits (before continuation)

Node 24.22.3 ran six existing suites successfully: **114/114** checks for the
workspace bridge, project workspace, private attachment UI, security UI, access
UI and UI contracts. These exercise routing, stale replies, draft/focus retention
and permission-sensitive rendering.

```sh
node --test --test-concurrency=2 \
  test/bridge.test.mjs test/project-workspace.test.mjs \
  test/attachments-ui.test.mjs test/security-ui.test.mjs \
  test/access-ui.test.mjs test/ui-contract.test.mjs
```

An attempted API suite stopped because `typescript` is not installed. npm
dependencies are missing, and a read-only registry check failed DNS resolution.
At that recovery checkpoint, the full TypeScript/PostgreSQL/RLS suites, Next build
and isolated multi-user browser QA had not been rerun. The continuation now uses
GitHub CI for those checks. Earlier 435-check/56-workflow reports remain historical
evidence. No hosted release has been made by this continuation.

## Remaining work

Keep the continuation branch and reconcile any unpushed work from the original
computer. The full baseline runs in GitHub CI while local dependency access is
unavailable. Read the relevant installed Next.js guide as required by `AGENTS.md`
before changing Next APIs; the matching official v16.4.6 SPA/CSS documentation was
read for this continuation.

Complete missing references and direct typography review; finish the shared
tokens/primitives; implement and compare one connected authentication/shell/project/
task flow at matching desktop/mobile sizes; extend the remaining modules and
additive production models; complete functional, permissions, accessibility,
integration, responsive and visual acceptance before release.
