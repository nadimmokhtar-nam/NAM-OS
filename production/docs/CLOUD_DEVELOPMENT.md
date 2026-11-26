# Cloud development and isolated QA

Use the existing checkout at `/workspace/NAM-OS`; commands below run from `production/`. Node 24, managed Docker and system Chromium are available in the tested instance. No worktree, paid service or hosted credential is needed for the isolated suite.

## Fast source checks

```sh
npm ci --no-audit --no-fund --cache /workspace/.cache/npm
npm run typecheck
npm test
```

The unit/database suite applies all migrations to PGlite with controlled Auth/Storage boundaries. It requires no Docker and does not contact the studio project.

## Actual local provider and browsers

```sh
node tools/isolated-supabase.mjs start
node tools/isolated-dev.mjs prepare
node tools/isolated-dev.mjs build
node tools/isolated-dev.mjs start --production
```

Keep the last process in its own managed command session. In a second command session:

```sh
NAM_QA_MODE=production npm exec -- playwright test --config=playwright.config.mjs
```

The helper pins Supabase CLI 3.4.0 outside the checkout, creates only the unlinked `nam-os-qa` configuration, disables seeds/public signup and starts native PostgreSQL, GoTrue, PostgREST, Kong and Storage. Pending migrations apply through `migration up --local`. It deliberately has no reset, link or remote-push command. `migrate` and `status` are also supported. The preparation helper creates eight confirmed synthetic identities in this disposable stack and uses their authenticated RPCs for a real project, tasks and assigned Academy content. It never runs the hosted owner installer.

On this cloud machine, BusyBox wget ignored `NO_PROXY`, causing healthy local Auth/Storage containers to fail health probes. The helper preserves pinned official images and builds tiny local overlays. Only the two exact CLI loopback health probes receive `wget -Y off`; every other call delegates to the original binary. TLS/artifact verification and health checks remain enabled. The preserved official image digests are in the script. Unneeded services are excluded to reduce resources.

The stack is not the owner's Supabase tenant. The fixed synthetic workspace UUID must never be used in hosted configuration. All provider bindings are checked for loopback; no hosted fallback exists.

## State, logs and restoration

Private generated passwords, provider keys, signed-in browser states and diagnostics are kept outside Git under `/workspace/.cache/nam-os/isolated`. JSON credentials and session files use mode 0600. CLI logs can contain generated keys: inspect only a sanitized subset and never paste them into chat or commit them. Browser tests disable traces to avoid retaining login values.

Processes do not survive an environment restore by assumption. Run `status`, inspect your own recorded process, and start the stack/app as required. Stop only a process/container owned by this QA task; no broad kill or prune is necessary. `start` was tested against the retained running stack and applied no destructive reset. A brand-new cloud snapshot restoration has not been verified.

Changing public Supabase build variables requires rebuilding. The normal product build regenerates tracked PWA identity files. The environment onboarding install script uses `npm --ignore-scripts run build` to avoid modifying protected source just for dependency setup; an authorized implementation/release build uses normal `npm run build`.

## Evidence and limits

The browser suite uses eight distinct managed sessions across six role templates. It checks Founder, sales, artist and freelancer access, real private video, stale writes/reviews, responsive keyboard flows, automated accessibility and bounded concurrency with 10,000 synthetic tasks. Each performance run removes only its own tagged temporary load tasks through an isolated guard, preserving audit history.

Screenshots and safe aggregate performance JSON are under `docs/evidence/reinvention/`; detailed private failure artifacts remain in the cache. The checked-in 2.5 KiB MP4 is a generated H.264 synthetic test video. The range fixture adds a valid free box and adjusts MP4 chunk offsets so actual media lies beyond the first 4 MiB response, requiring a subsequent range to play. No real client artwork or employee credentials are used.

These tests establish behavior on actual local provider software. They do not establish protected Netlify acceptance, Internet/EU-database latency, maximum upload size, real provider reconciliation, device/screen-reader certification or a long-duration capacity result. See [the current validation log](REINVENTION_VALIDATION.md) and [deployment guide](../DEPLOYMENT.md).

## Optional Netlify adapter packaging

[NETLIFY_REINVENTION_PACKAGING.md](NETLIFY_REINVENTION_PACKAGING.md) records the actual accountless build and its incomplete Edge-types inspection. `tools/verify-netlify.mjs` archives committed HEAD, removes hosted bindings from its child environment and builds outside the checkout using pinned tooling. It never deploys. Exit 2 deliberately marks the known network-dependent inspection warning; do not call it a clean release pass.
