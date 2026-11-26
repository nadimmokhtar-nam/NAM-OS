# Hosted original-image acceptance

26 November 2026. The image pipeline accepts JPEG/PNG originals up to
52,428,800 bytes and 64 million pixels. A successful small-image preview does
not establish that a deployment can upload, verify and deliver the maximum
supported original.

## Existing security and transfer contract

Uploads go directly from the browser to Supabase using a narrowly scoped signed
upload URL. Finalization verifies the actual stored bytes, size, format, decoded
pixels and SHA256 before making a version ready. This avoids transporting an
original inside a hosting-function request.

Original reads pass through authenticated application routes. Staff use current
Storage RLS. Client reads require current access to the issued immutable image.
Both verify the stored digest and recheck access after the Storage read before
returning private, no-store bytes. Signed read URLs would bypass these repeated
authorization checks and are not an acceptable substitution.

## Host-specific gates

| Target | Current evidence | Required acceptance |
| --- | --- | --- |
| Vercel | Standard Next.js application on Node 24; Root Directory is `production`. Vercel documents a streamed-response exception to its buffered response limit and streaming support for Next Route Handlers. No Vercel deployment or generated function configuration has been inspected for this candidate. | Inspect the actual generated function configuration for `supportsResponseStreaming`, then run the full transfer and revocation scenario below on the deployed candidate. |
| Existing Netlify pilot | The recorded adapter output uses streaming invocation. Netlify documents a 20 MB streamed-response ceiling, below the accepted 50 MiB original. | The current single-response original gateway cannot be accepted for maximum-size files on this host. Use a suitable runtime, or separately implement authenticated bounded chunks and client assembly without weakening authorization. |
| Supabase Storage | The isolated provider explicitly permits `50 MiB`; the render bucket permits the application maximum. Hosted global limits and tenant configuration have not been inspected. | Confirm the intended hosted project and bucket both allow at least 52,428,800 bytes. |

The application API currently sets `maxDuration=60`. Measure verification and
complete transfer within the actual deployment budget. Documented memory and
duration allowances alone do not prove a timeout or memory failure.

## Required maximum-original scenario

Use an explicitly designated disposable hosted workspace with synthetic staff
and client identities. Ready render versions are immutable; this is not a
read-only probe and must not be pointed at the studio workspace accidentally.

1. Generate a valid, completely decodable image of exactly 52,428,800 bytes under
   the pixel ceiling. Record its SHA256 and dimensions.
2. Reserve the version, upload directly to Storage, and finish verification.
   Require ready status and the expected size, digest and dimensions.
3. Download the staff original and an explicitly issued client original through
   the deployed application. Require 200, exact byte count/SHA256, image MIME,
   attachment disposition and private, no-store headers. Measure complete
   transfer time, rather than time to first byte alone.
4. Upload a newer version. Require that the earlier issued original and retained
   delivery manifest still identify the original exact bytes.
5. Revoke the synthetic artist's project access and cancel the client delivery.
   Subsequent original, preview and manifest requests must return 403/404.

The repository's isolated browser suite uses loopback-only guards and a local
capture mailbox. Do not change its base URL to reach a hosted tenant. Hosted
execution requires a separately reviewed HTTPS origin and private synthetic
session configuration. Native loopback success is useful application evidence;
it is not Vercel runtime acceptance.

## Primary documentation checked

- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel Next.js streaming](https://vercel.com/docs/frameworks/full-stack/nextjs#streaming)
- [Vercel function build configuration](https://vercel.com/docs/build-output-api/primitives#serverless-function-configuration)
- [Netlify function defaults](https://docs.netlify.com/build/functions/configuration/#default-values)
- [Netlify streaming responses](https://docs.netlify.com/build/functions/api/#streaming-responses)
- [Supabase upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)

No hosted original transfer, deployment, configuration change or studio record
mutation has been performed by this audit.
