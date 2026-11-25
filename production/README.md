# NAM OS

NAM Studio's private operating workspace, built with Next.js 16, Node 24 and Supabase. The implementation branch is `codex/nam-os-reinvention`, based on trial commit `7f07fa7c88c82c87e58931cf15efc9c3c74d96c9`. The existing trial, database and `main` have not been changed by this initiative.

## Daily experience

- **Today:** personal priorities or a Founder studio brief, project deadlines, blockers, production reviews, recent completions, team commitments, sales activity and direct sales-report/Academy decisions. Returning to Today refreshes the brief; Refresh is also explicit.
- **Work:** one shared task system with ownership, dates, priority, project/production context, checklists, comments, private files and history. Server-side time/attention filters, list/board views, bounded pages, version conflicts and retry protection remain intact. `N` creates work, `/` focuses search and `?` explains shortcuts outside forms.
- **Projects:** real shared briefs and explicit participants. Existing tasks become image/deliverable work through a project link and CGI production stage. No duplicated ownership, due date or completion record. Project participation shares the brief; assigned-only users still see only their own tasks.
- **Academy:** assigned learning leads with the next unfinished course/lesson. Immutable publications, pinned enrollment, modules, written resources, completion history and practical reviews remain. Actual private MP4/WebM uploads support native playback, authenticated seeking, optional WebVTT captions and publication-pinned media.
- **Studio:** existing Sales, Library, Team, Operations, account/security and integration capabilities remain accessible. Attio remains the CRM, Apollo remains external prospecting, and Lemlist/JustCall data retain source attribution and freshness. Today labels manually logged activity separately from provider figures.

Password sign-in works for every role, including Founder. An elected verified authenticator requires its challenge; enrollment is optional. Existing explicit section grants and assigned-only manager/artist access remain unchanged.

## Checks

```sh
npm ci --no-audit --no-fund --cache /workspace/.cache/npm
npm run typecheck
npm test
npm run build
```

Tests execute application code and all numbered migrations under actual PostgreSQL/RLS in PGlite. The separate browser suite uses eight real synthetic identities and native Supabase Auth/PostgREST/Storage in a disposable local stack. See [cloud development](docs/CLOUD_DEVELOPMENT.md) for executable startup instructions and [validation evidence](docs/REINVENTION_VALIDATION.md) for results, corrections and limits.

The normal build regenerates the PWA source identity. A changed public Supabase build binding requires a new build. Never deploy the compiled isolated-QA `.next` directory to the real studio host.

## Existing infrastructure

Netlify site `nam-os-staging`, deployment branch `main`, base `production`, build `npm run build`, Free plan. Supabase project `ltkdycibqnqmwqeejcvs`, Ireland, already has migrations 001–015. Preserve its data and accounts: **do not rerun an initial installer, owner bootstrap or reset**. This branch adds migrations 016–021; hosted application remains a separate verified delivery step.

Use [DEPLOYMENT.md](DEPLOYMENT.md) for the actual infrastructure and preview/release procedure. Server credentials and workspace identifiers belong in secure environment/provider settings. Do not paste them into chat or commit them.

Private video is limited to 50 MiB per upload and a 512 MiB workspace reservation safeguard. Playback ranges are capped at 4 MiB for the documented Netlify binary response envelope. There is no transcoding or automatic caption service. Business JSON export includes project, learning, access-grant and video metadata; database and private Storage backups remain necessary for recovery.

Hosted Netlify, the owner's real Supabase tenant, sales-provider reconciliation, protected Figma frames and device/screen-reader acceptance require access and direct verification. Local tests do not establish those checks or deployment.
