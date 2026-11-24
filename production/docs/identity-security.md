# Production identity implementation and verification

The production application uses Next.js server routes and Supabase Auth cookie sessions. It does not deploy the local SQLite identity implementation or permit demonstration account switching.

## Configuration and operator actions

Configure these in NAM-controlled provider settings, never in source or chat:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: public project connection values.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key for narrowly scoped administration, verified invitation acceptance, one-use password proofs and trusted attachment attestation. Ordinary business queries and Storage upload/download requests use the user's JWT instead.
- `NAM_APP_ORIGIN`: exact HTTPS origin without a path. `NEXT_PUBLIC_APP_URL` / `APP_ORIGIN` are accepted aliases. Production fails closed without an origin; HTTP is accepted only for loopback development.
- `NAM_WORKSPACE_ID`: trusted NAM workspace UUID. If omitted, context requires exactly one active membership.
- `NAM_CSRF_SECRET`: at least 32 cryptographically random characters, identical across application instances. Rotation invalidates CSRF and short-lived password proofs; users must refresh and request fresh recovery links.

Disable public signup in Supabase Auth. Configure allowed URLs, password security, email confirmation, JWT expiry and session policies before a pilot. Provision the first founder through a trusted operator path, not public signup or user metadata. Apply migrations to staging and verify managed-schema compatibility and function permissions there.

Provider authentication cookies are HttpOnly. Authentication runs through the application's server API. The reserved browser Supabase helper must remain unused for these flows because it cannot read HttpOnly sessions. No custom browser-local storage contains account roles or provider tokens.

## Access decisions

`getContext` verifies the provider user remotely and JWT claims cryptographically, validates `session_id`, loads active database membership and checks MFA factors. Editable `user_metadata` never supplies workspace, role or assignment permissions.

Founder access requires AAL2. Non-founders with a verified factor also require AAL2. Database `nam_assured` enforces this on direct PostgREST requests. AAL1 retains only its own live membership lookup to complete setup.

`nam_session_valid` checks the signed session ID against the same user's managed `auth.sessions` row, nullable `not_after` expiry, confirmed email and provider ban state. Missing, borrowed, malformed, expired or removed sessions cannot authorize NAM data. The wrapper reveals no managed table rows. Signed-out sessions lose business access when the provider removes their session row; configured inactivity/cleanup semantics still require staging verification.

Signed HttpOnly CSRF cookies bind user, workspace, nonce and expiry. Mutations compare cookie/header/signature and require the exact configured Origin. Public login, MFA login verification and idempotent logout independently require that Origin. Logout does not require current membership, so suspended users can still end their provider session.

## Invitations and passwords

Verified founder administration creates a supported Supabase invite/magic link. A SQL RPC records a trusted inactive membership and a one-hour invitation. No business access exists until a provider-verified callback accepts the matching live invitation in a service-only transaction. Query parameters and editable metadata never determine its role. Revoke and Restore cannot bypass acceptance.

Links use `/auth/confirm` with provider `verifyOtp`, followed by `/auth/password`. They do not reuse local demonstration hash tokens. Delivery is manual. Provider OTP expiration may shorten NAM's one-hour invitation limit.

Password setup/recovery needs the verified provider callback, a signed 15-minute HttpOnly proof and its hashed server-side row. Reset consumes that row once, preserves MFA, changes the password and signs out globally. A provider failure after consumption requires a new link. Settings validates the current password using an isolated provider client before changing the real account password and revoking other sessions.

Provider TOTP setup supports QR and manual key entry. QR data is a bounded `data:image/svg+xml` image URL; SVG is never injected as HTML. Keys stay in the setup screen. Supabase does not issue this local runtime's recovery codes in this flow. Store the setup key securely and establish an identity-verified operator factor reset procedure before launch; the interface states this limitation.

## Evidence and limits

Executable tests cover CSRF signatures, origins, redirect evasions, bounded UTF-8 input, trusted context, metadata-role spoofing, MFA gating, native authentication dispatch, private invitation links, single-use password proofs and logout after membership revocation. PGlite executes actual migrations and direct-role policy tests for pending invitations, assurance, session deletion/revocation, account state, workspace boundaries and service-only acceptance.

TypeScript compilation passed with the assembled source. These tests mock GoTrue HTTP and represent managed schemas around actual PostgreSQL execution. They do not prove live provider login, MFA, recovery, hosted schema permissions, private Storage or real-account browser workflows. Those remain staging requirements. This is implementation evidence, not a four-round whole-product report or production readiness certification.

Primary references checked 24 November 2026:

- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [MFA enrollment](https://supabase.com/docs/reference/javascript/auth-mfa-enroll)
- [MFA challenge and verification](https://supabase.com/docs/reference/javascript/auth-mfa-challengeandverify)
- [Administrative link generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
- [Sessions and post-signout JWT validation](https://supabase.com/docs/guides/auth/sessions)
