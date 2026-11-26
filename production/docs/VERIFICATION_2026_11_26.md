# Verification checkpoint — 26 November 2026

This batch follows review commit `2a2b31722e50b8f8b1689533effd53b68b4ee56a`.
The application remains on its separate redesign branch and draft PR15.

## Corrected behavior

- Ordinary task updates and dependency checks use the requested task identity
  unambiguously. Public RPC argument names, CAS and existing access checks remain.
- Learning-path commands separate SQL aliases from command state, retain exact
  receipts and pin the current account/session before blocking business locks.
  Founder assurance is rechecked before writes and acknowledgments.
- Closed phase drawers and render viewers respect the native dialog open state.
- Account security remains under Settings → Account & access, with restored
  spacing. Browser checks navigate that tab before testing the original controls.
- Tests preserve date-only comparisons, original pre-migration values plus new
  defaults, paged response compatibility and the actual daily review queue.
  Programa tests retain primary failures when cleanup also fails.

## Local evidence

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Complete source/database/API suite | 755 passed; zero failed or skipped |
| Additional concurrency-runner contracts | 9 passed; zero failed or skipped |
| Production build | Passed; release `build-fa1b14f7000ab7e0` |
| Browser discovery | 88 scenarios in29 files compile and are discovered |
| Diff whitespace validation | Passed |

Database suites execute real PostgreSQL through PGlite with explicit synthetic
Auth/Storage schemas. Interface suites use repository VM/DOM harnesses. Neither
is represented as a hosted-provider or browser pass.

## Native service verification

The isolated GitHub workflow will run the88 browser scenarios against disposable
Supabase Auth/PostgreSQL/Storage services. It additionally runs independent
PostgreSQL backends for reciprocal dependencies, duplicate recurring completion
and queued session/MFA changes. The concurrency helper creates and removes only
its own newly generated empty QA database and publishes bounded outcomes.

These new native gates have not yet passed at this checkpoint. Browser discovery
does not prove execution. All previously reported failures require a fresh full
run; source counts alone do not establish release or visual acceptance.

## Subsequent executed checkpoint

Review commit `c89b8875263381d8e53cd1548bda2249b2d875c2` passed
[source CI 45777845204](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45777845204):
767 tests, zero failures/skips, TypeScript and production build. The independent
PostgreSQL scheduling gate passed after correcting the test harness's local
libpq service configuration.

[Native run 45777845101](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45777845101)
prepared the actual disposable Auth/PostgreSQL/Storage services and completed
88 scenarios: 84 passed, 4 failed, 0 skipped. Failures were the revision-round
dialog lifecycle, two secondary-screen geometry cases, and Team navigation after
a department save. This is an incomplete browser result, not a release pass.

The following development batch corrects the drawer test lifecycle, keeps
department dialogs guarded until their acknowledged refresh completes, and adds
bounded numeric geometry diagnostics while retaining the failing assertion.
Task completion now explains the existing recurrence/create-permission remedy
without changing authorization or rollback. A new native scenario exercises an
exactly 52,428,800-byte valid PNG through verification, staff/client downloads,
retained final files and revoked access. Its fixture passes complete decoding
and the actual render validator locally; native execution remains required.

The batch's production build, TypeScript and full fresh local source suite
pass: 771 tests, zero failures or skips. Browser discovery finds 89 scenarios
in 30 files. The native run must pass before accepting these changes. The
production release identity is
`build-346f008214f49825`.

Review commit `a618b3c1a39a91e28d873771598a88a20e1be294` subsequently passed
[source CI 45779751995](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45779751995),
including all 771 tests. [Native run 45779752039](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45779752039)
passed 85 of 89 scenarios with zero skips; the revision round, Team persistence and
independent PostgreSQL transaction checks passed. Remaining failures were two
Settings geometry cases, a keyboard fixture focusing the still-inert task list
before the queued native dialog-close event, and an original-download test
requiring a Content-Length header that Next intentionally removes.

The next test-only correction waits for the actual task-list close lifecycle and
observes the failed PATCH before asserting its toast. The original-download case
accepts HTTP streaming without a Content-Length header while retaining mandatory
complete byte count and SHA256 checks. A real loopback HTTP check through the
installed Next response adapter transferred all 52,428,800 bytes with the exact
digest; wrong declared length, truncation and wrong digest were rejected by the
test helper. Geometry evidence accepts only the adjacent source-map line offset,
known viewport/routes and bounded numbers; the original assertion remains.
These corrections still require the next full native run.

The subsequent run on `d2c170d6826cc46084fdf96c677c8453fe104247`
([45781195272](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45781195272))
passed 87 of 89 distinct browser scenarios, with no skips. The 50 MiB original
completed the real Supabase upload/verification, staff and client exact-byte
downloads, retained issued-version/manifest checks and revoked-access checks.
All task-focus cases and the independent PostgreSQL gate passed.

Constructed numeric telemetry subsequently showed that Settings itself fits.
The two remaining document-width failures occurred in the Team directory at
320 px and 390 px. The earlier sanitizer had mistaken a neighbouring code-frame
`toEqual` for the actual `toBeLessThanOrEqual` width failure. Numeric matchers are
now recognised directly. The directory, search controls and table viewport now
have explicit shrink/width bounds while retaining horizontal table scrolling.
The Team persistence scenario additionally checks the page/main width, bounded
scrollable table and visible search control. The layout assertion is retained.

The mobile containment batch passes 31 sanitizer contracts and 12 Team UI
contracts. Its release identity is `build-1de25ef817bdff46`; the next full native
run remains required. An early five-case layout/accessibility gate now runs
before the full 89-case suite; these are repeated checks, not 94 unique cases.
Only constructed viewport/rectangle telemetry and sanitized summaries are
published. Browser logs, sessions and captured mail stay private.

The cloud Programa reference returned 403 on 26 November; its one ordinary reload
did not restore access. The authenticated reference audit from 25 November remains
available, but no fresh reference acceptance is claimed.

Hosted migration/deployment, actual provider credentials and ownership mappings,
curriculum decisions/media verification and matching-size visual acceptance are
still separate release requirements. See `REDESIGN_ACCEPTANCE.md` for scope.
The actual hosting runtime must also pass the maximum-original test described
in `HOSTED_MEDIA_ACCEPTANCE.md`; loopback native success does not certify Vercel.

The first width bounds did not resolve the remaining document extent. Synthetic
screenshots and rectangle measurements confirmed that the visible table viewport
was contained. Its absolutely positioned screen-reader caption/Actions label
needed a local containing block. The table viewport now uses position:relative
so those labels stay inside its scrolling clip; accessible text and real table
columns remain present. The production build passes with release build-aa6ea26016c55ab4. The full mobile/native gate must verify this final fix.
The 26 November production dependency audit reports zero known vulnerabilities
across 31 production dependencies; this is not a complete security assessment.
