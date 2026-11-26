# NAM OS daily operating model

Implementation checkpoint: 25 November 2026. This branch is a reviewed candidate;
the existing hosted trial is preserved until staged migration and runtime checks.

## Decisions that shape the product

NAM OS organizes commitments around an accountable person and the context they
need to act. Today answers what needs attention; Work holds the shared task
records; Projects supplies the brief and delivery context; Academy supplies the
methods and reviewed practical learning. Sales opens on next conversations and
outcomes, with connected reporting kept available and source-labelled.

A project is a shared brief with explicitly authorized participants. Its work
keeps one owner, status, production stage and deadline. The same task appears in
Today, Work and the project, so users do not enter progress twice. Existing
standalone work remains valid. Reading a project brief does not expand task
visibility or confer management privileges.

The Founder sees decisions, overdue work, blockers and review requests before
secondary summaries. An artist sees assigned work and shared context. Sales
staff see follow-ups, outcomes, targets and weekly commitments; Attio remains the
CRM. Academy starts with assigned learning and keeps completion separate from
practical assessment. No module invents operational records to fill an empty view.

## Corrections in this checkpoint

- Put attention before production summaries; bound secondary previews and reduce
  repeated framing. Preserve reachable complete lists and explicit empty states.
- Make the Sales landing view actionable. Load provider reporting when requested;
  retain complete authoritative monthly activity aggregates and source freshness.
- Load project controls when changing a global task's section. Preserve existing
  standalone and unshared associations; offer participant-aware assignment choices.
- Include non-lead project participants in their daily project view without
  exposing membership lists. Exclude canceled work from completion denominators.
- Keep assigned learning available when navigating directly from Work to Today.
- Reuse acknowledged task detail and refresh independent summaries concurrently;
  remove a redundant Auth user fetch without caching identity between requests.
- Preserve keyboard focus after checkbox success/failure while respecting focus
  moved by the user. Retain draft, stale-write and original-session protections.
- Recover video uploads using one reservation, renewed capabilities and explicit
  stale-course recovery. Never report a failed refresh as a failed verified upload.
- Consolidate interaction and layout tokens, increase operational text legibility,
  preserve mobile ownership context and honor reduced motion.

## Acceptance and boundaries

The source checks cover actual PostgreSQL/RLS behavior and production JavaScript
under controlled HTTP/DOM boundaries. A separate Ubuntu workflow runs the real
provider software, eight managed identities, native Chromium, accessibility rules
and a bounded 10,000-task scenario. Its private profiles and failure artifacts
stay outside Git; only bounded status counts are retained.

Before deployment, verify the exact candidate source, pending migrations, a safe
rollback/backup, protected HTTPS callbacks, Auth, private uploads and ranged media.
Local build/test success does not establish hosted behavior or complete the four
release cycles. Native installation, real provider reconciliation, long-duration
capacity and full database/object recovery retain explicit release gates.

Further expansion should be justified by observed work: distinguish actual image
deliverables from supporting production tasks, add reviewable practical artifacts,
persist version-specific learning position and safely reclaim abandoned media.
These capabilities are not represented as implemented by this checkpoint.
