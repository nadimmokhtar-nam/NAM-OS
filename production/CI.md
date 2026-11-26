# NAM OS continuous integration

The repository layout is `.github/workflows/ci.yml` at **repository root**, with the application at **production/package.json**. Vercel Root Directory remains **production**. The local workflow source is `nam-os/.github/workflows/ci.yml`; the publishing process maps the `nam-os/` workspace root to the repository root. GitHub does not discover workflows nested under `production/.github`.

The workflow runs on pushes and pull requests to main, or manual dispatch. It installs locked dependencies with npm ci, checks TypeScript, runs the automated test suite, then builds the Next.js application on Node.js 24 and Ubuntu 24.04. npm package caching is keyed by `production/package-lock.json`; node_modules and build outputs are not cached as an authority for test results.

Repository token permissions are contents:read only. Checkout does not retain credentials. There are no production environment variables, provider keys, cloud deployments, hosted database mutations or pull_request_target events. Fork pull requests receive the usual restricted event context. New runs cancel older runs for the same branch/pull request; the single verification job has a 20-minute maximum, with bounded install/test/build steps. The job does not require any new repository secret.

Only synthetic-test/runtime/install/typecheck/build text logs from a dedicated runner temporary directory are uploaded, with seven-day retention. The workflow does not archive `.env`, database exports, node_modules, application builds or production records. Do not introduce real client data or credentials into test output. GitHub artifact access follows repository/platform permissions; logs must therefore be safe for the repository's current public audience.

## Verified action pins

On 24 November 2026, official GitHub release tags were resolved through the public Git data API to their complete commit SHAs, and each pinned action.yml was read to verify the Node.js 24 runtime and supported inputs:

| Action | Release | Pinned commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/setup-node | v7.1.0 | 949feb2413d6458794dcd2491c4babbbce0c15c1 |
| actions/upload-artifact | v7.0.2 | cf430e030ddbb5b0abf93d22962f4752f3646cd9 |

Official references: [checkout release](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node release](https://github.com/actions/setup-node/releases/tag/v7.1.0), [upload-artifact release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2). Review changelogs and resolve a new full SHA when updating; do not replace these pins with floating major tags.

The source workflow passed on review commit `c89b8875263381d8e53cd1548bda2249b2d875c2`: 767 automated tests, TypeScript and the production build ([run 45777845204](https://github.com/nadimmokhtar-nam/NAM-OS/actions/runs/45777845204)). Later changes need their own run. A green source check does not replace hosted Supabase policies/storage/auth verification, live integration tests, responsive browser/accessibility review, recovery rehearsal or the four required full testing rounds. The separate isolated-provider workflow runs native browser scenarios and independent PostgreSQL transactions without studio credentials.

Maximum-size original-image delivery also requires acceptance on the actual hosting runtime; see [hosted media acceptance](docs/HOSTED_MEDIA_ACCEPTANCE.md). The current Netlify pilot's documented streamed-response ceiling is below the application's 50 MiB original limit. This is not a Vercel runtime pass or a reason to weaken private media authorization.

After successful execution, the repository owner can make **Validate production source** a required status check through the repository's supported branch-protection/ruleset settings. That configuration is separate from adding this workflow and is not claimed to have been applied.
