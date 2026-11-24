# NAM OS online deployment

This is the production Next.js/PostgreSQL source. The Node/SQLite application in the parent directory is a local test application and must not be deployed as a Vercel persistence layer. Production code still requires real provider configuration, hosted verification and the release gates in the test report. Do not infer live readiness from a successful build.

## Repository and Vercel root

The user currently chose a public GitHub repository. Keep production credentials, local databases, test exports, client files and personalized bootstrap SQL out of it. Public source does not make studio records public: authentication and database/file policies remain mandatory. No Git push has been performed without authenticated repository access.

The simplest publishable source bundle is the **contents of this `production` folder** at repository root. It includes its own application, assets, integration adapters, package files and migrations. In that arrangement Vercel's Root Directory is `.`. If the repository instead contains the `nam-os` folder, select `nam-os/production`; if repository root is the existing `nam-os` folder, select `production`. Do not select the parent SQLite application's package.json.

For the prepared **NAM_OS_Online_App_v0_3.zip** fallback: extract the archive, then use GitHub's **Add file → Upload files** and drag the extracted **production folder** into the repository. Before committing, confirm the resulting tree contains **production/package.json**. Commit through your authenticated GitHub account. In this exact arrangement, set Vercel's Root Directory to **production**. Upload the sanitized source archive's extracted folder only; do not upload the whole local workspace, node_modules, caches, databases, exports or any private environment file. GitHub upload and Vercel connection require your account action when authenticated Git access is unavailable.

Connect the NAM-owned GitHub repository in the NAM-owned Vercel project, choose Next.js and Node.js 24.x, and use the committed lockfile with `npm ci`. Keep staging and production settings separate. Let Vercel run `npm run build`. The operator must first verify the exact committed source passes type checks, tests, dependency review and build. This document does not authorize publishing unfinished staging as a daily team release.

## Supabase staging and initial founder

1. Create a NAM-owned Supabase staging project in an EU region. Disable public signup. Keep production separate; never point preview builds at production data.
2. Apply all versioned `supabase/migrations/*.sql` in filename order through a reviewed migration process. Do not apply `bootstrap-owner.sql` automatically as a migration. Create the private storage bucket according to the operations migration/instructions; never make it public to resolve an access error.
3. Create the first owner's Supabase Auth identity through the trusted provider/operator process. The owner must privately set a password and verify their email. Do not send passwords, access keys or email verification tokens through ChatGPT or GitHub. Record the confirmed Auth UUID and email from the provider UI.
4. Make a private temporary copy of `supabase/bootstrap-owner.sql`, replace its Auth UUID and expected-email placeholders, review it and run it once as the trusted database operator. It requires an empty NAM workspace, matches the existing confirmed/unbanned Auth identity, creates one founder membership and records an audit event. It cannot create an Auth user or silently upgrade an existing member. Do not commit the personalized copy.
5. Save the returned workspace UUID as `NAM_WORKSPACE_ID`. Complete founder TOTP setup in the application; business data and founder privileges require the appropriate verified session assurance. Securely retain the authenticator setup key through the approved recovery procedure.
6. Once the founder is verified, issue team invitations through NAM OS. Do not add arbitrary public identities to memberships or use editable Auth metadata as a role source.

## Vercel configuration

Enter values through the provider's secure environment-variable UI for the selected staging/production environment. Never commit `.env.local` or paste secrets into chat.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Selected Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's publishable client key; RLS must still restrict all data. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for narrowly controlled identity/storage operations. Never prefix it with `NEXT_PUBLIC_`. |
| `NAM_CSRF_SECRET` | Server-generated random secret of at least 32 characters, stored only in secure environment settings. |
| `NAM_WORKSPACE_ID` | UUID from the reviewed initial-owner bootstrap. |
| `NAM_APP_ORIGIN` | Exact application origin, e.g. the chosen `https://…vercel.app` staging URL, without a trailing slash. |
| `NAM_INTEGRATIONS_WORKSPACE_ID` | Same authorized workspace UUID, enabling live source ingestion only for that workspace. |
| `ATTIO_API_KEY` | Server-only permitted NAM CRM token. |
| `ATTIO_DEALS_OBJECT` | Actual configured Attio deal-object identifier, when different from the supported default. |
| `LEMLIST_API_KEY` | Server-only permitted reporting API key. |
| `JUSTCALL_API_KEY`, `JUSTCALL_API_SECRET` | Server-only permitted JustCall credentials. |

The public deployment URL must be known before setting the exact origin. Configure the fixed staging host first, update `NAM_APP_ORIGIN` and Supabase allowed URLs, then redeploy. Arbitrary preview hosts should fail closed until deliberately configured; do not weaken origin checks or broadly wildcard authentication redirects to make previews pass.

Configure exact Supabase authentication Site/Redirect URLs for the selected application host and supported callback routes. Review `app/auth/confirm` and the identity module's provider-link requirements. Manual NAM invitation/recovery links are separate from SMTP delivery; configuring a sender does not make an unimplemented automatic email workflow complete. Align OTP expiry and rate limits with the actual identity flow and test expired/reused links.

## Verification before a team launch

- Execute migrations and policy tests against the selected staging database using real Supabase Auth identities, including anonymous, suspended, cross-workspace, AAL1 and AAL2 cases. PGlite tests are valuable evidence but do not verify hosted Auth, PostgREST or Storage behavior.
- Verify login/logout, recovery, MFA, invites, revocation, all record workflows and private files through deployed browser sessions on mobile, tablet and desktop.
- Connect each permitted sales service, explicitly map external owners to Omar/Nadim, check deduplication, available fields, recording access, source windows, currency separation, sync timestamps and safe failed/expired connections. No unavailable metric should be presented as zero or live sample data.
- Configure an authenticated reminder scheduler and exercise it. The reminder RPC creates in-app notifications; its presence alone does not configure a scheduler or email delivery.
- Complete all four documented correction rounds, load/accessibility/visual checks and a backup/restore rehearsal. Resolve every known critical/high issue before enabling daily team use.
- Promote the same tested source to a separately configured production project, start with Nadim/Omar and retain rollback/restore instructions. A custom domain and desktop distribution can follow a verified online pilot.

Hosting accounts and a public repository do not themselves establish a working deployment. Until the configured website and integrations pass these checks, report the remaining setup and test blockers explicitly.
