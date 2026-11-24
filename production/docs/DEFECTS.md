# Release defect and gap register

24 November 2026. No production-readiness claim. Four full QA cycles remain uncertified.

| ID | Severity | Finding and evidence | Correction / verification |
| --- | --- | --- | --- |
| D-01 | High | Non-founder task owners could archive assigned work contrary to the agreed action matrix. Direct PostgreSQL reproduction. | PR #3 merged: live Founder/MFA database trigger plus server capability and UI gate. Focused SQL/API tests and complete 223-test Linux CI passed. Actual real-service archive workflow retest pending. |
| D-02 | Medium | Course metadata and module/lesson/resource dialogs reused control IDs, linking modal labels to background fields. Actual rendered-markup association reproduction. The real-service Academy case failed while filling Module title. | PR #4 merged: distinct persistent metadata IDs; seven association regressions and existing draft tests passed, followed by clean hosted CI. Actual browser lifecycle retest pending. |
| D-03 | Medium | Mobile navigation's intended focus was overwritten by generic click-handler focus restoration. Real-service run 2 failed the first-navigation-link focus assertion at 320 px. | Isolated correction and regression in progress; preserve the keyboard assertion. |
| D-04 | Medium | Task detail stayed open after saving a subtask; run 2 failed clean Close-dialog behavior. Inspection identified unstable lastModified metadata from the unselected attachment input's fresh empty File in repeated FormData snapshots. | Normalize only the empty-file sentinel while preserving dirty detection for real selected files. Focused reproduction and actual browser verification pending; do not accept an unexpected discard prompt to make the test pass. |
| G-01 | Release requirement | Basic role/explicit section-grant administration is absent from the initial own/assigned model. | Migration 013, trusted access RPCs and administration UI are in progress. Manager scopes, collaborators/watchers, restricted visibility and typed permission-bearing parent links remain separate gaps. No automatic broad manager access is inferred. |
| G-02 | External setup | NAM Supabase configuration, real founder/sales accounts and live provider credentials are not available. | Founder sign-in and secure provider configuration are required; no keys in chat/source. |
| G-03 | Release evidence | Four complete QA cycles, sustained 25-user load, native desktop installation, live integrations and independent database/object recovery are incomplete. | Retain exact-commit evidence and close each gate before release. |

## Actual service-test executions

- Run 1: source `c40356b21c12e4432317b23bcdf7f2fcb6a465e6`, Actions `45466454347`. Six HTTP security checks passed; browser suite 10/13 passed. Eight-session 190-request concurrency burst passed. See `evidence/real-service-run-1` and `real-service-concurrency.md`.
- Run 2: source `9169a7c188d9e308ae69d14eced1a50fe19862e6`, Actions `45468401119`. Six HTTP security checks passed; browser suite again 10/13. Added redacted failure coordinates and finer stages identified the three failed actions. This diagnostic execution is not a completed full QA cycle. Artifact `14956097332`, SHA-256 `99a51037e36e4387c55d8ed1a175a1034618ad11d60164866c53ca39b8bb13b2`.

Only sanitized reports are retained. No account fixtures, credentials, raw errors, authentication screenshots or browser storage state are included.
