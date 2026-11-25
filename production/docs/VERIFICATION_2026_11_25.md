# NAM OS reinvention verification — 25 November 2026

Status: source candidate verified at1634e5c4d6fc5791f790ef1ff1eca1d23debfed5.
Production release acceptance remains open. Documentation-only updates do not
change the runtime source identified below.

## Implemented daily operating model

Today prioritizes decisions, blockers and commitments before secondary summaries.
Work keeps one shared task record; Projects supplies its brief, accountable lead,
authorized participants, production stage and deadline. Standalone work remains
valid, and an unshared project association is retained without revealing its brief.

Sales starts with follow-ups, recorded outcomes, targets and weekly commitments.
Zero-activity sales staff remain visible. Attio remains the CRM; provider metrics
are source-labelled and never described as live while disconnected.

Academy starts with assigned learning. Selected-lesson authoring separates
course details, practical work and Publish & people. Private video recovery
preserves the selected file and reservation, while immutable publications retain
previous content and completion history. Smaller readers use a legible expandable
outline. Shared spacing, type, surfaces, focus and reduced-motion rules apply.

Task detail respects the latest selection. Pending subtasks remain focusable,
deduplicate repeated actions and preserve unsaved notes. Delayed responses cannot
reopen closed dialogs or release another session's write guard. Founder member
administration retains suspended-account discovery and restoration.

## Executed correction record

| Review | Source / native run | Actual result and correction |
| --- | --- | --- |
| Functional review |1690772 /45573430340 |21/24; corrected landing assertion and zero-activity sales visibility; pending-save dismissal remained under review |
| Expanded visual/workflow review |03399dd /45581759998 |26/31; fixed module fixtures, tablet action wrapping and native pending-checkbox focus |
| Interaction/accessibility/performance verification |102fa0d /45586187655 |34/34 passed; fixes verified with eight real managed identities |
| Expanded final source regression |4df4672 /45588897211 |36/36 passed; added simultaneous learning and suspended-account restoration |
| Diagnostic-only repeat |4a06b63 /45582898231 |Repeated26/31; not counted as another quality cycle |
| Further craftsmanship review |701fa87 /45597184062 then1634e5c /45598630309 |44/45 initially; corrected a long-name tablet header overflow; expanded secondary-screen, dialog-focus and delayed-navigation verification now passes45/45 |

The final source passed409 automated unit/database/controller checks with zero
failures/skips, TypeScript and the optimized production build in Linux run
45598630358. Native run45598630309 has45 passes and zero failures, skips or global errors.
Exact native-tested merge:cffaee2fa26492740a2a6df9daab3f284a2597f5.
Safe artifact15014187990 digest:
sha256:63fc2f0b059937f5d7f2267a01bcff80b01245d82b4a83a92b20508f5f242675.

These are four documented source-review executions with meaningful corrections
and expanded coverage. They do not certify four completed hosted release cycles,
human usability validation or overall production readiness.

## Measured bounded load

Eight distinct managed identities operate over10000 synthetic tasks using the
actual PostgreSQL, GoTrue, PostgREST, Storage and Next.js application. The case
includes80 task-summary reads, eight independent writes,40 brief requests,
concurrent signed-in navigation and a contested update that must yield one200
and one409. Other owners' restricted records must remain unreadable.

| Measurement | Samples | Actual p95 | Acceptance target |
| --- | ---: | ---: | ---: |
| Summary read |80 |121.86ms |<2000ms |
| Write including context refresh |8 |461.06ms |<1000ms |
| Daily brief |40 |181.21ms |<2000ms |
| Usable task navigation, eight concurrent workspaces |8 |1440.18ms |<2000ms |
| Maximum task-summary payload |80 |67412bytes |<100000bytes |

Loopback bursts do not establish Internet latency, sustained capacity or a
production SLA. Timings use the first visible enabled task, not only a document
load event. Retained evidence contains source-bound numeric aggregates.

## Workflow and rendered coverage

Native tests cover managed sign-in, active-session grant/role revocation,
Founder/Sales/Artist boundaries, shared project context, stale edits, retained
drafts, repeated actions, checkbox recovery and keyboard navigation. Eight
learners complete repeated concurrent progress requests, reload their readers
and reopen one person's lesson without changing the other seven records.

Academy tests author, publish and assign actual courses, upload bytes to real
private Storage, verify historical publication isolation, play/seek ranged media
with captions and deny playback after revocation. Learning completion remains
self-reported; practical assessment is separate.

Responsive checks cover360/390/768/1024/1440px and320px learning. They inspect
actual layout geometry and visible task status/deadline/owner. Automated WCAG2.2AA
checks and reduced motion pass on tested screens. Direct native Chrome review
also exposed and corrected squeezed module headings and wrapped-action alignment
using a clearly synthetic local fixture. That fixture itself proves no persistence.

The additional craftsmanship pass verifies Settings, Team, Library and Operations
at320/390/768/1440px with long synthetic labels. It checks panel action containment,
non-overlapping controls, section separation, heading/action alignment, accessible
dialogs and keyboard focus restoration. Automated WCAG checks include these screens.

Direct rendered comparisons found and corrected Settings overflow at320px
(360px document reduced to320px), touching Settings panels (0px gap to24px),
and mobile heading/action misalignment (21.2px offset to0px). Long dialog titles
wrap within the Close control's content gutter; duplicate toolbar identity text
truncates at tablet width while preserving full names in the directory/sidebar.
No document or panel clipping is used to conceal overflow.

Navigation acknowledges the destination with its active link, title, heading and
accessible loading status while actual data is pending. Deferred HTTP browser
tests require acknowledgement below150ms, reject stale responses after a newer
destination, recover a safe503 through Retry, and allow a later Sales tab to
supersede an unresolved reporting tab. These pass against the actual application.
This is measured input feedback, not a claim of sub150ms Internet data loading.

This completed review used Apple's clarity, restrained feedback and predictable
control behavior; no Apple branding or proprietary assets are copied. Shared
spacing uses4/8/12/16/20/24/32px; control/panel radii10/16px; standard controls44px.
Central motion values are90/120/200ms with cubic-bezier(.2,.7,.2,1), where used;
reduced motion remains supported. No page fades or decorative loading motion
were introduced. Visual review does not establish subjective perfection.

The next redesign direction is Programa's actual application, using NAM branding
and independently implemented components. Preserve this tested runtime as the
functional baseline; reference collection precedes replacement of the visual
system. No Programa fidelity or implementation is claimed by this checkpoint.

## Open delivery gates

- Apply the reviewed additive backend update only after private backup/recovery
  preparation; verify preservation and protected HTTPS runtime behavior.
- Finish hosted functional/security regression, real provider reconciliation,
  longer-duration capacity and actual desktop PWA installation.
- Complete final Founder/Sales daily journeys and human feedback.
- Keep internal account configuration, private diagnostics, credentials, profiles,
  raw failures and business data out of this public evidence record.

No production deployment, live integration or unobserved background development
is implied by this source checkpoint.
