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

## Native sales workspace — 25 November 2026

`lib/api/sales-workspace.ts`, `public/sales-workspace.js` and `public/sales-workspace.css` add compact, paginated native views over the existing provider snapshots. Attio remains the CRM source of truth. There is no local contact, company or opportunity write model, and no provider write or outreach endpoint.

| View | Real records and definitions |
| --- | --- |
| Contacts | Attio people, email, job title and only permitted company relationships |
| Leads | Attio people with a value in the explicitly configured lead-status attribute; qualification uses exact configured values |
| Companies | Attio companies, domain and explicitly mapped owner |
| Opportunities | Attio deals, stage, value, currency, permitted company/people relationships and optional configured close date |
| Pipeline | Complete permitted snapshot by actual stage, category and original currency; missing values counted separately |
| Follow-ups | The actual central `nam_tasks` sales records, with optional source links, status, owner, due date and task history |
| Campaigns | Lemlist lifetime team report totals; reply-to-sent is a provider event ratio, not unique-lead conversion |
| Outreach / Calls | Lemlist events and JustCall calls from the existing 30-day snapshots; no event is automatically treated as manual work |
| People | Explicitly owned provider counts, complete current-month manual activity counts, central open/overdue tasks; periods remain distinct |
| Revenue & forecast | Founder-agreed NAM objectives, Attio won deal values and dated open opportunities with record-supplied probabilities |

Record pages default to 30 and are capped at 100. Query filtering, counts, pipeline, forecast and person aggregates run in PostgreSQL over the complete permitted snapshot. Search affects the selected record page; reporting aggregates cover the selected owner scope. Company and person relationship labels are joined only through other visible records. Neither names nor email matches grant access or merge sources.

`202611250031_sales_workspace.sql` introduces only revenue objectives, their audit history, idempotent follow-up requests and source-to-central-task links. Creating a follow-up calls the existing trusted task creation path in the same transaction as the link. An inaccessible source rolls back the task as well. Link changes increment the central task version and append a generic task-history event. Existing source links cannot be silently overwritten; remove a link explicitly before choosing a new one. Removing a source link retains the central task.

Source links are bound to the snapshot credential/configuration fingerprint. Disconnecting or changing a connection hides the source context while leaving the actual central task available to its permitted owner. Once a changed connection is verified and owners remapped, remove and reattach any older task link that should use that connection. Fingerprints are never serialized in the API response and have no direct authenticated column grant.

### Additional release configuration

Keep the existing required server variables above. Attio query records requires `record_permission:read` and `object_configuration:read`, with read access to each enabled object. Confirm NAM's actual attribute slugs and status IDs with the workspace admin. The application does not infer an owner, qualified lead, won/lost category, close date or probability from a record name, stage spelling, campaign creator or email address.

`ATTIO_REPORTING_SCHEMA` is optional server-only JSON, at most 16,000 characters. Its supported fields are:

| JSON path | Meaning |
| --- | --- |
| `people.owner` | Actor-reference attribute used for explicit person ownership; default `owner` when omitted, which may be absent on people |
| `people.leadStatus` | Real status/select/text attribute holding NAM's lead lifecycle; no default |
| `companies.owner` | Actor-reference owner attribute; default `owner` when omitted |
| `deals.owner`, `deals.stage`, `deals.value` | Real deal attribute slugs; defaults `owner`, `stage`, `value` |
| `deals.closeDate` | Date attribute for projected close; no default |
| `deals.closedDate` | Date attribute for the actual close date; no default |
| `deals.probability` | Numeric attribute containing the deal's real probability; no stage-based probability is invented |
| `probabilityScale` | Required with probability mapping; exactly `1` for a ratio or `100` for a percentage |
| `stageCategories` | Object mapping exact Attio status IDs (preferred) or exact titles to `open`, `won`, `lost`; unmapped stages remain unclassified |
| `qualifiedValues` | Array of exact real lead-status values counted as qualified; absent mapping leaves qualification unavailable |

Structural example only — replace every attribute/status placeholder with verified NAM values before configuring:

```json
{
  "people": {"owner": "verified_person_owner_slug", "leadStatus": "verified_lead_status_slug"},
  "companies": {"owner": "verified_company_owner_slug"},
  "deals": {
    "closeDate": "verified_projected_close_slug",
    "closedDate": "verified_closed_date_slug",
    "probability": "verified_probability_slug"
  },
  "probabilityScale": 100,
  "stageCategories": {
    "verified-open-status-id": "open",
    "verified-won-status-id": "won",
    "verified-lost-status-id": "lost"
  },
  "qualifiedValues": ["Verified qualified status title"]
}
```

Changes to this JSON change the Attio configuration fingerprint. Run a complete successful sync and explicitly remap owners before exposing the new snapshot. Missing optional attributes stay null; malformed configuration fails the sync while retaining the previous snapshot. Attio people-to-company uses the official `company` attribute; deal relationships use `associated_company` and `associated_people`.

Revenue objectives use their original currency. Progress is Attio won deal value, not recognized accounting revenue. It remains unavailable without configured stage categories and closed-date mapping, when stages are unclassified, or when won records have missing dates or values. The forecast includes only configured open opportunities whose projected close month matches the selected month. Known value is an explicitly labelled subtotal; weighted value stays unavailable if any included deal lacks value or a valid probability. Undated, unclassified and unknown-currency records are counted separately. Current closed win share is `won / (won + lost)` from the snapshot; historic funnel conversion remains unavailable because no stage-history feed has been authenticated or imported.

### Root integration points

Dispatch `dispatchSalesWorkspace` before the existing `dispatchSales` in the shared API route, preserving its managed-session, elected-MFA, origin and CSRF checks. The handler supports:

| Method / path | Action |
| --- | --- |
| `GET /api/sales/workspace?view=contacts&owner=&q=&period=2026-11&limit=30&offset=0` | Read the selected view; allowed view names are exported by the client module's view picker |
| `POST /api/sales/workspace/followups` | Atomically create a central sales task plus its current source link; `Idempotency-Key` required |
| `POST /api/sales/workspace/links` | Link an existing permitted sales task using its expected task version |
| `DELETE /api/sales/workspace/links` | Remove a task's source link using its expected task version; retains the task |
| `POST /api/sales/workspace/targets` | Founder-only revenue objective create/update with optimistic revision |

Create one `createSalesWorkspace` instance with the existing `request`, `openDialog`, `closeDialog`, `toast`, a `getContext` function returning the current bootstrap, `onChange` to render, and `onMutation` to refresh shared task state. Also pass the shared `canLeave` draft guard, `onBusy` callback and a `contextKey` containing the route/actor/view identity. Include `isSaving()` in the shared navigation/close guard; `syncBusy()` can reapply disabled controls after rendering. Existing generic dialog draft tracking covers every Sales form. Add a Sales CRM & pipeline tab calling `load()` on entry and `render()` for its content. Call `reset()` on session/actor changes. Load `sales-workspace.css` alongside the other workspace styles. Existing Connected reporting remains the connection-status, sync and explicit-owner management surface. New HTML uses no inline styles and does not require a CSP exception.

### New verification and remaining gates

The portable adapter/client suite (`node --test test/sales-workspace.test.mjs`) passes **9/9 locally** using fixture transports. The actual TypeScript-handler contract suite (`test/sales-workspace-api.test.mjs`) passes **6/6 locally** using Node's type erasure and mocked authenticated database boundaries. JavaScript syntax checks pass. The PostgreSQL suite below has been added for the root CI environment; its new results must be recorded by the release owner after execution:

```sh
node --test test/sales-workspace-db.test.mjs test/sales-workspace-api.test.mjs
```

Those suites cover owner/tenant/section/session/MFA denial, private relationship labels, complete aggregation independent of record pages, separated currencies, incomplete weighted forecasts, transactional/idempotent central-task creation, stale task versions, source rotation redaction, founder objective revisions and API validation.

Live Attio, Lemlist and JustCall application credentials, plan entitlements, real account identity, attribute/status mappings and external owner mappings are **not verified**. A connected ChatGPT service is not a deployed application credential. Hosted migration execution, real provider smoke tests, browser/layout/accessibility checks and the existing release gates remain required. No deployment, migration, outreach or vendor mutation is performed by this implementation.

### Primary API references checked for this extension

- [Attio list/query records and required scopes](https://docs.attio.com/rest-api/endpoint-reference/records/list-records)
- [Attio deal attributes and configurable stages](https://docs.attio.com/docs/standard-objects/standard-objects-deals)
- [Attio people and company relationship](https://docs.attio.com/docs/standard-objects/standard-objects-people)
- [Attio status shape and exact status IDs](https://docs.attio.com/rest-api/attribute-types/attribute-types-status)
- [Attio dates](https://docs.attio.com/rest-api/attribute-types/attribute-types-date), [numeric attributes](https://docs.attio.com/rest-api/attribute-types/attribute-types-number), [phone numbers](https://docs.attio.com/rest-api/attribute-types/attribute-types-phone-number)
- [Lemlist Basic authentication](https://developer.lemlist.com/api-reference/getting-started/authentication), [campaign reports](https://developer.lemlist.com/api-reference/endpoints/campaigns/get-campaign-reports), [activity endpoint](https://developer.lemlist.com/api-reference/endpoints/activities/get-many-activities), [exact activity types](https://developer.lemlist.com/api-reference/objects-definitions/activity)
- [JustCall authentication](https://developer.justcall.io/reference/authentication) and [v2.1 call list, timezone and history bounds](https://developer.justcall.io/reference/call_list_v21)
