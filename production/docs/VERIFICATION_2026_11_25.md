# NAM OS reinvention verification — 25 November 2026

Status: candidate under refinement. The protected hosted trial is unchanged.
A successful build is not release acceptance.

## Product model and implemented changes

Today surfaces decisions, blockers and commitments before secondary summaries.
Work keeps one shared task record; Projects supplies its brief, accountable lead
and production stage. Standalone operational work remains valid. An unshared
project link does not expose its brief or silently detach an existing task.

Sales opens on next follow-ups, recorded outcomes, targets and weekly commitments.
Inactive sales staff remain visible with zero activity. Attio remains the CRM;
disconnected provider metrics are not reported as live. Academy opens on assigned
learning. Its authoring workspace edits one selected lesson, with separate course
details, practical work and publication/assignment. Private video recovery reuses
the reservation, preserves a selected file and distinguishes a verified save from
a failed subsequent refresh. Existing published versions and completion records
remain intact.

The responsive reader uses an expandable outline on smaller windows. Shared
spacing, typography, surfaces, focus and reduced-motion rules apply throughout.
Pending subtasks stay keyboard-focusable, acknowledge busy state and deduplicate
repeated actions. Task detail honors the most recent selection; delayed responses
cannot reopen a closed dialog or release another session's write guard.

## Executed evidence and findings

| Boundary | Reviewed source / run | Executed result |
| --- | --- | --- |
| Local unit/database/controller suite | candidate771b4b9 |353 passed,0failed/skipped |
| Linux TypeScript/tests/build |771b4b9 /45573163776 |Passed |
| Actual isolated provider + Chromium, eight identities |1690772 /45573430340 |21/24 passed,3failed,0skipped |
| Linux TypeScript/tests/build |03399dd /45581759790 |377 passed; TypeScript/build passed |
| Expanded actual provider + Chromium |03399dd /45581759998 |26/31 passed,5failed,0skipped/global errors |
| Diagnostic-only repeat |4a06b63 /45582898231 |Same26/31; not a separate quality cycle |
| Corrected local unit/database/controller suite |Working correction candidate |391 passed,0failed/skipped; TypeScript/build passed |
| Additive migration operator proofs |001–022 source |15 distinct proofs passed;1490 catalog records equivalent |

The initial native findings included an obsolete landing-heading assertion,
visibility of sales staff with no activity, and Escape during a pending child
save. Expanded testing found a module fixture with no actual modules (three
viewport failures) and a tablet Sales heading that could exceed its container.
The module tests now create and clean up their own real published course. The
Sales heading wraps and aligns controls to its content edge without concealing
overflow. Subtasks retain focus instead of becoming disabled outside the dialog.
Assertions for dismissal, persistence, draft recovery and permissions remain.

The next native run must verify these corrections, active-session grant/role
revocation, task-opening intent and opener focus. These added checks are pending
until an actual run records their results. Earlier successful performance,
private-video, optimistic-conflict and accessibility cases do not certify later
source automatically.

## Measurable acceptance

The bounded performance case uses eight managed identities over10000 synthetic
tasks:80 summary reads, eight independent writes,40 daily-brief queries, two
conflicting edits and eight concurrent signed-in browser workspaces. Targets are
p95 under2000ms for reads/brief/usable task navigation, under1000ms for a write
including context refresh, and summary responses under100000 bytes. One edit
must succeed and its competitor receive409; cross-user reads must be denied.
Only source-bound numeric aggregates may appear in retained CI evidence.

Responsive checks cover360,390,768,1024 and1440px plus a320px learning outline.
Task status, deadline and owner must remain visible and contained. Automated
WCAG2.2AA checks, reduced motion, native keyboard/focus behavior and failure
recovery run against the actual application. No claim of human usability
validation, sustained capacity or Internet latency follows from loopback tests.

## Direct rendered inspection

Native Chrome reviewed the production client with a clearly synthetic local
fixture, including desktop Today,390×844 learning and768px Sales. It exposed
the squeezed module heading and awkward wrapped Sales-action alignment; both
were corrected in source. The fixture does not prove Auth or persistent writes.
Actual managed-session verification is performed separately in disposable QA.

## Release gates

- Finish all affected native regressions; keep any failure a release blocker.
- Execute and document all four meaningful release/refinement cycles. Individual
  reruns and the earlier cloud report are not equivalent to hosted acceptance.
- Preserve a recoverable database and object backup before additive016–022.
  Never rerun the empty installer, reset or Founder bootstrap.
- Verify protected HTTPS runtime, exact callbacks, original-session enforcement,
  private uploads/range playback and installed desktop PWA behavior.
- Configure real provider credentials securely and reconcile records/ownership.
  No external tenant or entitlement has been verified by these fixtures.
- Complete longer-duration/load, recovery and final Founder/Sales workflows.
  No critical/high defect may remain at delivery.

GitHub is the durable source checkpoint. The private operator package is
preserved separately. No unobserved background development, production
deployment or complete release is implied.

## Verified correction and next regression

Candidate102fa0d / native run45586187655 passed all34 checks with zero
failures, skips or global errors. Linux CI45586187490 passed391 tests,
TypeScript and the production build. The exact merge tested was5cfc41ecd345b036f4d058f0d4ea7955b55ca465.

Source-bound loopback p95 results: summary reads147.04ms (80 samples), writes
including context refresh560.55ms (8), daily brief190.58ms (40), usable task
navigation1483.49ms (8); maximum summary67216 bytes. These passed the stated
bounded targets. They do not establish hosted latency or sustained capacity.

The follow-on candidate has396 passing local checks. Additional native
regressions cover suspended-account discovery/restoration and eight managed
learners completing, repeating and reopening lessons concurrently. Their actual
native execution remains pending. Internal operational diagnostics and account
configuration are retained privately rather than in this public evidence record.
