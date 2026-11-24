# NAM OS online application

Next.js, TypeScript and Supabase source for NAM Studio's private workspace. **This is development source, not a released team application.** The production build has passed. Hosted identity, real integration tenants, PWA installation, recovery and all four full QA cycles remain release gates.

## Implemented source

- Invite-only server-managed authentication, MFA, password setup/recovery, trusted membership and signed mutation protection. HttpOnly cookies and database checks reject revoked sessions and insufficient assurance.
- Shared section tasks, personal/studio views, lists/boards, ownership, priorities, dates, comments, subtasks, optimistic edits, archive/restore, notifications and history.
- Written Academy across Sales, 3D and Post-production, immutable publications, pinned enrollments, persistent progress and practical submissions/review. Module/resource expansion is tracked in the current workstream.
- Sales activities, reports and founder targets. Read-only Attio, Lemlist and JustCall adapters with source freshness, ownership mapping, bounded pages and protected sync leases. App credentials and real tenant reconciliation remain required. Attio is the CRM; Apollo prospecting is an external dependency.
- Private small task attachments. Actual stored bytes are validated before a service-only attestation makes files available. Ordinary data and file access use the user's JWT and database policies.
- Approved NAM logo, shared interface and task-first Projects/Library workspaces. Expanded production management and asset catalogues remain phased work.

## Reproducible checks

Use Node.js 24 and the committed lockfile:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

The production build uses webpack, which has been executed successfully. Tests include actual PostgreSQL/RLS/RPC execution in PGlite and controlled API/UI contracts. Managed Auth/Storage schemas and provider network boundaries are fixtures. These checks do not prove hosted Supabase behavior, real network concurrency, device accessibility or desktop installation.

Additional local/provider tests live in the parent implementation. That SQLite server is a development reference, not the production persistence layer.

## Configuration and deployment

Start with an isolated Supabase staging project. Review and apply **all** numbered SQL migrations in order; later migrations enforce the current identity and data policies. Disable public signup. Provision the first founder through the reviewed operator path using a confirmed Auth identity. There is no public setup or self-promotion endpoint.

Set configuration only through secure local/provider settings. The project reference alone is not account access. Never commit credentials, database files or runtime state.

| Variable | Purpose |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Project URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public API key, with RLS protecting records |
| NAM_APP_ORIGIN | Exact HTTPS application origin |
| NAM_CSRF_SECRET | Independent server secret, at least 32 characters |
| NAM_WORKSPACE_ID | Explicit studio workspace UUID |
| SUPABASE_SERVICE_ROLE_KEY | Server-only account administration and stored-file attestation |
| NAM_INTEGRATIONS_WORKSPACE_ID | Workspace bound to integration credentials |
| ATTIO_API_KEY, ATTIO_DEALS_OBJECT | Optional Attio connection and object mapping |
| LEMLIST_API_KEY | Optional Lemlist connection |
| JUSTCALL_API_KEY, JUSTCALL_API_SECRET | Optional JustCall connection |
| NAM_CRON_SECRET | Protected job authentication when enabled |

Never prefix privileged/provider secrets with NEXT_PUBLIC_. Follow the job documentation for newer key aliases and scheduler settings. No unattended sync is claimed until configuration and execution have been verified.

Use the directory containing this package.json as Vercel's Root Directory: `nam-os/production` in the complete source tree, or `production` in the standalone upload package. Do not deploy the parent SQLite server to Vercel.

See `docs`, `TASKS.md` and the deployment guide for exact provisioning and operational steps. Run hosted negative permission tests with isolated identities before inviting the team. Back up and restore the database **and private Storage objects**; JSON business export alone is not a disaster-recovery backup. A passing build or isolated suite does not complete the four required full-platform QA cycles.
