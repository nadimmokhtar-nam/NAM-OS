# Production Sales implementation and evidence

Updated 24 November 2026. This production domain uses Next.js server handlers and Supabase/PostgreSQL. The SQLite preview is not its production database.

## Implementation

- `lib/api/sales.ts` dispatches manual activities, paginated history, versioned edit/delete, weekly reports, founder reviews, monthly targets, connected reporting, sync and owner mapping.
- `lib/integrations/service.ts` uses user-authenticated Supabase calls for dashboard access. Provider adapters run server-side and reuse the separately tested, read-only API transport.
- `supabase/migrations/202611240004_sales.sql` supplies the tables, ownership policies, trusted write functions, activity counts, source aggregates and durable sync jobs. Assurance/session rules from later migrations apply through `nam_section` and `nam_founder`.
- The founder needs AAL2. A sales member with a verified MFA factor also needs AAL2 for both HTTP and direct database access. Inactive, foreign-workspace and non-sales identities cannot access the sales domain.

Manual activity ownership comes from the authenticated database identity. Input cannot assign another author. Writes support idempotency keys; reusing a key with different input fails instead of silently discarding the new input. Updates require the expected version. Deletion removes the activity from daily views while retaining an audit event. Weekly report resubmission clears its earlier review. Only a verified founder can set targets or review reports.

The manual activity list returns the latest 500 records. `activity_total` and `activity_counts` are database aggregates over all permitted activity history, including monthly target progress. Use these fields for totals, never the capped array length. `GET /api/sales/activities?limit=50&offset=0` provides paginated history.

Connected metrics also aggregate across the complete permitted snapshot. Provider record pages default to 20 and are bounded to 500 per request. Filters (`source`, `kind`, `owner`, `q`) and pagination (`limit`, `offset`) run in PostgreSQL. The shared connected-sales UI uses these server pages when the production response contains `records_total`/`records_limit`; its local demo remains compatible.

## Setup required for real data

The application has not authenticated NAM's live services. No live-source metrics are claimed. Connected ChatGPT Lemlist access does not supply an application credential.

Configure only through the server's secure environment:

| Variable | Required for |
| --- | --- |
| `NAM_INTEGRATIONS_WORKSPACE_ID` | Explicitly bind all configured keys to NAM's actual workspace UUID |
| `ATTIO_API_KEY` | Read-scoped Attio single-workspace Bearer token |
| `ATTIO_DEALS_OBJECT` | Optional slug, default `deals`; confirm the actual schema |
| `LEMLIST_API_KEY` | Lemlist Basic authentication using an empty username |
| `JUSTCALL_API_KEY`, `JUSTCALL_API_SECRET` | JustCall API authentication and an eligible plan |

No API keys are stored in PostgreSQL or sent to clients. Private fingerprints distinguish changed connection configurations; those fingerprints and job lease tokens are denied to direct client selects. A credential change invalidates old owner mappings before new data can become visible.

Before enabling a connection, confirm its account, API entitlement, objects/attributes, external user IDs, JustCall account timezone, expected record volume and retention. Then run a real tenant smoke test: first sync, repeat sync, ownership mapping, direct access denial, disconnected/expired credentials and recovery. Missing values remain unavailable; incomplete fetches are never published as successful snapshots.

## Sync jobs and scheduling

Each source has a PostgreSQL lease with a random token and 60-second expiry. The server renews it during long fetches and before committing. Only a matching, unexpired, non-null lease can atomically replace the source snapshot. Overlapping or late jobs cannot overwrite a successor. A failed job retains the last successful data and its timestamp. Rate limits preserve Retry-After; transient failures receive a safe retry delay.

`runScheduledIntegrations({supabase, workspaceId})` is a server-only runner. Its caller must validate a securely configured cron secret and use a service-role Supabase client. Database functions independently allow only the founder at AAL2 or the server service role. The runner never infers authority from a request body. No schedule is active simply because this helper exists; the deployment operator must configure and verify the scheduled endpoint.

Snapshot commits are capped at 50,000 normalized records per source. Provider adapters also have a 200-page ceiling and bounded response sizes. Limits fail explicitly and retain the previous snapshot. Widening these bounds requires a supported paging/window design and a load review.

## What reporting means

- Attio people are CRM people, not automatically qualified leads. Pipeline amounts remain separated by currency and actual provider stage. No guessed open-stage mapping or exchange rate is used.
- Lemlist activities cover the last 30 days. Campaign reports are lifetime team totals. Campaign totals are not attributed to Omar from a creator field. Sending-user attribution requires explicit owner mapping; automation is not proof of manual completed work.
- JustCall covers the last 30 days. Missing notes, call times and recordings remain missing. Account-local dates are labelled until the timezone is confirmed. Recording links are restricted to approved HTTPS provider hosts; no recordings are downloaded or republished here.
- `(workspace, source, kind, external_id)` prevents repeated-source duplicates. Cross-source people are not automatically merged. An unrelated person with a matching name or email never gains access.

## Verification completed locally

| Evidence | Result | Practical limit |
| --- | --- | --- |
| Production TypeScript check | Passed | Does not prove hosted configuration or provider behavior |
| Production handler contracts | 9/9 passed | Actual TypeScript handlers; mocked Supabase boundary |
| Portable provider adapter contracts | 14/14 passed | Fixture transports; no tenant credentials |
| Connected UI contracts | 5/5 passed | Rendering/handler contracts; browser/layout checks are separate |
| PostgreSQL Sales suite | 11/11 passed | Real PostgreSQL execution in PGlite; Supabase-managed auth/storage represented by shared fixtures |
| Provider aggregate read over 10,000 records | Local p95 20.2 ms across five 20-record page reads | One local run; not hosted HTTP latency, network sync latency or concurrent-user capacity |

The PostgreSQL review reproduced and corrected three defects: a null lease token could bypass completed-job checks; a null page size bypassed the database bound; and special PostgreSQL dates such as infinity could reach client date rendering. Explicit null validation and renderable date bounds now reject all three. Other tests cover role/tenant denial, founder and optional-sales MFA, version conflicts, repeat requests, stale job rejection, atomic failure retention, currency separation and credential rotation.

Run from the project root on Node.js 24+:

```sh
node --test test/integrations.test.mjs test/production-sales.test.mjs test/sales-connected-ui.test.mjs
node --test production/test/sales-db.test.mjs
```

`supabase/tests/sales.sql` contains additional staging pgTAP scenarios. That script has not been executed in a hosted Supabase project. Local PostgreSQL success does not establish live GoTrue, PostgREST, Storage, scheduler or vendor-contract readiness. Full release approval still requires the project's four documented testing rounds and all applicable hosted/integration/browser gates.

Official API references and source-specific authentication details are retained in the project-level `docs/INTEGRATIONS.md`.
