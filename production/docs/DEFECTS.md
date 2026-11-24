# Release defect and gap register

24 November 2026. No production-readiness claim. Four full QA cycles remain uncertified.

| ID | Severity | Finding and evidence | Correction / verification |
| --- | --- | --- | --- |
| D-01 | High | Non-founder task owners could archive assigned work contrary to the agreed action matrix. Direct PostgreSQL reproduction. | PR #3 merged: live Founder/MFA database trigger plus server capability and UI gate. Focused SQL/API tests and complete 223-test Linux CI passed. Actual real-service archive workflow retest pending. |
| D-02 | Medium | Course metadata and module/lesson/resource dialogs reused control IDs, linking modal labels to background fields. | PR #4 merged; focused association tests and CI passed. Actual run 3 advanced through module/lesson/resource authoring, publication and enrollment, verifying the label correction. Later learner catalogue failure is separate D-06. |
| D-03 | Medium | Mobile navigation's intended focus was overwritten by generic click-handler focus restoration. | PR #6 merged. Actual run 3 passed the retained keyboard assertions across five viewports. |
| D-04 | Medium | Empty attachment File timestamps made an untouched task dialog appear dirty after a subtask save. | PR #6 merged. Actual run 3 verified matching saved fields, no unexpected confirmation and successful clean close. Selected-file dirty detection remains covered. |
| D-05 | Medium | A partial task response repainted a draft captured before the request, overwriting parent edits typed while saving. Run 3 reached the rapid subtask/parent-status sequence and failed persisted Done. | PR #8 preserves the latest live draft, guards stale responses and disables parent Save during partial writes. Held-response regressions pass; actual browser verification pending. |
| D-06 | Medium | An already signed-in learner retained an empty catalogue after new enrollment. | PR #8 refreshes courses on Academy navigation/My learning with request guards. Contract regression passes; actual browser verification pending. |
| V-01 | Medium | Actual 320 px screenshot showed the fixed installer intersecting List/Board actions; 375 px floated over task footer content. | PR #9 moves only mobile installation into document flow, preserving fixed notices. Actual geometric non-overlap verification pending. |
| G-01 | Release requirement | The initial own/assigned model lacked basic role/section-grant administration. | PR #7 merged after 255-test CI and independent security review. Manager scopes, collaborators/watchers, restricted visibility and typed permission-bearing parent links remain separate gaps. No automatic broad manager access is inferred. |
| G-02 | External setup | Hosted schema, real founder/sales accounts, repository-to-host authorization and live provider credentials remain unconfigured. | Supabase/Netlify sign-in is verified; GitHub email verification is required before the host permission review. No keys in chat/source. |
| G-03 | Release evidence | Four complete QA cycles, sustained 25-user load, native desktop installation, live integrations and independent database/object recovery are incomplete. | Retain exact-commit evidence and close each gate before release. |

## Actual service-test executions

- Run 1: source `c40356b21c12e4432317b23bcdf7f2fcb6a465e6`, Actions `45466454347`. Six HTTP security checks passed; browser suite 10/13 passed. Eight-session 190-request concurrency burst passed. See `evidence/real-service-run-1` and `real-service-concurrency.md`.
- Run 2: source `9169a7c188d9e308ae69d14eced1a50fe19862e6`, Actions `45468401119`. Six HTTP security checks passed; browser suite again 10/13. Added redacted failure coordinates and finer stages identified the three failed actions. This diagnostic execution is not a completed full QA cycle. Artifact `14956097332`, SHA-256 `99a51037e36e4387c55d8ed1a175a1034618ad11d60164866c53ca39b8bb13b2`.
- Run 3: source `c823a04efd5d58dce79b8c09420174fe4489335a`, Actions `45470433097`. Six HTTP checks and 11/13 browser cases passed, including all five responsive keyboard viewports. The eight-session burst again passed. Artifact `14955979573`, SHA-256 `af4a88071ff587bee16b7076db7ba885f51c57d6da3d6d6cf470fc4ad411a622`. Five authenticated screenshots were reviewed; two later workflow failures and V-01 remain open.

Only sanitized reports are retained. No account fixtures, credentials, raw errors, authentication screenshots or browser storage state are included.
