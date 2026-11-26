# NAM OS reinvention: verification and delivery checkpoint

Branch: `codex/nam-os-reinvention`. Baseline/current trial: `7f07fa7c88c82c87e58931cf15efc9c3c74d96c9`. Application source and additive migrations are implemented; the four cycles below use isolated infrastructure. The protected Netlify trial, `main`, real Supabase data and external sales tenants have not been modified. Hosted acceptance and deployment remain open.

## Cycle 1 — Functional workflows and data integrity

The final local suite passes **309 tests, zero failures/skips**. All numbered migrations execute in PostgreSQL/WASM with actual RLS, RPC permissions, role switches and integrity checks. Early implementation passed 301; later checks added public-asset security, connected decisions, export completeness and abandoned-upload recovery.

A separate disposable native Supabase stack runs PostgreSQL 17.12, GoTrue 2.198.0, PostgREST 16.6 and Storage 1.98.8. Migrations **001–021** apply locally. Eight confirmed synthetic Auth identities cover Founder, Sales Manager, two sales representatives, Production Manager, two artists and Freelancer. No hosted installer, owner bootstrap or reset was run.

Executed native workflows include:

- Password-only Founder login, verified membership and the actionable studio brief.
- Project creation, explicit participants, shared brief, assigned deliverables and denial of another owner's tasks/unshared briefs.
- Concurrent owner/Founder updates: one success, one explicit conflict, with the accepted data retained.
- Actual private Storage upload, stored-byte/container/SHA validation, immutable publication, pinned enrollment, native video playback, captions, seeking and denial after revocation.
- Sales activity persisted to its authorized ledger. Manual activity remains labelled separately from external provider reporting.
- Sales report read/review from Today, a concurrent author resubmission, rejection of the stale review, and successful review of the reloaded version.
- Artist practical submission → Founder requested changes → feedback in the artist's daily brief → resubmission → approval, without fabricating or resetting reading-completion records.

A real one-second H.264 fixture and a valid MP4 larger than 4 MiB were used. The latter places actual media after the first response boundary and adjusts chunk offsets, forcing a later authenticated range to play. Its decoder and native playback/seek checks pass. Uploads go directly to private Storage; response ranges are capped at 4 MiB for the documented Netlify binary envelope. This is not a hosted-adapter or 50 MiB maximum-upload certification.

The release review found abandoned pending videos permanently occupying active upload slots. Migration 021 counts only linked pending work and serializes the shared workspace quota across courses. The regression proves slot recovery while metadata, stored objects and byte reservations remain retained. Unlinked bytes continue counting against the 512 MiB safeguard; reclaim/garbage collection is not automatic.

## Cycle 2 — Interface and interaction quality

Nine production-browser checks cover 360, 390, 768, 1024 and 1440 px across Today, Work, Projects and Academy; task shortcuts/focus; unsaved-change rejection; native conflict/draft recovery; keyboard installation help; and automated WCAG 2.2 AA rules on Today, Work, Projects, Academy, Settings and a task dialog. Sales-report and practical-review dialogs also pass automated checks.

Observed defects/refinements:

- Desktop installation control overlapped lesson completion. It now occupies the page footer.
- Mobile navigation needed reliable focus containment and background isolation. It now traps focus, has an explicit close control, makes background work inert and restores the trigger on Escape.
- Small upload fixtures displayed zero MiB. Sizes now use bytes/KiB/MiB appropriately.
- A return to Today could display a cached brief after another person reviewed an assignment. Returning refreshes it; Refresh is also explicit.
- Overdue/review work appeared again in current priorities. The groups are distinct; Attention's View all includes future-dated review work.
- Date-only values retain their studio calendar meaning; an unsupported text arrow was replaced with the shared SVG icon.

Two early mobile failures and one task-creation failure were test-selector/timing mistakes, corrected to target the actual navigation link and the intentionally opened task brief. A sales contract fixture was updated to accept bootstrap query parameters; asynchronous connected-sales refresh is now awaited so failures reach the normal error path.

Reduced motion is respected. Automated rules and headless keyboard checks do not certify real assistive-technology or device behavior.

## Cycle 3 — Performance and eight-user behavior

The first production run seeded 10,000 tasks, used eight real managed sessions and measured an initial **2,341.64 ms** p95 for the automation's Work-opening probe, above its two-second goal. The failure was retained, not discarded.

Corrections remove Auth refresh from public assets while retaining security headers, remove duplicate task pages from bootstrap, render an initial 50 summaries, preload the public module graph during hydration, and defer Today/Academy reads when opening Work. Pages/APIs retain session refresh, verified context, signed mutation checks and database authorization. Deferred cached context is retained only for the same identity, role and access revision.

Further recorded runs exposed coarse timing in the probe: default page-load waiting and `expect` visibility polling reported readiness hundreds of milliseconds after task data arrived. The final probe waits for DOMContentLoaded and the first visible, enabled task directly. Earlier timing files remain under `evidence/reinvention/`; **the protocols differ, so a direct percentage speedup between the old and final browser numbers is not claimed**. The request waterfall separately shows earlier module loading and fewer startup reads.

Final measured values are in [performance.json](evidence/reinvention/performance.json) and [startup-waterfall.json](evidence/reinvention/startup-waterfall.json). This is a signed-in route-opening measurement, not password-entry time.

| Check | Samples | Final p95 |
| --- | ---: | ---: |
| 100-item task API page | 80 | 137.6 ms |
| Independent write including context refresh | 8 | 620.78 ms |
| Daily brief | 40 | 279.38 ms |
| Eight concurrent visible, enabled Work screens | 8 | 1828.27 ms |

Maximum 100-record summary: **67855 bytes**. All returned task rows belong to the requesting identity. Parallel stale writes produce one winner and one conflict. All eight users then return to Today in the same session and receive a complete brief. Load cleanup touches only this isolated run's tagged synthetic tasks and preserves audit history.

These are loopback measurements and bounded bursts on one cloud machine. They establish neither Internet/EU-database latency nor long-duration capacity or a production SLA.

## Cycle 4 — Full regression and release review

**Complete locally: 17/17 native production-browser tests pass in one assembled run**, with zero failures/skips. This includes seven functional/decision workflows, nine interaction/accessibility checks and the eight-user performance/isolation test. Final unit/database result: **309/309 passed**, zero failures/skips.

Final source passes locked `npm ci`, TypeScript/optimized webpack build, all 309 unit/database checks and dependency advisory review. `npm audit` on the current lockfile reports **zero known vulnerabilities**, including development dependencies. Source/diff checks and a changed-file credential-literal scan found no credential literals; generated keys/profiles/session state remain outside Git. This is engineering verification, not a penetration-test certificate.

Product source identity: **build-179776f15dd4250c**. The QA build embeds loopback bindings and must not be deployed. Rebuild the reviewed branch with the intended secure hosting configuration.

Founder-only business JSON export version 4 now includes projects/participants/history, published learning structure, access grants/history and video metadata/references. It excludes Auth, credentials and binary media. Database and private Storage backup/restore remain separate recovery requirements. Existing migrations 001–015 and published data are not rewritten.

## Additional Netlify packaging check

Committed application source `31a2244` was packaged in a separate accountless snapshot with official Netlify Build 37.7.6, Deno 2.4.2 and the pinned Next.js adapter. The engine returned success and produced Node 24 SSR and Proxy Edge artifacts. Generated middleware routes retain workspace/private APIs and exclude static chunks/images. **Edge configuration inspection remains incomplete** because its official types import from `edge.netlify.com` is denied by the live network policy. The helper returns exit 2 for that warning instead of treating engine success as a full pass. No hosted runtime or deployment is inferred. [Executed details and reproduction](NETLIFY_REINVENTION_PACKAGING.md) · [bounded proof](evidence/reinvention/netlify-packaging.json).

## Before-and-after evidence

| Workflow | Baseline client | Implemented client |
| --- | --- | --- |
| Founder overview | [Before](evidence/reinvention/before-overview-baseline-client.png) | [Today](evidence/reinvention/after-overview-final.png) |
| Academy | [Before](evidence/reinvention/before-academy-baseline-client.png) | [Learning](evidence/reinvention/after-academy-final.png) |
| Artist production | Previously a tasks-only section | [Shared brief and assigned deliverables](evidence/reinvention/after-project-artist.png) |
| Private learning media | Previously written content only | [Native authenticated playback](evidence/reinvention/after-academy-video.png) |
| Central review | Separate Sales/Academy visits | [Daily decisions](evidence/reinvention/after-today-decisions.png) |

Baseline screenshots render exact client/CSS assets from the deployed commit against the isolated synthetic records/current compatible API. They are not screenshots of the inaccessible hosted site and do not represent an old-server benchmark. `tools/capture-reinvention.mjs` reproduces that comparison. Mobile evidence is also retained.

## Reproducibility and remaining delivery gates

[Cloud development](CLOUD_DEVELOPMENT.md) documents executable helpers, managed-Docker loopback health correction, private state, exact test commands and restoration limits. The required services are healthy; no health checks, TLS or artifact verification were disabled. The runtime was rechecked after environment-start notices; retained processes were present. A brand-new snapshot restoration has not been verified.

The reusable environment configuration draft is saved, including install/start instructions and the required Figma, staging/Supabase, Netlify API/Edge bootstrap and image-registry hosts. It is **not applied or published**. Review and save it in environment settings, then publish to activate it. The live environment still has no custom allowed hosts or injected hosted credentials.

Open gates:

1. Secure NAM-owned Netlify deployment access, existing Supabase/workspace bindings, and a deliberate separate HTTPS preview origin that preserves the current trial.
2. Protected Figma-frame inspection and reconciliation with the actual owner design references.
3. Hosted pending-migration review/application, backup/restore rehearsal and real Netlify Auth/Storage/range/callback/CSRF/CSP checks; no initial installer/bootstrap/reset.
4. Actual Attio/Lemlist/JustCall attribution/freshness and existing scheduled-job verification.
5. Real devices/screen readers, maximum-size video, and longer-duration capacity testing.
6. Later product expansion: contextual learning recommendations, multi-course onboarding paths, render annotation and explicit production sign-off gates. These are not presented as completed features.

[DEPLOYMENT.md](../DEPLOYMENT.md) is the concrete handoff for the existing Free infrastructure. No merge into main, production deploy, paid upgrade, external outreach or unattended development after this session is claimed.
