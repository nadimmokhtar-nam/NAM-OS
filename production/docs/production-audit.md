> Historical checkpoint. Current implementation and executed reinvention checks are in [REINVENTION_VALIDATION.md](REINVENTION_VALIDATION.md). The owner’s latest requirements and migration 015 permit password-only Founder sign-in; verified authenticator enrollment is optional. Earlier feature/assurance statements below describe their recorded revision.

# Independent production security and behavior review

Reviewed 24 November 2026. Scope: Next.js/Supabase identity context, native authentication handlers, identity/assurance migrations, and the browser-module bridge. This is an engineering review with bounded automated evidence. It is not a penetration-test certificate or an online launch approval.

## Evidence

Command run from `production/`:

```sh
node --experimental-strip-types --test --test-concurrency=1 test/auth-security.test.mjs
```

Latest result: **26 passed, 0 failed** on Node.js v24.22.3. The count includes nested PostgreSQL subtests.

The suite exercises two distinct boundaries:

1. The actual TypeScript context/auth implementation is transpiled and executed with controlled Supabase-client and Next-cookie substitutes. Real CSRF helpers run unchanged. This validates application control flow, validation, privilege checks and response contracts; it does not verify hosted GoTrue or HTTP cookie behavior.
2. All versioned SQL migrations execute in PGlite's PostgreSQL engine. Authenticated roles, JWT claims, direct table reads and RPCs are exercised against real RLS and function grants. Only Supabase-managed `auth` and `storage` schemas are represented by fixtures. This is real PostgreSQL execution, not a hosted Supabase/PostgREST/Storage test.

The shared fixture now represents `auth.mfa_factors` and `auth.sessions`. Fixture identities have confirmed email addresses and explicit session IDs. Tests can deliberately omit, mismatch, expire or remove a session without silently recreating it.

## Findings and corrections

| ID | Initial severity | Finding | Correction and current evidence |
| --- | --- | --- | --- |
| AUTH-PG-01 | High | API checks required AAL2 for a nonfounder with verified MFA, but initial direct database policies only enforced Founder MFA. An AAL1 JWT could bypass elected MFA through PostgREST. | Migration `007_assurance` adds `nam_assured()` and applies it to section access. Tests verify AAL1 works before enrollment, unverified enrollment does not lock the user out, verified enrollment blocks AAL1 records/RPCs, and AAL2 restores assigned access. Own active membership remains available at AAL1 for the MFA setup flow. |
| AUTH-PG-02 | High release requirement | Cryptographically valid JWTs can outlive a Supabase logout or password-change session revocation. A factor/AAL check alone did not immediately reject the old JWT at the database. | The selected stronger policy uses `nam_session_valid()` to bind JWT `session_id` to the same user's live managed session. Direct SQL tests show the same claims lose task, membership and mutating-RPC access after that session row is removed. Missing, malformed, borrowed and expired session IDs fail closed. Confirmed-email and provider-ban checks are also exercised. Live provider logout must still prove the expected managed-session deletion. |
| AUTH-UX-01 | Medium | Copied local-preview Security UI contained inaccurate production copy: 48-hour invitation text versus one-hour SQL invitations, unsupported session-history expectations and overly broad recovery/session promises. | Reported to the Security owner for correction. Final acceptance must inspect the current production screens and ensure provider-dependent data is explicitly unavailable rather than fabricated. |

AUTH-PG-01 and AUTH-PG-02 have verified local SQL corrections. Their hosted-provider acceptance gates remain open. None of the local tests should be used to claim that all four full testing/correction rounds or production readiness are complete.

The immediate-revocation design follows the provider's documented `session_id`/`auth.sessions` validation approach: [Supabase user sessions](https://supabase.com/docs/guides/auth/sessions), “How to ensure an access token (JWT) cannot be used after a user signs out.” The provider's ordinary JWT lifetime behavior is the reason NAM adds a live-session database check.

## Behavior verified by the independent suite

- `getUser` and verified `getClaims` must agree on identity. Editable user metadata does not grant a role.
- Missing/inactive/unsupported memberships, ambiguous workspaces, provider failures and invalid workspace configuration fail closed.
- Founder AAL2 is required; elected nonfounder MFA is respected. A restricted context is available for enrollment/verification without granting business access.
- Mutations require the configured exact Origin and matching signed cookie/header token bound to identity and workspace. Missing, forged and cross-identity tokens are rejected.
- Invitation API rejects unauthorized callers and Founder role invitations before privileged provider access. Returned private URLs stay on the configured application origin and do not expose the service credential.
- Failed provider OTP verification does not activate membership or issue a password-setup capability.
- Password reset requires a current, identity-bound, short-lived and single-use provider-link proof. A normal authenticated session is insufficient. The successful path updates the password, clears its browser proof and requests provider-wide sign-out; replay is rejected.
- Direct invitation issuance requires an AAL2 Founder. A pending invitation grants no active membership. The Restore action cannot bypass acceptance.
- Only the server service role can accept an invitation, with an exact verified user match. Acceptance replay is denied. A Founder cannot suspend themselves or edit another workspace's member.
- Managed MFA-factor rows cannot be deleted by an ordinary user to weaken assurance.

## Bridge and CSP source review

The reviewed Next client components pass the request nonce to same-origin external module scripts. `proxy.ts` supplies a per-request script policy and omits production `unsafe-eval`. The browser modules contain no service-role key or embedded business records. Authenticated API responses are private/no-store.

The imperative workspace is mounted through a cached module bridge with explicit mount/unmount, request abort and stale-generation handling. This is more deliberate than relying on a one-time module side effect after React navigation. However, source inspection cannot prove React hydration behavior, CSP compatibility, focus restoration, route transitions or native download interactions. Those require actual browser verification on the built Next server. Existing bridge unit tests are separate bounded evidence, not a replacement for that check.

## Production acceptance gates still open

| Gate | Required evidence |
| --- | --- |
| Supabase staging application | Every migration applies to an empty managed project without weakening the functions, grants or policies. Confirm managed table/enum compatibility. |
| Identity and browser cookies | Real invitation/OTP acceptance, password setup, sign-in, Founder/elected MFA, logout, refresh, password change, revoked invitation and suspended-account flows across two browser sessions. |
| Immediate revocation | Capture an authorized token in a controlled test; sign out or change the password; prove the original token is denied by direct PostgREST and private Storage access after its provider session is removed. |
| Assurance boundary | Real AAL1 and AAL2 tokens against direct PostgreSQL-backed APIs, including a nonfounder who enabled MFA. |
| Provider failures | Expired/used links, provider rate limits/outages, missing environment configuration, stale CSRF cookie and concurrent account changes produce actionable errors without leaking secrets. |
| Browser bridge and accessibility | Built Next UI at mobile/tablet/desktop widths; hydration/CSP console inspection; keyboard tasks and Academy workflows; dialog opening/closing and focus after saves/errors; Next route departure/remount. |
| Real integrations | Authenticated read-only Lemlist, Attio and JustCall setup and source-specific sync/failure/duplicate tests using the intended workspace. Local fixtures are not real reporting data. |
| Operational recovery | Managed database and private-file backup, restore rehearsal and failure monitoring. A JSON business export alone is not a complete Storage backup. |

No live Supabase credentials or deployment access were available to this review. The remaining gates are explicit setup and verification work, not implied background execution.
