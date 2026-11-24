# Real-service execution 6 — HTTP gate failed

24 November 2026. Tested source `27bd53459a71cc0c332ea8194b6ace3f1fc8b19c`; [actual workflow 45485725042](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45485725042). Its runtime/application/migration bytes match password-default feature `85569cdda7a9e4b1f4522fb7ed62157ee2a958fa`.

Provisioning, the production build and real service setup succeeded. Eight password-only cohort accounts and a separate ninth Sales identity explicitly enrolled in MFA were provisioned. All six HTTP security cases executed: five passed and the combined password/optional-MFA assurance case failed. Trusted roles/task scopes, direct permission boundaries, membership suspension, managed-session logout replay, and anonymous/signup denial passed.

The workflow correctly stopped at the failing HTTP gate. **The thirteen-case browser/concurrency suite did not run.** No browser pass or performance result is inferred from execution 5 or any earlier source.

The sanitized artifact `14962493307` contains only `api-results.json`. ZIP SHA-256 `7dae20a79fc3579f94dc424f57b6d593bd6cb07f954476aa4e2e380b65266f6e` independently matches the artifact API digest. No public screenshots or raw logs are retained.

The original assurance summary did not retain a failure coordinate or substage, so this result alone does not identify which assertion failed. One test assumption under review was requiring an HTTP 307 as proof of an SSR redirect. The next harness instead requires actual cookie-authenticated Chromium navigation to the expected URL and visible workspace/challenge content, retaining the observed initial HTTP status as a bounded diagnostic. It also records fixed assurance substages and bounded failure coordinates, while retaining all API/RLS/RPC permissions and post-MFA assertions. A bare HTTP 200 cannot satisfy that navigation test. The cause remains an inference until the next diagnostic execution supplies evidence.

The separate legacy Sales unit expectation was corrected in feature `05c39b4fbe49f5826aa88dcabe60e3520b0d67ec`; only `production/test/sales-corrections.test.mjs` differs from `85569` for that correction. It does not change the runtime tested here. The subsequent QA commit includes that corrected test and does not relabel this failed execution as a pass.

Hosted NAM verification, live sales integrations and all four full release testing cycles remain open. Certified full release cycles: **0/4**.
