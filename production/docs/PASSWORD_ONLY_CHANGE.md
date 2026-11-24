# Password-first sign-in change

24 November 2026. The founder explicitly requested password-only sign-in and no mandatory authenticator. This supersedes the earlier role-based Founder MFA requirement. A role does not mandate MFA. Accounts that deliberately enrolled and verified an optional factor still require that factor; this change does not silently bypass their choice.

## Scope and invariants

Implement the policy in the server context, privileged checks, SSR redirects, security interface and a new forward-only database migration. Do not rewrite migrations 001–014, weaken roles, trust user metadata, disable row-level security, change passwords, remove factors, expose credentials or bypass managed session revocation. The original request identity/session must still be rechecked immediately before privileged operations.

| ID | Acceptance condition |
| --- | --- |
| PW01 | A confirmed, active Founder with a live password session and no verified factor opens the workspace without enrollment or a six-digit prompt. |
| PW02 | That Founder can perform authorized task, Academy, sales, access and attachment operations; database authorization agrees with the API. |
| PW03 | Direct `/mfa` navigation returns a password-only account to its workspace; a signed-out request reaches sign-in. |
| PW04 | A deliberately opted-in account's AAL1 session cannot access business rows or protected APIs; genuine AAL2 restores only its authorized work. |
| PW05 | Non-founders, anonymous users, revoked users, invalid/ended sessions, foreign workspaces and forged metadata remain denied. |
| PW06 | CSRF, optimistic concurrency, idempotency and original-session checks remain enforced. |
| PW07 | Private-file attestation accepts a permitted password session and still rejects forged callers, dead sessions, revoked grants and an unverified opted-in session. |
| PW08 | Eight concurrent baseline accounts, including the Founder, can authenticate using passwords. Optional-factor checks use a separate isolated identity. |
| PW09 | Existing schema/data are preserved. Migration 015 and its exact official-CLI-compatible statement history commit atomically; repeat application is refused. |
| PW10 | Production CI, TypeScript/build and an isolated real Auth/PostgREST/Storage/browser execution pass on the combined reviewed source. |
| PW11 | Hosted migration/deployment and actual Founder password-session workflow are verified separately before claiming the change is live. |
| PW12 | The four complete release-testing cycles remain uncertified until their original release gates are executed; this authentication regression run is not a substitute. |

## Rollout

Prepare and review the complete source and migration, execute the relevant automated checks, then obtain the required at-action confirmation for removing mandatory MFA in the hosted workspace. Apply the approved atomic migration through the trusted operator, merge the reviewed source, observe the protected staging deployment, and test the real existing password session. Keep provider authentication and optional enrollment enabled; no password or factor reset is part of this change.

## Current evidence

Implementation and verification in progress. No password-only hosted policy, successful replacement deployment or post-change test pass is claimed by this draft. Record exact commits, executed checks, findings, corrections and runtime observations here after they exist. No credentials or personal account identifiers belong in this document.
