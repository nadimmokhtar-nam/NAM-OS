# Issued client reviews

Additive continuation of the Programa redesign, 25 November 2026.
Validation against exact commits is recorded in draft PR 15. This document does
not establish deployment, live email delivery or complete visual acceptance.

## Reference

The authenticated Programa application was reopened successfully in the local
browser. The earlier 403 affected the separate cloud-browser session. The
project Share dialog exposes Guests/Public tabs, contact search, a project
preview and optional guest email. No reference account, guest permission,
project content or approval was changed during inspection.

The populated guest preview was inspected directly: warm neutral navigation,
220px rail, compact text/actions and a 480px item drawer. These measurements
supplement the previously inspected approval-request demo and client-review
recording. NAM keeps Newsreader display headings, Inter UI and shared tokens.
No Programa imagery, product content or proprietary assets are included.

## Studio workflow

Client reviews appear inside a project for the Founder. Clients are separate
from studio memberships and never receive internal roles or section grants.

1. Share with a client by name/email. Access starts as view-only unless the
   Founder explicitly permits accepting/rejecting images. Email is optional.
2. Upload verified renders through the existing image workflow.
3. Issue a request by selecting current verified image versions and recipients.
   Each recipient is explicitly view-only or can decide. Original downloads are
   disabled by default and enabled deliberately for each issued request.
4. Issuing makes the selected images available in the client portal. It does not
   send an email automatically. A sign-in link can be requested from Clients.
5. Inspect recorded responses by request, or inside the artist's render viewer.
   New renders and later requests do not change earlier issued images.
6. Close a request to freeze responses while retaining client read access, or
   cancel it to revoke the entire issued view. History remains available to the
   Founder. Revoking a client's project access immediately removes portal data
   and media access for that project.

Camera production stages remain explicit studio decisions. Completing a task,
uploading a render or recording one client's acceptance never silently advances
an image to Final approval. Request summaries count individual responses and
identify view-only requests; they do not invent a combined approval decision.

## Client sign-in and review

The client portal is `/review`. The first email confirms the provisioned account;
returning confirmed clients receive a sign-in link. An unconfirmed identity uses
the provider's confirmation resend flow because public signup remains disabled.
The application never auto-confirms the address or creates an account from a
public sign-in request. Links use Supabase Auth and a dedicated
same-origin session endpoint. Provider tokens are removed from the address before
application requests begin, validated by Supabase and stored in HttpOnly cookies.
Tokens are never returned to studio users, stored in localStorage or included in
business exports. Enrolled authenticators remain mandatory. Revoked sessions,
banned/unconfirmed accounts and inactive invitations fail closed.

The client sees only explicitly issued requests, image titles/codes, issued
render numbers, allowed media and their own saved response. Internal notes,
artist feedback, assignments, tasks and unissued render versions remain private.
Each image has an optional comment and persistent Accept/Reject actions. New
decisions preserve earlier decision events. A lost acknowledgement retains the
original decision, comment and retry identity. Conflicts require explicit reload.
Navigation and sign-out cannot abandon an active response save.

## Data and permission boundaries

Migration `202611250026_client_reviews.sql` adds client contacts/project access,
issued requests/items/recipients and immutable response history. Composite foreign
keys bind workspace, project, image and render identity. Only narrowly granted
RPCs write records; authenticated users cannot directly update/delete them.

Client query functions return a minimal issued snapshot. They use current
project access, recipient membership, managed session/account state and optional
MFA. A view-only recipient cannot gain decision rights on an existing request by
later receiving broader project permissions. The request's original permission
and current project permission must both allow a decision.

The private render bucket and staff media policies remain unchanged. A scoped
client media gateway first authorizes the exact request/item/variant, reads and
hash-checks the verified bytes server-side, then rechecks access before returning
them with private/no-store, nosniff and sandbox headers. No public/signed download
link is issued to clients. Original bytes are served only where the request
explicitly allows downloading them.

Business export format 8 includes client-review and planning records and excludes all media
bytes and authentication/session material. Contact emails remain Founder-only.

## Limits and recovery

- Up to 100 images and 20 recipients per request.
- Studio image/client/request choices load in authorized pages of 50 records.
  Image selections survive search/pagination; totals describe authorized data.
- The client landing view shows its 100 most recent requests and labels the
  bound explicitly when reached.
- Comments/messages are limited to 5,000 characters.
- Request creation and response saves use stable idempotency keys.
- A changed image prevents issuance until current versions are reselected;
  request text and recipient choices are retained.
- Once issued, image/recipient snapshots cannot be rewritten. Issue another
  request to share another version or different decision audience.

## Release configuration and verification

Apply migration 026 before deploying the associated source. Keep the same
Supabase project, server-only service-role key, CSRF secret and explicit
`NAM_WORKSPACE_ID`. Add the HTTPS application `/review` URL to Supabase Auth's
allowed redirect destinations. Configure and verify NAM's Auth email sender/SMTP
before inviting real clients. Do not paste provider credentials into chat.

The disposable QA stack uses its local Mailpit capture service and loopback-only
redirects. It never relays emails to actual recipients or changes a hosted Auth
configuration. Browser coverage exercises received sign-in emails, real provider
verification, HttpOnly sessions, issuance, accept/reject, version pinning,
revocation, view-only permissions, downloads, CSRF, mobile layout and accessibility.
Local/database checks and synthetic captures do not replace a live deployment
rehearsal or direct visual comparison at matching viewport sizes.

Project overview, explicit phases and the timeline are documented in
`PROJECT_PLANNING.md`. Remaining project scope includes reference/mood-board/
document workflows, delivery packaging and animation media.
The remaining module redesign and integration release gates also stay open.
