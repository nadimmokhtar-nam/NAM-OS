# Project revision work and final delivery

Migration033 extends the existing projects, central tasks, immutable render
versions and client portal. It does not create a second task or file store.

## Revision rounds

The Founder chooses current verified image versions and writes an instruction
for each image. The transaction verifies the image version, latest ready render
and eligible current artist, then moves the image to Revisions and creates a
real central production task. The round retains the issued render identity and
instruction. A stable request key returns the same round and tasks after an
uncertain response; changed retries fail without creating duplicates.

Project participants can read shared round context. Each sees item instructions
and counts only for tasks they can access. The Founder sees the complete round.
Closing requires every linked task to be Done or Canceled. It retains history
and does not approve images, finish unrelated tasks or fabricate client approval.

## Final files

The Founder explicitly selects images marked Final approval (or already in
Delivery), confirms their readiness and chooses active invited clients. Issuance
uses the existing review snapshot validation, grants original-file downloads,
sets every selected recipient to view-only, and moves selected images to
Delivery. Sign-in email remains a separate explicit action in Client reviews.
Issuance itself makes no email/provider call.

The retained manifest contains the exact issued item and render identities,
filename, version, content type, byte size, dimensions and SHA256. A later upload
does not replace issued files. Clients receive only the narrow file metadata
and their issued item identities, never internal render IDs, production notes
or unissued files. JSON manifests and original downloads use private no-store
responses and current authorization. Cancellation revokes guest metadata,
media and manifest access while retaining studio history. Generic cancellation
under Client reviews produces the same retained delivery audit event.

## Routes and lifecycle

- `GET/POST /api/projects/:id/revisions`
- `GET /api/revision-rounds/:id`, `POST .../:id/close`
- `GET/POST /api/projects/:id/deliveries`
- `GET /api/final-deliveries/:id`, `GET .../:id/manifest`, `POST .../:id/cancel`
- `GET /api/projects/:id/round-images?final=0|1&search=&page=1`
- `GET /api/client/reviews/:requestId/manifest`

Lists and image selection are paged in groups of50. Each issue contains at most
100 distinct images; final delivery supports at most20 distinct invited clients.
Revision instructions allow5000 characters per image, with a bounded2100000-byte
request body; final issuance uses a64000-byte ceiling. Database mutation functions
take scheduling's workspace/identity lock before project, image and task locks,
then recheck Founder access. Existing CSRF, managed-session and elected MFA
requirements remain active. Direct table writes and public/client RPC invocation
of studio mutations are not granted.

The browser captures the complete request before disabling controls. Pending
writes prevent duplicate submissions and leaving the workspace. A409 retains
instructions and requires reloading/reselecting current versions; an ambiguous
response retains the exact request for retry. Actor, project and route changes
invalidate stale reads and writes. The `revisions` and `delivery` destinations
use the shared shell, controls, typography and interaction guards.

## Verification and remaining limits

Real PostgreSQL/API suites cover atomic creation, exact retries, stale versions,
access boundaries, final manifests, late revocation and cancellation. Native
browser cases exercise image conflicts, real artist task completion, original
and manifest downloads, later uploads and revoked guest access. These new cases
must pass consolidated CI before release acceptance; local syntax is not proof
of database or browser behavior.

The existing render pipeline accepts verified JPEG/PNG images. Animation review,
bulk ZIP packaging, externally authored NAM curriculum and live sales-provider
configuration remain separate acceptance items. No hosted migrations or client
emails have been performed by this development work.
