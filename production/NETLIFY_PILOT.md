> Historical adapter-build assessment. The owner subsequently supplied the existing protected `nam-os-staging` site and Ireland Supabase project. Use [DEPLOYMENT.md](DEPLOYMENT.md) and [current reinvention evidence](docs/REINVENTION_VALIDATION.md) for this branch. The older source hashes, counts and accountless packaging results below are retained as historical evidence.

# Free online pilot: Netlify + Supabase

Netlify Free is a feasible candidate for the existing Next.js application, with Supabase Free retaining authentication, PostgreSQL and private files. No paid plan, account, project, site or deployment was created during this check. This document records build compatibility and limitations, not launch readiness.

## Actual accountless build evidence

The isolated source was reconstructed from `nadimmokhtar-nam/NAM-OS` commit **635433bb34064816b034f482f468a4a8ca5d0382**, tree **93a3509da24faa77091fb4147c8d017de5cfc68e**. All 130 production-source Git blob hashes were checked. Five locally stale/missing files were fetched from that exact GitHub tree. The active application workspace was not modified.

Candidate changes are repository-root `netlify.toml`, repository-root `.gitignore`, and the production package/lock files adding the exact development dependency `@netlify/plugin-nextjs` **5.16.9**. Existing build/dev/start scripts and all direct runtime dependency versions remain unchanged. The adapter added 41 packages. This explicit pin intentionally opts out of Netlify's recommended automatic adapter updates, so upgrades need review and regression testing.

The official Netlify Build module **37.7.6**, installed through exact Netlify CLI **27.20.1**, completed an offline, accountless local build on official Node **24.22.3**. Next.js **16.4.6** compiled and typechecked, generated routes, packaged the SSR Node function and bundled the Node.js proxy middleware for Netlify Edge. Final build exit was **0**; the engine reported **25.4 seconds**.

The complete candidate regression suite passed **214/214** tests, with zero failures or skips, in 7.87 seconds. A fresh full `npm audit --json`, including the new development adapter dependencies, returned **zero known vulnerabilities** of any severity. The bounded audit/build evidence records the candidate lockfile hash. This is npm advisory evidence, not a complete security audit or a hosted-provider pass.

Generated artifacts:

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| SSR function ZIP | 17,763,306 bytes | a3c7546d41da5db7a7da1adbb6fd681cb93d98325f02b62b8973ae5159520e33 |
| Proxy Edge bundle | 2,035,077 bytes | 88085168a32f6e5e1e8c346e98ace5ec42fc534c652bdad2aeb8e7f9f30b6134 |

The CLI wrapper initially could not write its macOS global preferences inside the restricted session. The same official public build API was used directly. A supported workspace-local Deno binary/cache supplied through PATH and DENO_DIR allowed CLI-mode bundling without changing HOME, patching vendor code or requesting account access. An earlier buildbot-mode attempt packaged the app but failed at the sandbox's forbidden process-list diagnostic; that attempt is not the successful final result.

The unchanged PWA release script regenerates `app/pwa-policy.ts` and `public/app-version.json` during a build. Those generated identity changes are not part of the candidate source patch.

## Candidate setup after review

Import the NAM-owned repository on Netlify's **Free** plan. Use the repository-root `netlify.toml` with `base = "production"`, build `npm run build`, publish `.next`, Node 24, and the pinned official Next.js adapter. Keep Supabase's existing PostgreSQL/Auth/Storage design; do not create a replacement database simply to change hosting.

Before adding any service key, disable untrusted/fork Deploy Previews and unnecessary branch deploys, or isolate them in a separate project with synthetic data and separate credentials. Free lacks the paid per-context environment-scoping controls. Only reviewed source should receive server credentials. One Netlify infrastructure owner is sufficient for the pilot; the eight NAM application users authenticate through Supabase and do not require eight Netlify console seats.

Enter project URLs, publishable key, server-only service key, app origin, workspace ID and CSRF secret through secure provider settings. Never add secrets to this file, netlify.toml, GitHub source or a browser-prefixed variable. Configure exact Supabase callback URLs for the final Netlify hostname before testing invites/recovery/MFA. Do not enable Netlify AI features, add-ons, databases or paid upgrades for this pilot.

## Free-plan constraints checked 24 November 2026

- **Netlify:** commercial Free use is explicitly allowed. The new Free plan has a hard monthly pool of **300 credits**, no auto-recharge and no usage charges. Projects pause when the pool is exhausted. Successful production deploys consume **15 credits** each; compute, traffic and requests consume the same pool. Frequent automatic production deploys alone can consume the allowance, so batch reviewed releases and monitor usage.
- **Runtime:** synchronous functions have a **60-second** limit and a **6 MB** buffered request/response limit (effective binary payload around **4.5 MB** after encoding). NAM's current 2 MiB file limit and roughly 2.8 MB JSON upload are nominally inside that boundary, but deployed private upload/download still requires a real smoke test. Large sequential provider syncs may need resumable jobs rather than assuming unlimited request duration.
- **Region:** default functions execute in **Ohio**. The documented custom function-region control is a Pro/Enterprise feature. Do not describe this Free option as EU-only processing or assume EU-database latency without measuring it.
- **Supabase:** Free provides 500 MB database space, 1 GB file storage and 50,000 monthly active users; projects can pause after a week of low activity. Automated downloadable backups are not included. Keep a verified export/restore procedure and file backup for pilot data; do not imply a free plan provides production recovery guarantees.

At current published rates, an illustrative month with four production deploys, 1 GB web bandwidth, 100,000 web requests and 5 GB-hours of compute uses **150 credits** (60+20+20+50). This is a planning example, not a NAM usage measurement or guarantee. Existing sales-provider subscription/API entitlements remain separate from hosting.

## Verification still required

No hosted Netlify URL or authenticated adapter runtime was tested. Native CLI serve/dev hits the unavailable global preferences path in this session; no internal server mock or fake backend was substituted. Before using real studio records, run the actual provider-backed suite against the deployed adapter: SSR cookie refresh/logout/MFA, per-request CSP nonces and no-store headers, origin/CSRF rejection, private 2 MiB file round trips, server permissions, direct RLS, callback hosts, source sync duration and responsive browser workflows. A local packaging pass does not complete the four required release testing rounds.

## Alternatives

Cloudflare currently recommends **vinext**, a beta Next.js API implementation, for Next.js on Workers. Its canonical limits page now states **64 MiB uncompressed** with no compressed size cap, so older OpenNext references to a 3 MiB compressed limit should not be treated as current. Workers Free still allows only **10 ms CPU** per request. This app's SSR, Node crypto and file validation need measured compatibility/CPU tests before choosing that path; no Cloudflare migration was performed.

Render Free can run the ordinary Node Next.js server with fewer adapter changes, but sleeps after 15 idle minutes, can take roughly a minute to wake, and explicitly is not recommended for production in its own documentation. It also may suspend unusually high external API/database traffic; bandwidth/build overages depend on payment-method/spend settings. It is a backup demonstration option, not an always-available studio service promise.

## Primary sources

- [Netlify commercial-use FAQ](https://www.netlify.com/solutions/web-applications/)
- [Netlify pricing](https://www.netlify.com/pricing/) and [credit-based Free plan](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Credit rates](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)
- [Official Next.js adapter support and limitations](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [Function payload, timeout and region limits](https://docs.netlify.com/build/functions/configuration/)
- [Node 24 default for builds and functions](https://www.netlify.com/changelog/2026-07-07-nodejs-24-default-new-sites/)
- [Supabase Free limits](https://supabase.com/pricing) and [backup guidance](https://supabase.com/docs/guides/platform/backups)
- [Cloudflare current limits](https://developers.cloudflare.com/workers/platform/limits/) and [vinext guidance](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Render Free limitations](https://render.com/docs/free)
