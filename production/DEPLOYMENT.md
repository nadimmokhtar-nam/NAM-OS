# NAM OS delivery

The owner supplied these existing services. Preserve them; no replacement account, paid upgrade, initial database installer, owner bootstrap or reset is part of this initiative.

| Binding | Existing value |
| --- | --- |
| Repository | `nadimmokhtar-nam/NAM-OS` |
| Current trial | `https://nam-os-staging.netlify.app` — owner protected |
| Netlify site / plan | `nam-os-staging` / Free |
| Current deployment branch | `main` |
| Application base / build / publish | `production` / `npm run build` / `.next` |
| Node / adapter | 24 / pinned `@netlify/plugin-nextjs` 5.16.9 |
| Supabase | `ltkdycibqnqmwqeejcvs`, Ireland |
| Existing schema | migrations 001–015 |
| Last verified trial commit | `7f07fa7c88c82c87e58931cf15efc9c3c74d96c9` |
| Review branch | `codex/nam-os-reinvention` |

## Keep the current trial available

Review and test the branch in an isolated environment first. Do not merge into `main` or issue a production deploy over the trial as a substitute for a separate reviewable preview. On Free, credentials are not protected by paid per-context environment scoping: disable untrusted/fork previews and do not expose a server key to unreviewed branches. Use only trusted source and deliberate exact callback origins.

The isolated local Supabase stack uses synthetic records and is never a fallback for the real site. Its compiled application embeds loopback public bindings. **Build again in the intended secure deployment context.** Never upload the local QA build or its generated profiles, session states, runtime JSON or caches.

## Secure configuration

Check which names already exist without displaying their values. The cloud environment currently has no inherited hosting/browser credentials. A project ID is not deployment or database authorization.

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Intended project's API origin |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key, protected by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only identity administration and stored-file attestation |
| `NAM_WORKSPACE_ID` | Existing studio workspace UUID; never use the synthetic QA UUID |
| `NAM_APP_ORIGIN` | Exact chosen HTTPS preview/application origin |
| `NAM_CSRF_SECRET` | Existing independent server secret, at least 32 characters |
| `NAM_INTEGRATIONS_WORKSPACE_ID` | Authorized workspace binding for optional sales credentials |
| `ATTIO_API_KEY`, `ATTIO_DEALS_OBJECT` | Existing permitted CRM integration |
| `LEMLIST_API_KEY` | Existing permitted campaign reporting |
| `JUSTCALL_API_KEY`, `JUSTCALL_API_SECRET` | Existing permitted calling integration |
| `NAM_CRON_SECRET` | Authenticated scheduled-job token where already configured |

Preserve existing secret values; do not rotate or recreate accounts to gain access. Set exact Supabase Site/Redirect URLs for the deliberately selected application origin. Do not wildcard redirects or weaken Origin/CSRF checks. Password-only sign-in includes Founder; do not force authenticator enrollment. Accounts that elected a verified factor still require it.

## Schema delivery

1. Inspect the hosted migration history and take a verified database/private-Storage backup through the existing operator process. The JSON business export contains no media bytes or Auth recovery state.
2. Confirm migrations 001–015 are present. Review only pending **016 projects, 017 daily work, 018 private Academy video, 019 connected daily reviews, 020 complete business-context export, 021 video reservation recovery**. Apply them in order through the existing trusted migration channel. No hosted migration has been applied by this task.
3. Retain existing tasks, publications, enrollments, progress, memberships, grants, files and integrations. Projects/video add tables and optional task context. Existing unlinked tasks remain valid. Migration 019 leaves the legacy trial's report-review RPC intact and adds a version-checked path for the new application.
4. Verify private bucket `nam-academy-videos` stays private, permits allowed video formats and enforces 50 MiB objects. Do not add broad Storage policies or public URLs. Playback uses caller-authenticated bounded range reads; trusted attestation is the only ready-state transition.
5. Run direct negative checks with disposable identities before releasing the new app. Assigned-only users must not see colleagues' tasks or an unshared brief; revoked enrollment/session/MFA assurance must stop private access.

## Preview and acceptance

Build the exact reviewed branch with the intended secure bindings and a fixed, separately configured HTTPS preview origin. Keep the existing main deployment available. Use a free deployment path on the NAM-owned infrastructure; do not enable paid add-ons or spend upgrades.

Verify the deployed Netlify adapter, not just `next start`: password login, elected MFA, session refresh/logout/revocation, nonce CSP, no-store responses, Origin/CSRF rejection, project/task creation and conflicts, source-ledger sales, report resubmission/review, Academy reading/practical work, actual private video upload/play/seek/captions and denial after revocation. Include mobile/tablet/desktop, keyboard use, eight appropriately different identities and latency measurements from the Ireland database. The local >4 MiB MP4 fixture tests range continuation; it does not certify the hosted adapter or a maximum-size upload.

Confirm provider attribution/freshness against the actual permitted sales tenants. Verify recovery, private-file backup/restore and existing scheduled jobs. Batch deploys within Free allowances. Preserve the previous deploy for code rollback; additive schema should remain until an explicitly reviewed data migration is justified. Do not roll back by dropping business tables.

Executed results and open hosted gates are in [REINVENTION_VALIDATION.md](docs/REINVENTION_VALIDATION.md). No production deployment or protected-hosted acceptance is claimed without that evidence.
