# Protected free staging setup

24 November 2026. This is setup in progress, not a production release.

## Verified accounts and deployment

- NAM-owned Netlify team: Free plan, 300-credit monthly hard cap. No subscription, card, domain purchase, paid add-on or AI coding run was started.
- Staging project: `nam-os-staging`.
- HTTPS address: https://nam-os-staging.netlify.app. Netlify visitor access is **Private / only the owner**. The first Git build deployed successfully, and owner-authenticated browser navigation reached the actual NAM OS workspace error boundary.
- Repository: `nadimmokhtar-nam/NAM-OS`, branch `main`, base `production`, build `npm run build`, publish `.next`, Node 24 and pinned official Next.js adapter.
- Pull-request previews were switched **off**, with a saved confirmation observed. No other branch previews were enabled. Keep untrusted code away from credentials.
- Supabase: NAM Studio Free / Nano, Ireland (`eu-west-1`). After the empty-project audit and explicit founder authorization, reviewed migrations 001–014 were applied atomically. Hosted SQL verification returned 14 complete history rows, 38 NAM tables with RLS enabled, zero Auth users/workspaces/memberships immediately after schema installation, and one private 2 MiB attachment bucket. Sanitized source digests and counts are in [the hosted checkpoint](evidence/hosted-initialization/HOSTED_INITIALIZATION.md).

Invite-only Auth, required email confirmation, disabled anonymous sign-in, TOTP and exact staging callback settings are saved. Public provider configuration, application origin and independently random per-context hidden CSRF secrets are configured. The privileged server secret is saved hidden only for Live app; Versions, Branches and Agent runs use explicit disabled noncredential sentinels. The provider-to-host transfer exposed no credential values in chat, files or reports, and the clipboard was replaced using a nonsecret settings-URL copy. Three synthetic SDK transport checks and eleven jobs checks passed without a compatibility code change; this is not hosted runtime verification.

The founder privately created the real Auth identity. A trusted operator verified confirmation and no active ban, then executed the reviewed one-use owner bootstrap. Hosted SQL verified one workspace, one active founder membership and one bootstrap audit event. The workspace environment is saved hidden in Live app only; other contexts contain explicit disabled noncredential sentinels. The fresh no-cache main deployment (observed commit prefix 53d3a873) is Live, with five stages complete and no exposed secrets reported by its scan. Actual Chrome rendered the NAM email/password login, and fresh signed-out workspace navigation redirected correctly to login. An old pre-backend tab shell resolved on full navigation; no code correction was required. Private founder sign-in and mandatory authenticator enrollment/verification remain the next step; authenticated workflows are pending. This is not a usable team deployment yet. Do not publish or invite the studio on that basis.

## Remaining owner setup and verification

1. The protected rebuild is Live and the unauthenticated login/redirect checks passed. Keep synthetic CI records out of this hosted database.
2. The founder privately enters their existing credentials and completes required authenticator enrollment and verification. Never record the password, QR code or TOTP secret. The identity/workspace bootstrap is complete; do not repeat it.
3. Verify session refresh and logout/replay handling, founder MFA enforcement, CSP/nonces/no-store, origin/CSRF rejection, role/grant behavior, task and Academy flows, and private file round trips before changing visitor access or using business records.
4. Retain sanitized evidence and preserve the four full release QA gates; this setup milestone is not a release certificate.

Using a privileged Supabase key gives the NAM staging server administrative capabilities within this project. Application routes separately enforce trusted membership, Founder MFA and live authorization. The founder explicitly approved the empty-project initialization and protected server credential connection. No credential should be sent through chat.

## Cost and location boundaries

Netlify Free permits commercial use but pauses projects if the shared credit allowance is exhausted. The last observed balance was 285 of 300 included credits after deployment and a subsequent automatic main-branch build; this is a point-in-time value. Free hosting is a bounded pilot option, not an availability guarantee. App users authenticate in Supabase; eight NAM users do not require eight hosting-console seats. The free host may show its provider badge.

The database is in Ireland. Netlify's documented free function default is Ohio, with custom region selection requiring an eligible paid plan. Do not describe this free arrangement as EU-only processing. Measure actual cross-region request latency and verify provider settings before release.

Supabase Free does not provide the production backup/recovery guarantees required by the release checklist. Database and object export/restore must be independently verified before storing important studio records.

## Release status

Core source milestones are merged after clean CI. Real-service runs have verified eight actual synthetic identities, six negative HTTP security checks and concurrent task traffic in isolated Docker infrastructure. Full manager scopes, live integrations, native PWA installation, sustained load and four full release QA cycles remain open. QA5 completed successfully at source `f781c4db18a6fe22abf3ce7e27f0ea13f7089305`: all 13 required browser/concurrency cases and all 6 HTTP security checks passed using 8 synthetic managed Auth accounts. The sanitized artifact was retained and inspected; no hosted NAM identity or live integration pass is implied. Run: https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45479123159. **Zero of four full release QA cycles are certified.**

Private screenshot evidence is retained separately; public source contains sanitized results and the visual findings only.

## References

- https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- https://docs.netlify.com/build/functions/configuration/
- https://supabase.com/docs/guides/platform/backups

