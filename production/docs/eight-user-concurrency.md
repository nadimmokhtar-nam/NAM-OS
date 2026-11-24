# Eight-user workflow and staged concurrency gate

This protocol adds eight **synthetic** identities covering Founder, Sales Manager, two Sales Representatives, Production Manager, two CGI Artists and Freelancer. Accounts and managed sessions are distinct; no real NAM/client records are used.

## Before testing: acceptance criteria

| Gate | Acceptance |
| --- | --- |
| Roles | All six templates represented by eight active, confirmed users with distinct managed sessions |
| Permission isolation | Assigned-only users and managers cannot read another owner's task or enter a denied section; founder visibility requires AAL2 |
| Independent writes | All eight successful updates persist on the correct task with correct actor attribution |
| Conflicting edits | Owner/founder requests using one version produce one success and one explicit 409; no silent overwrite |
| Repeated create | Eight identical retry-key requests produce one task; changed-payload reuse fails |
| Learning | Each learner completes their own Sales, 3D and Post-production test courses; progress is not shared |
| Revocation | Role change, suspension, session expiry/sign-out immediately deny stale protected reads/writes |
| Lifecycle | Complete, delete and restore keep correct access and audit history |
| Load envelope | 25 distinct active users, 10,000 tasks, 1 KB descriptions, bounded 100-item summary pages |
| Provisional performance | Task-list usable p95 ≤2 seconds; mutation p95 ≤1 second, with client location/network documented |

HTTP timing alone cannot establish browser usability. Real browser traces, responsive review, accessibility, integrated sales-source behavior and provider backup/restore are separate release gates.

## Local PostgreSQL evidence

Run `node --test test/eight-user.test.mjs` inside `production` with Node.js 24+. The test applies **all current migrations**, creates isolated confirmed identities/sessions, and exercises actual PostgreSQL functions/RLS using PGlite. The larger fixture measures 25 role-scoped reads and writes over 10,000 tasks, with payload-size and permission assertions.

**PGlite has one connection.** Offered asynchronous work is explicitly queued before `BEGIN / SET ROLE` so identities cannot bleed between transactions. This proves policy/workflow invariants under the tested sequence. It is not a hosted connection-pool, network concurrency, browser or Supabase-provider test. Repeated local runs are not counted as separate full testing rounds.

## Actual hosted concurrency runner — opt-in only

`tools/staging-eight-users.mjs` sends actual parallel HTTP requests to an operator-selected disposable staging workspace. It does not create accounts, obtain credentials, select a production deployment or perform external outreach.

1. Prepare an isolated staging workspace with no client data and eight synthetic accounts covering the six role templates. Enroll/verify the founder's MFA. Complete all MFA required for the other sessions.
2. Sign in as each test identity and prepare a session-cookie manifest **outside this checkout**, readable only by its owner. Cookies are credentials: never commit, attach or upload the manifest, and delete it after testing.
3. The manifest structure is:

```json
{
  "staging_origin": "https://YOUR-ISOLATED-STAGING-HOST",
  "disposable_workspace": true,
  "users": [
    {
      "synthetic": true,
      "expected_id": "SYNTHETIC-USER-UUID",
      "role": "founder",
      "cookie": "COPY-ONLY-THE-SYNTHETIC-STAGING-SESSION-COOKIE-HEADER"
    }
  ]
}
```

Include eight distinct users, exactly one founder, and every role template. The example intentionally contains no usable credentials. Set the manifest to mode 0600, then run:

```sh
chmod 600 /PRIVATE/PATH/nam-staging-sessions.json
NAM_STAGING_URL=https://YOUR-ISOLATED-STAGING-HOST \
NAM_STAGING_SESSION_FILE=/PRIVATE/PATH/nam-staging-sessions.json \
NAM_STAGING_MUTATION_ACK=isolated-disposable-workspace \
NAM_STAGING_CLIENT_LOCATION=Paris \
node tools/staging-eight-users.mjs
```

`--dry-run` prints the protocol and required configuration without reading sessions or sending requests. Missing acknowledgment, an in-checkout/overly readable manifest, fewer than eight distinct users, wrong identities/roles, incomplete MFA or demonstration storage make the runner refuse/fail the test.

The runner creates uniquely tagged QA tasks, uses separate session cookies for parallel independent reads/writes, tests an owner/founder update conflict, tests parallel retry-key requests, checks cross-owner denial, measures bounded lists, and verifies a synthetic freelancer's **old cookie** loses access after logout. Finally, the founder soft-deletes only this run's tagged tasks after checking their creator. Audit/deleted records remain in the disposable workspace. Failed cleanup IDs appear in the report; no cookies or headers do.

For the larger staged load gate, provide **25 distinct sessions** and preseed **10,000 synthetic tasks** in that same disposable workspace, then additionally set `NAM_STAGING_LOAD=1`. The runner refuses this gate with fewer accounts or records. It does not silently represent eight identities as 25 users or bulk-create production accounts/data. `NAM_STAGING_READ_ROUNDS` accepts 1–20 (default 3). A full sustained-load/browser campaign is still required after this initial burst test.

No hosted credentials were supplied during implementation, so the hosted runner is prepared but **has not been executed**. Its existence does not complete testing Cycle 2 or any full testing round.

## Recorded local result

Node v24.22.3, actual PostgreSQL/WASM using `test/database.mjs`, all migrations present at fixture initialization. The eight-user workflow and 25-user dataset tests passed **11 assertions** (including nested tests). No cross-owner row leaks or lost successful writes were observed in the tested sequences.

| Measurement | Observed local result |
| --- | --- |
| Dataset | 25 synthetic users, 10,000 tasks, 1,024-byte descriptions, 100-item summary pages |
| Role-scoped read transactions | 25 samples; p50 1,352.82 ms, p95 1,493.83 ms, max 1,732.44 ms |
| Role-scoped write transactions | 25 samples; p50 3.36 ms, p95 5.28 ms, max 5.66 ms |
| Largest summary JSON | 50,444 bytes |
| Hosted/browser acceptance evaluated | **No** |

This is a performance finding to investigate, not a hosted capacity pass. The task page currently relies on RLS's owner-or-founder condition without an explicit owner restriction in its query. Repeated security-function evaluation may scan the studio's full dataset even for an assigned-only user. Review an explicit authorized owner predicate / query branch and inspect an actual PostgreSQL query plan. Repeat comparable measurements after any change, then run the hosted test with real concurrent connections. Native hosted PostgreSQL may behave differently from WASM; a fast local write does not prove end-to-end latency.

### Correction verified after migration 011

`202611240011_task_query_scopes.sql` computes the current user's permitted workspace/section scopes per SQL statement, retaining managed-session validity, active membership and MFA requirements. Task pagination adds an explicit owner restriction for assigned-only users and a matching index; all user filter values remain bound SQL parameters.

Re-running the same `node --test test/eight-user.test.mjs` command against all migrations through 011 passed all **11 assertions**, including the original eight-user isolation, role/session revocation, stale edits, personal learning and audit-history workflows. The unchanged 25-user/10,000-task dataset produced:

| Measurement | Before 011 | After 011 |
| --- | --- | --- |
| Read p50 | 1,352.82 ms | 2.63 ms |
| Read p95 | 1,493.83 ms | 3.17 ms |
| Read max | 1,732.44 ms | 21.89 ms |
| Write p50 | 3.36 ms | 2.73 ms |
| Write p95 | 5.28 ms | 5.18 ms |
| Write max | 5.66 ms | 5.72 ms |
| Largest summary JSON | 50,444 bytes | 50,444 bytes |

This verifies the local regression and permission invariants after the correction. It does not turn the single-connection WASM run into hosted/network concurrency or browser evidence, does not establish a production SLA, and does not complete a full testing cycle.
