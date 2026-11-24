# First real-service concurrency result

The eight-session HTTP concurrency case **passed** against the isolated Supabase Docker stack and production Next.js application. This used actual GoTrue sessions, founder MFA, SSR cookies, CSRF protection and PostgreSQL policies—not PGlite or authentication mocks.

The complete browser run **failed**: 10 of 13 cases passed. This report establishes the concurrency result only and does not declare NAM OS ready for release.

## Exact evidence

| Item | Reference |
| --- | --- |
| Tested commit | [c40356b21c12e4432317b23bcdf7f2fcb6a465e6](https://github.com/nadimmokhtar-nam/NAM-OS/commit/c40356b21c12e4432317b23bcdf7f2fcb6a465e6) |
| Actions run | [45466454347](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45466454347) |
| Sanitized artifact | [14955059644](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45466454347/artifacts/14955059644) |
| GitHub artifact SHA-256 digest | `ab5c63b92b9503a2d1d6797efecd84124cd9c0e55caca81c17a28d63caac814e` |

Retained results: [safe-results.json](evidence/real-service-run-1/safe-results.json) and [api-results.json](evidence/real-service-run-1/api-results.json). The digest identifies the GitHub artifact, not an individual extracted JSON file.

## Observed concurrency result

Eight distinct synthetic accounts covered Founder, Sales Manager, two Sales Representatives, Production Manager, two CGI Artists and Freelancer. The case created assigned tasks, performed overlapping reads/status edits/comments/completions, checked persistence, rejected cross-owner and real cross-workspace reads, deduplicated repeated creates and verified a permitted owner/founder edit conflict. Cleanup checked the QA prefix and creator before deleting this run's tasks.

| Measurement | Observed |
| --- | --- |
| Concurrency case | `CONCURRENCY_8USERS` passed, 11,791 ms total |
| Counted application requests | 190: 82 reads and 108 writes |
| Peak overlapping mutations | 16 HTTP requests across the eight-session workload |
| Bootstrap p95 | 169.74 ms |
| Read p95 | 250.69 ms |
| Mutation p95, including cleanup | 282.53 ms |
| Primary mutation cohort | 234.37 ms |
| Observed cross-scope leaks | 0 |
| Expected stale-edit conflicts | 1; the competing authorized edit succeeded |

The measured localhost read and mutation p95 values met the provisional 2,000 ms / 1,000 ms targets for this workload. Request overlap is actual HTTP concurrency; it does not imply every SQL statement executed simultaneously.

The separate real-service HTTP security suite passed **6/6** checks, including role/task scope, direct permission boundaries, founder AAL1 denial, membership revocation, replay of a signed-out managed session, and anonymous/signup denial.

## Remaining limits

`TASK_LIFECYCLE`, `ACADEMY_LIFECYCLE` and `RESPONSIVE_KEYBOARD` failed in this same run and require correction and verification. Its `coverageComplete` value is false. Later fixes require their own exact-commit execution evidence.

This short isolated Linux run does not establish 25-user / 10,000-task sustained capacity, a 15-minute load envelope, browser usability timing, hosted NAM configuration, live sales integrations, external email delivery, production backup recovery or four completed full testing/correction cycles. No production credentials or customer data participated in the recorded test.
