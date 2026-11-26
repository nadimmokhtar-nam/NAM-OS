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

Hosted migration/deployment, actual provider credentials and ownership mappings,
curriculum decisions/media verification and matching-size visual acceptance are
still separate release requirements. See `REDESIGN_ACCEPTANCE.md` for scope.
The actual hosting runtime must also pass the maximum-original test described
in `HOSTED_MEDIA_ACCEPTANCE.md`; loopback native success does not certify Vercel.
