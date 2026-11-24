# Protected free staging setup

24 November 2026. This is setup in progress, not a production release.

## Verified accounts and deployment

- NAM-owned Netlify team: Free plan, 300-credit monthly hard cap. No subscription, card, domain purchase, paid add-on or AI coding run was started.
- Staging project: `nam-os-staging`, site ID `ca0c3521-9316-43c8-9a46-4c1e0eafd1a6`.
- HTTPS address: https://nam-os-staging.netlify.app. Netlify visitor access is **Private / only the owner**. The first Git build deployed successfully, and owner-authenticated browser navigation reached the actual NAM OS workspace error boundary.
- Repository: `nadimmokhtar-nam/NAM-OS`, branch `main`, base `production`, build `npm run build`, publish `.next`, Node 24 and pinned official Next.js adapter.
- Pull-request previews were switched **off**, with a saved confirmation observed. No other branch previews were enabled. Keep untrusted code away from credentials.
- Supabase: NAM Studio Free / Nano, Ireland (`eu-west-1`). After the empty-project audit and explicit founder authorization, reviewed migrations 001–014 were applied atomically. Hosted SQL verification returned 14 complete history rows, 38 NAM tables with RLS enabled, zero Auth users/workspaces/memberships, and one private 2 MiB attachment bucket. Sanitized source digests and counts are in [the hosted checkpoint](evidence/hosted-initialization/HOSTED_INITIALIZATION.md).

Invite-only Auth, required email confirmation, disabled anonymous sign-in, TOTP and exact staging callback settings are saved. Public provider configuration, application origin and independently random per-context hidden CSRF secrets are configured. The privileged server secret is saved hidden only for Live app; Versions, Branches and Agent runs use explicit disabled noncredential sentinels. The provider-to-host transfer exposed no credential values in chat, files or reports, and the clipboard was replaced using a nonsecret settings-URL copy. Three synthetic SDK transport checks and eleven jobs checks passed without a compatibility code change; this is not hosted runtime verification.

The workspace remains unavailable pending the real founder identity, trusted workspace bootstrap and workspace environment value. The provider's Create new user form is open with email/password blank; no founder identity has been created. The founder must enter their credentials privately and create the confirmed account before the trusted bootstrap can proceed. This is not a usable team deployment yet. Do not publish or invite the studio on that basis.

## Remaining owner setup and verification

1. Keep synthetic CI accounts and test records out of this hosted database. Create the first confirmed founder identity through a secure provider flow. The founder chooses their own password and authenticator; neither belongs in chat, source, screenshots or reports.
2. Use the reviewed `supabase/bootstrap-owner.sql` operator flow for that verified identity. Store any personalized operator copy privately and retain the generated workspace UUID as configuration.
3. Save the generated workspace UUID in Netlify's protected Live app environment. Retain the configured server-only credential and context isolation; never use a `NEXT_PUBLIC_` name for a privileged key.
4. Rebuild the protected site. Verify actual hosted sign-in, cookie refresh/logout/MFA, CSP/nonces/no-store, origin/CSRF rejection, private file round trips, role/grant behavior and callback URLs before changing visitor access or using business records.

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

