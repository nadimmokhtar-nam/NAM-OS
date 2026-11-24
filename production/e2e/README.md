# Isolated real-service browser QA

This suite uses the actual local Supabase Docker stack (Postgres, GoTrue Auth, PostgREST and Storage) and the production Next.js build with eight password-only **synthetic** cohort identities and one additional identity that explicitly opts in to MFA. It does not connect to NAM's hosted projects, sales accounts or client files. There is no production auth emulation or test-only bypass in the application.

The repository-root `.github/workflows/staging-tests.yml` workflow supports manual execution and pull requests to main that change the harness, local Supabase configuration/migrations or that workflow. Its local source lives alongside this application under `.github/workflows/staging-tests.yml`; the publishing process maps it to repository root. It has read-only repository permissions, no application secrets, a bounded runtime and no deployment. Do not run it against a linked checkout or change a local CLI command to `--remote`.

## Pinned tools

- Supabase setup-cli action v3.2.0, commit `689adcfb80d947100a1eab127289b97d1fb07b13`; exact CLI 3.4.0.
- Playwright Test 1.65.1 in this directory's independent package-lock.json; Node.js 24; Chromium installed using that package's CLI.
- Official checkout/setup-node/upload-artifact actions use the existing full SHA pins reviewed for NAM OS CI.

Versions and action metadata were checked against the official GitHub release/tag APIs on 24 November 2026. The local config uses CLI v3's `[local_smtp]` and email-provider `enabled` keys, while global Auth signup remains disabled. `supabase db reset` deliberately has no remote argument; local is CLI v3's default. The fresh Docker database receives the real migrations before provisioning.

## Private runtime data

`stack.mjs start` captures all CLI output—including default local API keys—in a private runner temporary directory. It validates API/database URLs are loopback addresses, refuses linked/remote configs and pre-existing containers/volumes for the reserved `nam-os-ci` project before any reset, masks local keys in GitHub Actions and writes a mode-0600 `stack.env`. Cleanup requires the ownership marker from that invocation; it does not stop or delete a pre-existing stack after a failed preflight. Never print the private files or CLI status object. On a CLI failure only a fixed error category, exit code and strictly matched migration filename may appear publicly; raw output remains private.

The security provisioning helper receives these local settings, requires `NAM_E2E_ALLOW_PROVISION=1`, refuses existing users/data and creates nine confirmed test accounts through the actual provider's Admin API. Its private fixture and runtime files remain outside artifacts. Accounts are generated for the founder, sales manager, two sales representatives, production manager, two artists and freelancer. The eight cohort accounts, including Founder, have no enrolled factor. A ninth Sales identity is separate in `securityAccounts` and explicitly enrolls a real TOTP factor. Its AAL1 access must fail in API, SSR and RLS/RPC; completing the actual challenge must restore only its assigned permissions. The password-only Founder must access business data and visit `/mfa` without being forced to enroll. Real optional MFA/session behavior is exercised rather than inserting fake trusted sessions.

The workflow privately builds Next.js, starts it at `http://127.0.0.1:3000`, waits for the login page, runs six real HTTP security checks, then runs thirteen required browser cases with one worker. Authentication cookies, passwords, factor keys, raw HTTP payloads and full CLI/server/build/TAP logs are not uploaded. Failed stages produce an actual failing check, not an assumed pass. The local config raises only the disposable test stack's sign-in/refresh/verification rate limits to allow eight accounts and concurrency checks; these are not production limits.

Only the custom reporter's safe-results.json and validated api-results.json may be uploaded. Masked post-login workspace captures, when explicitly enabled, remain on the private disposable runner and are not published to public-repository artifacts. They are not retained after that runner is destroyed unless separately saved to an authorized private destination. API evidence is copied through a strict case-name/counter/status allowlist, even after failure; missing execution is not_run and invalid claims fail validation. Setup failures retain only a fixed stage/category. Screenshot capture must assert the expected loopback host, logged-in non-auth route, no token URL, no open dialog and no password/authenticator/recovery input. Traces, videos, HTML/JUnit reports, storageState, raw failure stacks, `.env` and private fixtures are excluded. No failure screenshot is automatically captured.

## Local reproduction

Requires a disposable Docker environment, Supabase CLI 3.4.0, Node.js 24, npm and psql. Run from the production directory with no `.temp/project-ref`, no hosted environment settings and no real local NAM records:

```bash
npm ci
npm ci --prefix e2e
(cd e2e && npx --no-install playwright install --with-deps chromium)
export RUNNER_TEMP="$(mktemp -d)"
export NAM_E2E_ALLOW_PROVISION=1
export NAM_E2E_SAFE_SCREENSHOTS=1
umask 077
node e2e/stack.mjs start
source "$RUNNER_TEMP/nam-os-e2e/stack.env"
node e2e/provision.mjs
source "$RUNNER_TEMP/nam-os-e2e/runtime.env"
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
# In a second terminal with the same private environment loaded:
npm test --prefix e2e
# Stop the owned Next process, then:
node e2e/stack.mjs stop
```

Never source private runtime files while shell command tracing is enabled. Delete the owned temporary fixture directory after inspection. The workflow handles its owned Next process and stops disposable local services even after test failure.

## Evidence boundary

No local Docker/browser execution is claimed merely because these files exist. Read the completed GitHub Actions run and its safe report for the exact commit. A pass verifies isolated Linux services and emulated browser viewports; it does not verify the configured hosted NAM tenant, live third-party integrations, native Mac/Windows installation, external email delivery, production backups or the four required full release testing rounds.

Primary references: [Supabase local CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [CLI v3 migration rules](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3), [Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config), [Playwright CI](https://playwright.dev/docs/ci).
