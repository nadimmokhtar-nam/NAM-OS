# Protected free staging setup

24 November 2026. This is setup in progress, not a production release.

## Verified accounts and deployment

- NAM-owned Netlify team: Free plan, 300-credit monthly hard cap. No subscription, card, domain purchase, paid add-on or AI coding run was started.
- Staging project: `nam-os-staging`, site ID `ca0c3521-9316-43c8-9a46-4c1e0eafd1a6`.
- HTTPS address: https://nam-os-staging.netlify.app. Netlify visitor access is **Private / only the owner**. The first Git build deployed successfully, and owner-authenticated browser navigation reached the actual NAM OS workspace error boundary.
- Repository: `nadimmokhtar-nam/NAM-OS`, branch `main`, base `production`, build `npm run build`, publish `.next`, Node 24 and pinned official Next.js adapter.
- Pull-request previews were switched **off**, with a saved confirmation observed. No other branch previews were enabled. Keep untrusted code away from credentials.
- Supabase project: `ltkdycibqnqmwqeejcvs`, NAM Studio Free / Nano, Ireland (`eu-west-1`). A read-only SQL audit returned **0 Auth users, 0 NAM tables, 0 storage buckets**. No hosted application migration or credential was applied during that audit.

The website currently cannot open the workspace because the backend environment is not connected. This is not a usable team deployment yet. Do not publish or invite the studio on that basis.

## Concrete backend connection to authorize

1. Apply the reviewed numbered schema migrations 001–014 from the NAM-owned source, in order, to the confirmed empty NAM project. Keep synthetic CI accounts and test records out of this hosted database.
2. Configure invite-only Auth and TOTP, then create the first confirmed founder identity through a secure provider flow. The founder chooses their own password and authenticator; neither belongs in chat, source, screenshots or reports.
3. Use the reviewed `supabase/bootstrap-owner.sql` operator flow for that verified identity. Store any personalized operator copy privately and retain the generated workspace UUID as configuration.
4. Set the project URL/publishable key, workspace UUID and exact staging origin in Netlify. Store the existing privileged project service key **only in protected server settings**; it supports account administration and file attestation. Never use a `NEXT_PUBLIC_` name for that key. Generate a separate server-only CSRF signing secret.
5. Rebuild the protected site. Verify actual hosted sign-in, cookie refresh/logout/MFA, CSP/nonces/no-store, origin/CSRF rejection, private file round trips, role/grant behavior and callback URLs before changing visitor access or using business records.

Using a privileged Supabase key gives the NAM staging server administrative capabilities within this project. Application routes separately enforce trusted membership, Founder MFA and live authorization. The infrastructure-owner approval for this credential connection is a distinct account-permission step; no credential should be sent through chat.

## Cost and location boundaries

Netlify Free permits commercial use but pauses projects if the shared credit allowance is exhausted. Free hosting is a bounded pilot option, not an availability guarantee. App users authenticate in Supabase; eight NAM users do not require eight hosting-console seats. The free host may show its provider badge.

The database is in Ireland. Netlify's documented free function default is Ohio, with custom region selection requiring an eligible paid plan. Do not describe this free arrangement as EU-only processing. Measure actual cross-region request latency and verify provider settings before release.

Supabase Free does not provide the production backup/recovery guarantees required by the release checklist. Database and object export/restore must be independently verified before storing important studio records.

## Release status

Core source milestones are merged after clean CI. Real-service runs have verified eight actual synthetic identities, six negative HTTP security checks and concurrent task traffic in isolated Docker infrastructure. Remaining browser defects, full manager scopes, live integrations, native PWA installation, sustained load and four full release QA cycles remain open. Four service-test executions are not four certified full cycles.

Private screenshot evidence is retained separately; public source contains sanitized results and the visual findings only.

## References

- https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- https://docs.netlify.com/build/functions/configuration/
- https://supabase.com/docs/guides/platform/backups

