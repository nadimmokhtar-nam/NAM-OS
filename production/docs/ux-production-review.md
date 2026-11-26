> Historical checkpoint. Current implementation and executed reinvention checks are in [REINVENTION_VALIDATION.md](REINVENTION_VALIDATION.md). The owner’s latest requirements and migration 015 permit password-only Founder sign-in; verified authenticator enrollment is optional. Earlier feature/assurance statements below describe their recorded revision.

# Production UX and interface contract review

24 November 2026. Scope: the real production browser modules, route/data contracts and approved visual specification. This independent review executes application source with simulated document/HTTP boundaries and inspects schema/API compatibility. It does not certify native layout, accessibility, live integration data or a complete testing round.

## Consequential findings and corrections

| Finding | Correction | Evidence/status |
| --- | --- | --- |
| Projects/Library navigation fetched unsupported record endpoints and implied working brief/resource catalogues | Both sections now open the shared functional task workspace, with explicit record/asset scope limits | Actual-source navigation tests verify task queries, working task controls and no unsupported requests |
| Sales accountability used a latest-500 activity array as an all-time total and target progress source | Summary uses authoritative activity totals; targets use matching owner/type/month buckets; activity window is labelled | VM tests use >500 records, multiple owners/months and unavailable/invalid aggregates |
| Target form hardcoded sample owner ID and excluded Sales Manager | Uses actual eligible account identifiers, includes Sales Manager and selects an existing sales account | Actual rendered selector verified |
| Session expiry with a non-JSON response did not clear protected UI; old response bodies could complete after sign-out | 401 handling clears state/redirects, sign-out aborts outstanding requests and active identity/controller is checked before and after response parsing | Tests delay both headers and body completion across logout |
| Pending/deleting attachments looked downloadable; UI could announce success without ready/remove confirmation | Explicit readable states, download only when ready and cleanup-free, permitted uploader/founder recovery controls, safe refresh and confirmed-success checks | Eight attachment factory tests cover state rendering, ownership, retries, failure messages and escaped names |
| Unsaved course lesson/resource modal input could disappear on Close or Escape | Shared modal snapshots editable controls and confirms dirty close; readonly/disabled/hidden/button values excluded; programmatic close after save remains unblocked | Actual-source tests cover refused Close/Escape, allowed close and sensitive snapshot behavior |
| Inline course metadata could be lost on logout or page close | Academy owner retains per-course in-memory drafts; shared UI confirms deliberate logout and warns on unload only for unsaved work | Tests use the actual Academy input-capture/helper: cancel sends no logout request, accepted logout resets drafts, expiry/unmount clears private work without a prompt |
| Course module/resource hook needed verification after authoring expansion | Learner outline renders escaped module headings; lesson view includes course-wide and current-lesson published resource links | Actual imported Academy factory used; three lessons/two modules and hostile text checked |
| Task detail query selected nonexistent attachment `size` column while schema defined `byte_size` | Release lead corrected selection and DTO mapping, including pending/deleting states | Current source inspected after correction; backend route/real database regression belongs to the release lead |
| Security screen implied detailed active-session history/expiry despite unavailable provider data | Security owner now renders provider session-reporting limitations explicitly | Current source inspected; real account interaction remains a browser gate |

## Verification checkpoint

Command from the production folder:

```sh
node --test test/ui-contract.test.mjs test/attachments-ui.test.mjs
```

Recorded result: **26 passed, 0 failed** — 18 workspace contracts and 8 attachment contracts. The harness executes the actual production application and actual imported factories. It simulates DOM/HTTP boundaries, so no browser-layout, native file-picker, Storage/RLS, screen-reader or live-provider pass is implied.

One intermediate assertion incorrectly searched for the word “password” anywhere in a serialized snapshot, matching the field name. It was corrected to assert boolean values and absence of raw secret content. This was a test assertion correction, not an application defect or a separate round.

Modal draft snapshots are weakly referenced. Password/OTP values are represented only by boolean presence, with a separate weak edit marker; raw secret text is not copied into the snapshot. Successful module save can still call the normal programmatic dialog close without a discard prompt.

## Approved design consistency

Source retains the approved #F1F1F1 canvas, #FDFDFD panels and #DEDEDE borders; 24 px main panel radius; 32 px headings and 14 px base UI text; 240 px desktop sidebar, 72 px header and 24 px horizontal content padding. Existing responsive breakpoints and restrained outlines remain. This review made no decorative redesign or CSS changes.

The CSS declares Inter but, at the time of review, no font asset, `@font-face` or Next font loader was present. System fallback can alter line wrapping and alignment; deterministic font loading and native visual inspection belong to the UI owner. Actual loaded-font and viewport verification is still required.

## Remaining checks

- Native desktop/tablet/mobile alignment, keyboard/focus behavior, zoom, error/empty/loading states and assistive technology.
- Native browser verification of retained inline Academy drafts, logout/unload prompts and safe recovery from a stale base revision; in-memory drafts deliberately clear on session expiry/unmount.
- Real task/attachment/download behavior against the assembled hosted database and Storage policies.
- Manual activity/report/target editing, retry semantics and all later record flows against the agreed current release boundary.
- Provider-authenticated reconciliation, account/session/recovery flows, deployed load and database/file restore.

Four full project testing/correction rounds remain a separate release gate. These focused checks contribute evidence; they do not make the website complete or production-ready.
