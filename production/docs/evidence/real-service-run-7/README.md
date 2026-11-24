# Real-service execution 7 — password access passed; keyboard focus defect remains

24 November 2026. Tested source `59e2f1d9348d3679ab2c7162c8f0824d3f6a20e3`; [actual isolated workflow 45487486835](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45487486835). Its application/runtime/migration bytes match password-default feature `05c39b4fbe49f5826aa88dcabe60e3520b0d67ec`. [Standard CI 45487487029](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45487487029) passed for the tested source.

## Actual results

- Real HTTP security: **6/6 passed**, including default password-only Founder access and the separate elected-factor identity's assurance boundaries.
- Required browser/concurrency suite: **13 discovered and executed, 12 passed, 1 failed**; no skipped, interrupted, timed-out or retried cases. Overall status remains failed.
- All eight role-specific browser login/navigation/logout cases passed with no enrolled factor in those cohort fixtures. The Founder additionally visited `/mfa` and returned to the authenticated workspace without enrollment.
- Academy authoring, private download, saved/reopened completion, catalogue return and Sales/3D/Post-production isolation passed. Stale/offline draft handling, five responsive viewports, installer geometry, menu/dialog keyboard checks and eight-session concurrency also passed.

## Password and optional-MFA proof

The ninth synthetic Sales identity separately enrolled a real TOTP factor. Its AAL1 business API, RLS and RPC access was denied. Actual provider verification restored only its assigned access: the own-task read and create RPC succeeded, while Founder administration and another owner's task remained inaccessible. The default Founder's real AAL1 JWT, live session, API access, `nam_founder` permission and direct RLS read were accepted.

Six additional cookie-authenticated Chromium navigations ran inside the HTTP assurance case. Every navigation required the final URL and visible workspace or existing-factor challenge content. The safe report records:

| Identity state | Requested route | Actual rendered route | Initial HTTP status |
| --- | --- | --- | --- |
| Password-only Founder | `/mfa` | `/workspace` | 200 |
| Password-only Founder | `/workspace` | `/workspace` | 200 |
| Opted-in Sales, AAL1 | `/workspace` | `/mfa` | 200 |
| Opted-in Sales, AAL1 | `/mfa` | `/mfa` | 200 |
| Same Sales identity after TOTP, AAL2 | `/workspace` | `/workspace` | 200 |
| Same Sales identity after TOTP, AAL2 | `/mfa` | `/workspace` | 200 |

The observed 200 responses followed by the correct rendered route show why a transport-only 307 requirement is invalid for this application. The corrected harness does not treat a bare 200 as success. Execution 6 did not retain an exact failure location, so its specific failed assertion remains unproven rather than retrospectively relabeled.

## Remaining defect

`TASK_LIFECYCLE` failed at `task_subtask_keyboard_complete`, asserting that the subtask checkbox remained focused after keyboard Space (`browser.spec.cjs`, tested source line 110, column 230). Its checked-state assertion had passed. This occurs before the subsequent parent-status save, archive and delete/restore stages; those later stages are **not** counted as verified in this execution.

The clean creator-dialog probe passed with no changed task fields or unexpected confirmation. The keyboard focus assertion remains unchanged. Pending-checkbox focus restoration is under independent application review; the report does not assume a cause or count a proposed fix as verified.

## Bounded concurrency

Eight actual password-only sessions made 190 counted requests: 82 reads and 108 writes. There were 16 overlapping mutations, zero observed scope leaks and one expected stale-editor 409 conflict. Read p95 was 261.42 ms and mutation p95, including cleanup, was 262.86 ms, within the predefined local targets of 2,000 ms and 1,000 ms. Bootstrap p95 was 230.53 ms; the mutation cohort took 252.35 ms. Repeated-key deduplication, competing edits and synthetic cleanup passed.

## Evidence limits

Artifact `14965126330` contains exactly the two sanitized JSON files. ZIP SHA-256 `08f511c1a67b70dfec29fbb8605fb3bade7578f3035cbf85968b2d7a8772e172` independently matches the artifact API digest. No public images, authentication material, raw logs, traces, videos or saved browser sessions are retained. Runner screenshots are ephemeral; no run-7 image review is claimed.

This verifies isolated disposable Linux/Supabase/Next/Chromium behavior, not the hosted NAM tenant, live integrations, native installation, complete product scope, sustained load or backup recovery. The remaining focus defect prevents a green suite. Full release testing cycles certified: **0/4**.
