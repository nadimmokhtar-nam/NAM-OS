# Private render versions and internal review

25 November 2026. Additive continuation of the Programa redesign on draft PR 15.
No hosted migration or deployment is included. Verification status is recorded
in the pull request against the exact implementation commit.

Migration `202611250025_render_versions.sql` adds independent render versions and
version-specific internal feedback. JPEG and PNG files support still images and
360 panoramas; animation media remains a separate future capability. Existing
projects, tasks, private attachments and Academy videos retain their contracts.

## Upload and recovery

The primary assigned artist or Founder can upload to an active image in an
explicitly shared project. The browser hashes the selected file and reserves one
immutable object through an idempotent request. Files transfer directly to the
private Supabase bucket, with actual progress and Stop controls. The application
does not send large images through the synchronous function request body.

The server downloads the actual original, checks its size and SHA-256, and uses
Sharp to decode all pixels. A matching file extension or image header is not
enough. Unsupported, malformed, oversized and multi-frame images are rejected.
The current limit is 50 MiB, 64 megapixels and 16,384 pixels per side. Sharp is
pinned at the version already present in Next's dependency graph, as an explicit
production dependency.

Oriented, metadata-stripped WebP previews and thumbnails are created once,
uploaded with the caller's Storage permissions and read back for hash checks.
The source original is retained byte-for-byte, including its colour profile.
Only a service-only attestation RPC can publish the verified version. It
rechecks the original actor/session, optional enrolled MFA, project membership,
image assignment, archive state and captured image version after locking.

Finalization assigns a sequential render number, advances the image's metadata
version and records an immutable history event. It never advances a production
stage or creates an approval. Earlier originals, previews, feedback and version
notes cannot be overwritten or deleted through the authenticated interface.

A stale edit keeps the original file and reservation. Explicitly reload the
latest camera brief, production stage and artist before retrying finalization.
Lost reservation responses replay the same key and payload. A duplicate/lost
transfer acknowledgement still triggers trusted stored-byte verification. Stop
does not publish the upload. Pending uploads can be discarded by their creator
or Founder; their quota is released only after Storage confirms cleanup.

Pending verification locks the current camera and review controls until the
operation finishes. A retry first checks the original already in private
storage. Matching stored bytes proceed directly to verification without a
replacement upload URL or another image transfer.

The safeguards allow three pending uploads per image, twenty per workspace and
50 GiB of conservatively reserved workspace bytes, including derivative space.
They do not change the provider's subscribed storage limits.

## Viewing and feedback

The existing image drawer displays the latest real preview and a version count.
The review workspace uses the shared Programa-derived controls and neutral
surfaces: a version rail, main image canvas, comparison selector, original
download and feedback beneath the image. Narrow layouts put the version rail
above the image and stack comparisons. Thumbnails use the stored derivatives,
not repeated full-resolution downloads.

Comments and optional normalized image points belong to one immutable render
version. Marker numbers remain stable as newer feedback is added. Text entry,
keyboard marker selection and focus return remain available without a mouse.
Review comments do not appear on another render revision. Version/feedback
pagination uses authorized totals and explicitly loads older records.

Every original, preview, thumbnail, comment and page uses the current image's
access rules. Metadata queries and Storage operations retain the user's JWT and
RLS. Content URLs are authenticated, checked again after loading, never public
signed download links, and return `private, no-store` with `nosniff`. Revoking a
project or image assignment cannot grant upload access through an older form.
Business export format 6 includes render/feedback metadata and excludes all
render file bytes.

## Reference and remaining scope

The layout extends the actual Programa item drawer and its recorded client
review composition. Official current references supplement the authenticated
application's empty approval history:

- [Approval requests and responses](https://help.programa.com.au/en/articles/17748602-how-to-request-client-approvals-and-manage-responses)
- [Client review guide](https://help.programa.com.au/en/articles/17748702-how-to-review-and-approve-your-designer-s-selections-client-guide)
- [Recorded client review](https://www.loom.com/embed/cb4a17d02e3f413fabd243a78e537f8f), populated review interface around 3:12
- [Revision and product history](https://help.programa.com.au/en/articles/17670401-how-to-record-a-round-of-changes-and-check-product-history)

This implementation provides internal review. Client guest identities, explicit
client approval permissions, review requests/decisions, issued revision rounds,
animation media, delivery packaging and complete visual acceptance remain open.
Task completion, render verification and internal comments are not client
approval decisions.
