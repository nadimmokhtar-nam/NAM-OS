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

This is an implementation plan, not a claim that these changes or four testing cycles are complete. Results and remaining release gates will be recorded as the work executes.
