# Hosted initialization checkpoint — 24 November 2026

The approved Supabase staging schema was installed successfully through the trusted project SQL editor. This checkpoint records the coordinating agent's actual hosted SQL/configuration observations. It does not establish application runtime readiness.

| Verification | Observed result |
| --- | --- |
| Migration history | 14 versions, `202611240001` through `202611240014` |
| Original SQL statement arrays | Complete for all 14 history rows |
| NAM application tables | 38 |
| NAM tables without row-level security | None |
| Auth users / workspaces / memberships | 0 / 0 / 0 |
| Attachment bucket | `nam-task-attachments`; private; 2,097,152-byte limit |

The source is repository `nadimmokhtar-nam/NAM-OS`, commit `2227350898e5670e074ce7bf7bd0e3fa22dbcd0c`, tree `a17f712839febf771536481618a9f9ae61f897ad`. The complete installer is 392,883 bytes, SHA-256 `3c897c119f63f476a14c591586277a164a64b0ceb79bbb4808342e458e3739a4`. The source manifest SHA-256 is `ef8c1086068aab363bbfcec0adf4042ee5ab417e522e7098fb432c91a5a952e0`.

Public signup and anonymous sign-in are disabled; email confirmation is required. TOTP remains enabled. The Auth Site URL is `https://nam-os-staging.netlify.app`, with the exact `/auth/confirm` redirect saved. Netlify pull-request previews are disabled. Public Supabase configuration and application origin were saved. CSRF secrets were generated independently per context and saved hidden. The privileged Supabase server secret was copied privately from the provider into the server-only `SUPABASE_SERVICE_ROLE_KEY` setting; the saved Contains secret state was observed. Only the Live app context contains the real credential. Versions, Branches and Agent runs each contain an explicit disabled noncredential sentinel. The clipboard was replaced using a nonsecret settings-URL UI copy. Credential values were never printed or written to files. The SDK compatibility review required no code fix; three synthetic SDK transport checks and eleven jobs checks passed. These checks do not establish a hosted runtime pass.

Netlify remains on the Free plan. The observed allowance was 300 credits, with 285 remaining after initial deployment and a subsequent automatic main-branch build. This is a point-in-time observation; build frequency and runtime usage affect the remaining allowance. No paid upgrade was performed. This checkpoint does not establish the subsequent build result.

Founder identity/workspace provisioning and the workspace environment value remain outstanding. The provider Create new user form is open with blank email/password; no founder identity has been created. The founder must privately create the confirmed account, followed by trusted workspace bootstrap, Live app workspace configuration, protected rebuild and hosted login/MFA verification. Hosted login, MFA, logout/session revocation, permission boundaries, task/Academy workflows, private attachment upload/download, and sales integrations still require end-to-end verification. Row-level security being enabled does not prove each policy works. The site is not cleared for staff use by this checkpoint.

The structured evidence is `hosted-evidence.json`. Earlier `bundle-result.json` and `verification.json` describe preparation-time generation and local PostgreSQL testing; their `hostedExecution: false`/equivalent fields are historical and intentionally unchanged.

Separately, isolated QA5 passed all 13 browser/concurrency cases and all 6 HTTP security checks with 8 synthetic managed Auth accounts at source `f781c4db18a6fe22abf3ce7e27f0ea13f7089305`. Its sanitized artifact (14961801560) was retained and inspected: https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45479123159. This does not establish a hosted NAM runtime pass. **Zero of four full release QA cycles are certified.**
