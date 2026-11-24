# Eight-session real-service concurrency check

`concurrency.spec.cjs` is a required case in the isolated Supabase Docker / production Next.js Playwright suite. It runs only against loopback services and the fresh private synthetic fixture produced by `provision.mjs`. No hosted URLs, NAM credentials, client records, test-only application routes or authentication bypasses are used.

The eight accounts are Founder, Sales Manager, two Sales Representatives, Production Manager, two CGI Artists and Freelancer. Authentication uses actual GoTrue password/TOTP sessions and the supported Supabase SSR cookie client. Each account gets its own in-memory HTTP request context and a real application CSRF bootstrap. Login/setup time is not called concurrency.

The measured workload sends requests concurrently with `Promise.all` through all eight authenticated contexts. It creates two assigned tasks per identity, reads them, edits status/priority, adds attributed comments, verifies persistence and completes them. Further checks cover:

- Cross-owner and real cross-workspace record denials, including the founder's selected-workspace boundary.
- Eight simultaneous requests using the same retry key returning one task; changed-payload key reuse returning 409.
- A permitted founder and task owner editing the same version simultaneously: one success, one 409, and one persisted version increment.
- Founder cleanup of only this run's QA-prefixed, creator-checked records.

The workload is bounded to 100–200 counted application requests (normally 190, plus session preparation), a two-minute case timeout and ten-second request timeouts. The primary eight-session mutation cohort must have at least eight overlapping HTTP requests. This proves overlapping transport requests from distinct identities; it does not claim one database worker executes all statements simultaneously.

The sanitized reporter records only approved numeric request counts, peak overlapping mutations, cohort time, bootstrap/read/mutation p95, conflict count and leak count. Provisional localhost targets are read p95 ≤2 seconds and mutation p95 ≤1 second, including cleanup mutations. No cookies, passwords, factor secrets, tokens, raw request bodies, traces, videos or saved storageState are included in reports.

Static syntax and Playwright discovery can verify that the case is present. Only the completed isolated real-service CI run for the exact commit establishes execution results. This eight-session burst does not satisfy the separate 25-user / 10,000-task sustained-load gate, browser usability timing, hosted NAM configuration, live sales integrations, backup recovery or all four release testing cycles.
