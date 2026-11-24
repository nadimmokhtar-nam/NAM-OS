# Protected scheduled work

The production route `/api/jobs` can process in-app task reminders and invoke the read-only sales sync runner. It is implemented but **no schedule has been activated** and no hosted scheduler invocation has been verified.

## Secure setup

Configure these only in the server/deployment environment:

| Variable | Requirement |
| --- | --- |
| `NAM_CRON_SECRET` | Random, at least 32 characters, no whitespace; recommend a 64-character random hex value |
| `NAM_INTEGRATIONS_WORKSPACE_ID` | NAM's exact workspace UUID; requests cannot override it |
| `NEXT_PUBLIC_SUPABASE_URL` | The actual Supabase project URL |
| `SUPABASE_SECRET_KEY` | Preferred server-only Supabase secret key |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy service-role JWT alternative if a new secret key is not configured |

The server creates a separate Supabase client with session persistence, token refresh and URL session detection disabled. It does not use the SSR cookie client or incoming user credentials. Never prefix a privileged key with `NEXT_PUBLIC_`, paste it into chat, or commit it to source.

An authorized invocation sends exactly `Authorization: Bearer <NAM_CRON_SECRET>`. The comparison hashes both strings to equal-length buffers and compares them in constant time. Missing/weak configuration fails closed. Cookies do not authenticate this endpoint. Query parameters and request fields are rejected, so a caller cannot select another workspace or change the job's behavior.

For Vercel Cron, securely set **`CRON_SECRET` to the same value as `NAM_CRON_SECRET`**. Vercel injects `Authorization: Bearer $CRON_SECRET`; it does not know NAM's custom variable name. Configure a production schedule only after verifying one authorized invocation, denial of an unauthorized invocation, source credentials, reminder deduplication and source lease behavior. This repository intentionally adds no active cron registration.

## Behavior and results

- Task reminders use `nam_process_reminders` with the fixed workspace. Database deduplication prevents repeated notifications for the same task/date.
- Provider sync uses durable per-source database leases and atomic snapshots. A missing provider credential is reported as `not_connected`; it is not reported as live data.
- Expected source backoff appears as `retry_later`. A failed source or reminder produces HTTP 502 with separate result statuses, so partial completion remains visible.
- Results include a unique invocation ID and start/finish times. No secret, raw upstream response or recording content is returned.
- This endpoint does not start an always-running background process. It performs work only when invoked. A deployed schedule remains an explicit external configuration step.

The route uses Node.js and requests a 300-second function duration. Actual deployment limits depend on the selected hosting plan. If supported provider pagination cannot finish within the available duration, use a durable background worker and checkpointed import; do not publish a partial snapshot.

## Local verification

`production/test/jobs.test.mjs` executes the actual TypeScript helper with injected clients and sync functions. Eleven tests pass: incorrect/missing credentials, weak secrets, separate service client configuration, fixed tenant binding, forbidden payload overrides, publishable-key rejection, malformed project setup, sanitized failures, partial outcomes, malformed source results, payload bounds and method rejection. These tests make no real provider calls.

```sh
node --test production/test/jobs.test.mjs
```

Direct database behavior is tested separately in the PostgreSQL task/Sales suites. Hosted Supabase authentication, the real service key and Vercel Cron still require staging verification.

Official references checked 24 November 2026:

- [Vercel Cron bearer authentication](https://vercel.com/kb/guide/ship-a-express-app-on-vercel)
- [Supabase server administration client configuration](https://supabase.com/kb/troubleshooting/performing-administration-tasks-on-the-server-side-with-the-servicerole-secret-BYM4Fa)
- [Supabase API key types](https://supabase.com/docs/guides/getting-started/api-keys)
