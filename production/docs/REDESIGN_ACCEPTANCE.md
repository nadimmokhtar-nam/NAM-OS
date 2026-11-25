# NAM OS redesign acceptance

25 November 2026. Programa's authenticated application remains the visual and
interaction reference. NAM uses its own branding, Newsreader headings and Inter
UI. A feature is accepted only after its real behavior, permissions and visual
comparison pass. Test counts alone do not establish completion.

Working branch: `nam-os/programa-fidelity-review-2026-11-25`.
Review: https://github.com/nadimmokhtar-nam/NAM-OS/pull/15.
The hosted application and tenant migrations have not been changed by this
continuation. All native test identities, project data and emails are disposable.

## Implemented foundation, with release verification still open

| Area | Present behavior | Acceptance still required |
| --- | --- | --- |
| Design system | Shared measured palette, Newsreader/Inter fonts, controls, borders, shadows, spacing, shell/sidebar and touch sizes. | Complete remaining controls, states and matching-size visual comparisons across all modules. |
| Authentication | Password/recovery/reset, invitations, session revocation, optional MFA, role/section access and separate guest sign-in. | Missing live reference screens, complete error/activation comparison and hosted email rehearsal. |
| Task workspaces | Shared task identity, List/Board, status groups, properties, priorities, dates, assignees, subtasks, comments, private files and linkable task pages. Calendar, server sorting, dependencies and completion-driven recurring successors are added in029. | Consolidated DB/API/native verification of029; final cross-module workflow and visual acceptance. |
| Projects | Real directory, contextual navigation, brief, lead, explicit participants, deadline, history and archive/restore. Private files/folders, references, pinboards and meeting notes are added in028. | Consolidated verification of all resource paths and participant/Founder boundaries; broader visual acceptance. |
| Production | Camera/deliverable inventory, ten production stages, assigned artists and linked central tasks. Real revision rounds and immutable final-file deliveries are added in033. | Consolidated revision/task/client delivery tests, animation media and complete production UX comparison. |
| Render review | Verified private JPEG/PNG uploads, immutable versions, comparison, pinned internal comments and recovery. | Finish inspector interactions and broader responsive/visual review. |
| Client review | Explicit guest access, issued immutable images, view-only/decision permissions, optional original downloads, version-specific Accept/Reject events and revocation. | Hosted email configuration/rehearsal and final populated-reference comparison. |
| Project planning | Shared client/type/location/start/end context, deliberate private covers, permission-bound overview metrics and independently versioned phases/timeline. Explicit dated milestones with retained status/history are added in034. | Current desktop/mobile native verification, milestone DB/API checks and captures, then direct visual comparison. |
| Academy | Authored lessons/modules/resources, immutable course publications, enrollments, progress/completion, practical submissions/review and private video. Structured paths and the requested topic taxonomy are added in030. | Consolidated path/publication/progress verification; NAM's actual authored curriculum/resources and final workflow/design acceptance. |
| Sales | Assigned sales work, activity ledger, reports, targets and source-labelled provider adapters.031 adds company/contact/lead/opportunity views, linked central follow-ups, revenue objectives and mapped current-snapshot forecasts. | Consolidated verification, live provider credentials/owner mappings and reconciliation. Historical funnel conversion remains unavailable without history. |
| Administration | Member directory, invitations, section/create grants, account/session/MFA controls and business export.032 adds departments, professional profiles and supported inbox preferences. | Consolidated profile/department/preference and export verification; final settings comparison. |
| Distribution | Existing Next/Supabase architecture and installation/PWA support retained. | Hosted migration/release rehearsal; native macOS/Windows packaging remains a separate release item. |

## Remaining production scope

New migrations028–034 and their browser controllers are an unaccepted development
batch until consolidated source, database, API and native browser checks pass.
Private resource reads and downloads, real cross-module task handoffs, retained
issued files and current authorization require behavioral verification. Existing
native tests do not imply new workflows have been exercised. Animation review
and optional bulk delivery ZIP packaging are not part of the current JPEG/PNG
render pipeline.

Home still needs announcements and a complete role-by-role acceptance pass for
projects, deadlines, activity, approvals, quick actions and meaningful indicators.
The remaining Tasks, Academy, Sales, Team and Settings requirements above must be
verified individually against the original brief. Existing functions should be
extended rather than replaced or duplicated.

Attio remains the CRM source of truth. Lemlist, Attio and JustCall app credentials
and tenant mappings are not established by a connected ChatGPT account. Unavailable
provider figures must remain unavailable until verified; manual activity is
separate from provider metrics. No real client messages or invitations are sent
without the user's instruction.

## Evidence and release gates

Current implementation commits and exact CI/native workflow results are tracked
in PR 15. Local source is reconciled to the GitHub branch with Git blob hashes;
the workspace is a source copy rather than a complete CLI Git checkout. Local
browser/UI cases run through the bundled Node runtime. Full TypeScript, native
PostgreSQL/provider, build and browser checks run in isolated GitHub CI.

Known verification failures must be resolved before acceptance. A failed provider
image download is an environment startup failure, not a passing application test.
Interrupted or partially passing native runs do not establish a complete pass.

Before a hosted release: apply the reviewed additive migrations, preserve all
existing tenant relationships, configure the verified Auth sender and redirect
destinations, validate integrations, rehearse migration/recovery and review the
application at matching desktop/mobile sizes. Keep the existing main branch and
host unchanged until that concrete release is ready for review.
