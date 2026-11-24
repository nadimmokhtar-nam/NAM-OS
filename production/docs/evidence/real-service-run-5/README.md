# Real-service execution 5 — isolated verification passed

24 November 2026. This verifies the bounded isolated suite below, not a production release or four completed release testing cycles.

## Provenance

- Tested source: `f781c4db18a6fe22abf3ce7e27f0ea13f7089305`, including reviewed main `53d3a873dbafcc60086cb2a9bfa342ab14a8158a` and preserved QA harness changes.
- [Actual isolated workflow 45479123159](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45479123159) completed successfully. GitHub's workflow counter is 6; this is the fifth reviewed service execution in this evidence series.
- [Standard CI 45479123086](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45479123086) also completed successfully for the tested source.
- Retrieved artifact `14961801560` contains exactly `safe-results.json` and `api-results.json`. ZIP SHA-256: `04f860e565a56115b8834380108d5299ec1ded3a6e83a2edb1e8d289dee63206`; independently matched the artifact API digest.
- Target: a fresh loopback Supabase Docker stack with real Auth, PostgREST, Storage and PostgreSQL, plus the production Next application in Chromium. Eight synthetic identities were provisioned; no NAM business records or live sales credentials were used.

## Acceptance results

| Check | Actual result |
| --- | --- |
| Required browser/concurrency cases | 13 discovered, 13 executed, 13 passed; zero failed, skipped, interrupted or timed out; zero retries |
| Real HTTP security checks | 6 completed, 6 passed; provider setup passed |
| Role sessions | Founder, Sales Manager, two Sales Representatives, Production Manager, two CGI Artists and Freelancer authenticated; role navigation, protected APIs and logout passed |
| Task workflow | Founder assignment, sales comment/subtask updates, rapid Done/save/close, reload persistence, board/list consistency, archive, deletion and restoration passed |
| Failure handling | Stale edit conflict and offline draft preservation/retry passed; missing CSRF was rejected |
| Academy | Sales course/module/lesson/resource authoring, publication, enrollment, private TXT download, persistent completion, reopening, visible All courses return and Sales/3D/Post-production isolation passed |
| Responsive and keyboard | All five widths (320, 375, 768, 1024, 1440), no page overflow, desktop alignment, native menu focus, Escape/dialog focus, required validation and retained draft checks passed |
| Installer regression | Exactly one real Install NAM OS button required; its bounds checked against workspace actions; mobile footer required to be static and below main content |

The clean creator-dialog probe reported no changed task fields and no unexpected native confirmation. The full task lifecycle also passed its immediate post-save close, so this verifies the previously failing later close rather than only the creator close.

The Academy test now uses the visible All courses control because course detail shares the Academy hash. It requires the Academy heading and the Sales course's presence before testing its absence from 3D and Post-production. That earlier same-hash shortcut was a harness error. The corrected installer selector includes its actual footer; these geometry assertions are non-vacuous in this execution.

## Eight-session concurrency

| Metric | Actual | Predefined local target |
| --- | --- | --- |
| Application requests | 190 (82 reads, 108 writes) | 100–200 |
| Overlapping mutations | 16, from eight distinct sessions | At least 8 overlapping requests |
| Read p95 | 246.73 ms | At most 2,000 ms |
| Mutation p95, including cleanup | 294.27 ms | At most 1,000 ms |
| Bootstrap p95 | 239.07 ms | Recorded separately |
| Primary mutation cohort | 251.26 ms | Recorded separately |
| Visible scope leaks | 0 | 0 |
| Competing stale-editor conflict | 1 expected 409 | Exactly 1 conflict and 1 successful writer |

The workload also verified eight repeated creates with the same idempotency key return one record, changed-payload key reuse is rejected, author attribution persists, cross-owner/cross-workspace access is denied, and synthetic cleanup succeeds. These are overlapping transport requests; they do not establish simultaneous execution by eight database workers. The browser suite elapsed 180.63 seconds, including authentication and fixture workflows; this is not a page response-time measurement.

## Evidence limits

Only sanitized JSON was uploaded or committed. Masked workspace screenshots were generated on the disposable runner but deliberately excluded from public artifacts; no run-5 image retention or direct image review is claimed. Earlier privately retained visual evidence remains separate. No raw logs, cookies, credentials, MFA secrets, traces, videos, saved storage state or authentication screenshots are retained in this report.

This does not verify the protected hosted NAM deployment, live Lemlist/Attio/JustCall data, external integration expiry/failure behavior, complete manager scopes, all remaining platform modules, native Mac/Windows installation, other browser engines, screen-reader usability, sustained 25-user/10,000-task load, backup recovery, or all four full release testing cycles. Those release gates remain open. Thirteen passing bounded cases are meaningful regression evidence, not full website readiness.
