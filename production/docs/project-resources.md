# Project files, references and notes

Project resources are separate saved records. Founders create and edit them; project participants can read resources explicitly marked **Project team**. **Founder only** resources remain private. Shared content does not grant access to another person's assigned tasks, production images, render comments or client reviews. Folders are shared navigation; each contained resource has its own visibility. Archiving a folder retains its children and their individual permissions.

Files supports private uploads and original downloads, nested folders, resource names, archive/restore, search, ordering and pagination. Notes supports plain text and structured meeting records with date, attendees, agenda, decisions and follow-up actions. References supports HTTPS links and pinboards made of ordered named sections with ordered, captioned project images and optional source links. A pinboard selects real, verified JPEG/PNG file resources. It never creates a production deliverable or substitutes a stock image for missing project content.

## Integration

Import `dispatchProjectResources` from `lib/api/project-resources.ts` into the catch-all API route and register it before `dispatchProjects`. Keep the existing managed session, CSRF and origin checks around every dispatcher. The runtime remains Node for Sharp image decoding.

Import `createProjectResources` from `public/project-resources.js` and include `public/project-resources.css`. Construct it with the same `request`, `openDialog`, `getData`, `getProject`, `render`, `toast`, `onBusy`, `canLeave` and `contextKey` hooks as project planning. `contextKey` must change when actor/project/route changes. Public methods are `load(view)`, `render(view)`, `reset()`, `isSaving()`, `syncBusy()`, `canLeave()`, `hasUnsavedChanges()` and `getState()`.

Supported project views are `files`, `references` and `notes`; `pinboards` is accepted as an alias for references. Load the chosen view after the project opens. Add `projectResources: 'records'` to capabilities when the migration is present. Reset the controller on logout and access-context reset, and call its `canLeave()` before navigation so a pinboard's unsaved canvas cannot be silently discarded. Include its saving state in shared dialog/navigation busy protection. Its markup uses CSS classes and has no HTML inline style attributes.

The existing business export owner should add `nam_project_resources` and `nam_project_resource_events` to the workspace table allowlist and disclose `resourceBytesIncluded: false`; this module does not replace that central export function. Storage paths and fingerprints in administrative exports do not provide object read access.

| API | Behavior |
| --- | --- |
| `GET /projects/:pid/resources` | Bounded saved inventory; `kind`, `folder`, `search`, `sort`, `archived`, `page` filters |
| `POST /projects/:pid/resources` | Create `{changes}` with a stable `Idempotency-Key`; files return an immutable private upload plan |
| `GET /projects/:pid/resources/:rid` | Read one visible resource, including its document |
| `PATCH /projects/:pid/resources/:rid` | Save `{expectedVersion,changes}` with a stable request key |
| `POST /project-resources/:rid/upload` | Reopen the reserved original file's upload plan; body `{}` |
| `POST /project-resources/:rid/finish` | Decode and verify stored bytes, then attest with `{expectedVersion}` |
| `GET /project-resources/:rid/content?variant=original` | Authenticated original download with attachment disposition |
| `GET /project-resources/:rid/content?variant=preview` | Authenticated, metadata-stripped WebP derivative for image resources |

## Private storage and recovery

Migration `202611250028_project_resources.sql` adds a private `nam-project-resources` bucket. Authenticated callers may insert only an exact active, pending reserved original path. They receive no Storage SELECT, UPDATE or DELETE policy for this bucket. The application returns signed **write** capabilities only. It never returns a public object URL or signed read URL. Server storage reads require the existing service role configuration, a narrow user-authorized resource ticket and current managed-session assurance. Every read verifies byte size and SHA-256, then rechecks current access after downloading before returning any bytes. Responses are private/no-store, nosniff and sandboxed; original PDF/text files download as attachments.

Only a service-role function may attest a completed upload. It rechecks and pins the original actor's active Founder membership, confirmed/non-banned account and live session, checks elected MFA, project/resource state, optimistic resource version and storage evidence. The server fully decodes JPEG/PNG pixels using the existing trusted Sharp pipeline. It generates and verifies a metadata-stripped WebP preview. Text must be valid UTF-8 without binary control characters. PDFs must have a supported PDF signature and terminal EOF marker; this is file-format screening, not an antivirus scan or a complete PDF semantic parser. PDFs are not rendered inline.

File bytes are immutable. To change bytes, upload another file and archive the old resource. Interrupted uploads retain their reservation and show **Upload incomplete**. Retry requires the original filename, MIME type, size and fingerprint. A network-uncertain note or pinboard retains its exact original request and identity for retry. A version conflict retains the local draft, loads the saved version for review, and requires explicit acknowledgement before adopting that version. Upload conflicts also display the current title, visibility and archive state; a changed sharing setting is never silently adopted.

Project resource writes serialize reservations, folder-cycle checks and bounded quotas. They acquire shared locks on the exact membership, account and session before project/resource row locks and recheck Founder assurance. Revocation that commits first denies the queued mutation; a mutation already holding these identity locks commits before the revocation.

## Bounded initial scope

- Files: nonempty PDF, JPEG, PNG or UTF-8 `.txt`, at most 20 MiB. Images retain the render pipeline's 64-million-pixel and 16,384-pixel-side limits. No SVG, office archive, arbitrary binary, remote media import or URL preview fetching.
- Inventory: 50 resources per page; at most 2,000 retained resources per project. Folder ancestry is bounded to 20 levels and cannot cycle or cross projects. Search is at most 150 characters.
- Storage: at most 20 active pending uploads per workspace; 20 GiB reserved original-plus-preview allowance. Archived files remain retained and count toward byte allowance. Archiving a failed pending upload releases its pending-upload slot, not its retained byte reservation. There is no permanent-delete or unaccounted cleanup path.
- Notes: 30,000 characters. Meeting fields: 5,000 characters each. Resource names: 150 characters. HTTPS source links: 2,000 characters, public domain syntax, no credentials, custom ports, whitespace or backslashes. Links open with no opener/referrer and are never fetched by the server.
- Pinboards: at most 20 sections and 200 image placements, with section names up to 100 characters and captions up to 500. Document JSON is capped at 150,000 stored bytes; API bodies at 180,000 bytes. IDs, shape, referenced project, image state and visibility are validated again inside PostgreSQL. Images archived or restricted later become unavailable through their independent media endpoint.
- Editing is initially Founder-only. No client portal publication, presentation export, email/invitation sending, automatic task creation or external reference image download is implemented.

## Verification

`test/project-resources-ui.test.mjs` executes the real browser module and event handlers, including project-switch response isolation, revoked-read clearing, exact table columns and sharing, structured meeting writes, retry identity preservation, retained note/pinboard drafts, image ordering and explicit upload sharing-conflict recovery. It runs with Node's built-in test runner and no browser dependencies.

`test/project-resources.test.mjs` runs the migrations in real PostgreSQL/WASM and exercises RPC, RLS and API paths: explicit visibility, role/project denial, stale versions, exact retries and audit counts, archive/restore, folder cycles, document and URL validation, bounded pages, immutable private Storage policies, trusted pixel verification, image/board visibility, malformed uploads, managed-session/MFA denial and revocation during a media read. Provider HTTP is an isolated fixture, not a hosted Supabase assertion.

For hosted staging, test an authenticated JPEG upload/preview/original download, PDF/text attachment download, an interrupted signed write retry, and direct Storage read/signed-read denial with the user token. Use two PostgreSQL sessions to hold a resource row, queue a save, and revoke membership/session in a third. Confirm that revocation either wins before identity-lock acquisition and denies the save, or waits for the already-authorized save; never allow both a committed revocation and a subsequent stale authorized mutation. These provider/concurrent-connection checks require staging and are not claimed by the isolated fixtures. No migration or deployment is run by this module's authoring workflow.
