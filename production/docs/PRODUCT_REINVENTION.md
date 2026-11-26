# NAM OS: daily operating workspace

## Diagnosis and decisions — 24 November 2026

Baseline: `7f07fa7c88c82c87e58931cf15efc9c3c74d96c9`. Implementation branch: `codex/nam-os-reinvention`. The existing trial and `main` remain intact. Node 24, locked installation, TypeScript, all 292 local tests and the webpack production build passed. Seven HTTP checks verified the unconfigured application boundary. These are current local results, not evidence of hosted workflows.

The owner supplied Figma overview `19:2459` and Academy catalogue `19:3274` in file `xnMxoEBJXnriPYznIgivFb`. Figma is currently denied by the environment network policy; no claim of inspecting those frames is made. Repository design evidence specifies restrained monochrome surfaces, Inter, clear spacing and a persistent sidebar. The owner's latest brief takes precedence over older phased specifications. Staging is owner-protected, and this environment has no staging/Supabase credentials. Existing migrations 001–015 and data must be preserved. No reset, owner bootstrap, paid upgrade or change to the live trial is authorized by this checkpoint.

### What the current implementation gets right

- One shared task record with ownership, dates, checklists, comments, private attachments, history, optimistic versions and retry protection.
- Server-verified identity, live membership/session checks, explicit section grants and assigned-only task access. Managers do not automatically see colleagues' records.
- Password-only sign-in, including Founder, with MFA required only for accounts that elected a verified factor.
- Immutable Academy publications, pinned enrollments, individual progress and separate practical assessment.
- Read-only sales provider adapters with provenance/freshness. Attio stays the CRM; Apollo remains an external prospecting tool.

### Highest-impact problems

| Problem observed in source | Operational consequence | Implementation decision |
| --- | --- | --- |
| Overview shows four disconnected counters and the first six personal tasks; navigation replaces bootstrap tasks with a bounded personal page | Founder cannot see studio intervention needs; urgent work can fall beyond the first page | Replace the landing page with a role-scoped daily brief calculated across authorized records, grouped by attention, current work and upcoming deadlines. Counts and lists use the same server rules. |
| Every section is a primary navigation item and several repeat the task screen | People must choose a department before they can find work | Make Today, Work, Projects and Academy the main mental model. Preserve all existing routes and business capabilities; group supporting studio functions rather than deleting them. |
| Projects is explicitly tasks-only | No durable brief or deliverable grouping; artists reconstruct context through conversations | Add real project records and explicit project participants. Deliverables are the existing shared tasks linked to a project, with CGI production stages; no duplicate task owner, due date or completion record. Keep unlinked existing tasks intact. |
| Academy is a catalogue of equal-weight cards and a written lesson reader | New staff do not know what to continue or what a practical assessment still needs | Lead with the next unfinished assigned lesson and separate reading progress from assessment. Retain immutable publications and completion records. Add real private video upload and authenticated playback using existing Supabase Storage. |
| Default task filtering has no operational time views | Finding today's actions requires assembling filters | Add Today, Upcoming, Blocked and Completed views with server-side date rules, plus accessible quick actions. Keep list/board, detailed filters and conflict recovery. |
| Sales activity/reports live apart from attention | Founder must visit Sales to discover unreviewed reports | Surface authorized report-review work in the daily brief. Keep CRM facts in their source; do not fabricate a pipeline or provider connectivity. |
| Project deadlines, practical feedback and sales reports require separate visits | An artist or founder misses a next action after another person updates it | Connect project watch, source-report decisions and practical reviews to Today. Refresh on returning to Today; keep the artist's requested changes visible. |
| Report resubmission can race a Founder review | An older report can approve unseen new results | Review the exact submission timestamp under a row lock. Retain the trial's original RPC and add a checked path for the new application. Practical responses retain their existing optimistic revisions. |
| Public modules refresh Auth and their import graph starts after hydration | Eight concurrent users wait for avoidable network work | Keep page/API identity checks and all asset security headers; skip public-asset session refresh and preload the module graph without executing before the scaffold is ready. |
| Export allowlist predates project/video and learning-structure records | A business export omits operational context | Extend the explicit Founder-only allowlist to project, learning, grant and video metadata; keep Auth, credentials and media bytes outside JSON export. |

### Product boundaries

Projects have a concise shared brief, explicit participants and deliverables. A deliverable carries its own artist, task status, production stage, deadline, checklist, discussion and file history. Joining a project never broadens task access: assigned-only users still see only their tasks. Only a Founder manages the new project membership list; no existing employee permission is changed. An artist's access to a brief must be explicit, not inferred from a UUID in a task.

Academy videos use a private bucket, direct browser-to-Storage upload to avoid hosting request-size limits, verification of the stored bytes, publication-pinned references and authenticated range playback. No public bucket, public video URL, external video service or paid plan is introduced. Upload limits must fit the existing Free plan. Transcoding, automatic captions and native mobile installation are separate work; the interface must not imply they exist.

Deprioritize decorative charts, another CRM, automatic prospect outreach, complex dependencies, recurring-task automation and invented project/client data. Useful defaults, truthful empty/error states, clear context, keyboard behavior and measured response times come first.

## Execution and evidence

1. Audit and preserve the baseline; save this decision record.
2. Implement the daily brief, shared work views and production records, with database/API regressions.
3. Implement private Academy video and improve the actual learning workflow.
4. Refine shared layout, focus, loading and small-screen behavior using repeatable browser checks.
5. Record four distinct testing/refinement cycles: functional/data integrity; browser/interaction; measured performance/accessibility/eight-user isolation; full regression/release review. Keep simulated, isolated-provider and hosted results distinct.
6. Commit and push checkpoints on the separate branch. Do not merge or deploy over the current trial. Prepare delivery against existing free infrastructure when protected hosted access is supplied securely. No fresh-task restoration, hosted concurrency, production deployment or completed release gate is claimed without direct evidence.

These decisions have been implemented and exercised through four isolated correction cycles. Executed results, evidence boundaries and remaining hosted delivery gates are recorded in REINVENTION_VALIDATION.md.

## Implemented boundary and next priorities

The source implementation now covers the daily operating loop above, real production records and actual private learning media. Migrations 016–021 extend the existing database additively. Attention and today's current work are distinct groups; a future-dated render awaiting review remains discoverable through the same Attention filter. Browser evidence and the four local correction cycles are recorded separately in [REINVENTION_VALIDATION.md](REINVENTION_VALIDATION.md).

Keep the next expansion tied to observed studio use. Contextual Academy recommendations within projects, multi-course onboarding paths, richer render annotations and production sign-off gates need real standards/content and a verified delivery workflow. They are not represented as completed features. Do not generate a catalogue of invented NAM training content or duplicate CRM opportunities to make the product appear populated. Existing published learning and completion records remain authoritative.

Managers retain their existing explicit section grants and assigned-only task visibility. A future team-wide production-management permission is a separate owner decision. The current shared brief and task context improve coordination without silently broadening employee access.
