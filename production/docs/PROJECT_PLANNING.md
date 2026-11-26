# Project overview and planning

25 November 2026. Additive migration 027 extends the existing project model.
Exact verification commits and workflows belong to draft PR 15. This document
does not establish a hosted release or final visual acceptance.

## Reference and interface

The authenticated Programa project overview and Project Management timeline were
inspected directly. The overview uses a project brief beside a landscape cover,
compact context chips, people, a quiet metric strip and recent imagery. Timeline
measurements were a 320px label rail, 90px project/phase rows, a date ruler, Today
marker and Month/Quarter/Year control. NAM uses those dimensions and the existing
Newsreader/Inter tokens. Mobile keeps touch controls and horizontal timeline
scrolling inside the project workspace.

The project directory now displays an explicitly selected project cover.
Project Management retains its existing shared List and Board records and adds
the real Timeline view. Unsaved changes and active saves use the same workspace
navigation guards. Empty, archived, loading, denied and retry states are explicit.

## Shared context and covers

Existing project versions, creation retry keys and change history remain in use.
New optional fields are start date, client/company label, project type, location
and a selected cover render. The client/company label is shared brief context;
it is distinct from the Founder-only client access/contact directory.

A Founder chooses a verified render from that project as a cover. The UI explains
that this deliberately shares the chosen derivative with everyone who can read
the project brief. It does not grant access to the image inventory, internal notes,
feedback, other versions or original bytes. The cover stays on the chosen render
when another version is uploaded. Cross-project covers and unverified uploads
cannot be selected. A scoped same-origin gateway checks current project access,
stored byte size and SHA-256, then rechecks access and the selected cover after
the read. It returns private/no-store WebP bytes and never a signed public URL.

Overview totals are database queries under the existing permissions. Artists see
their own task/image counts; the Founder also sees individual pending client
responses from active decision recipients on open requests. Completed tasks and
individual responses are never represented as an aggregate image approval.
Recent imagery is limited to four permitted images, with no internal notes.

## Production phases

Phases have an independent title, start/end dates, planned/in-progress/complete/
cancelled state, shared notes, display order and an optional production-stage
link. A stage link supplies the caller's permitted task/completion counts.
Phase status is a plan record and never changes tasks, image stages or approvals.
Missing dates are shown explicitly rather than inferred.

The Founder creates and changes phases. Explicit project participants can read
them while their existing project section/session/MFA permissions remain valid.
No participant membership list or another artist's private work is exposed.
Archived projects keep a readable plan and require restoration before changes.

Phase mutations lock the project, compare the captured phase version and retain
an immutable event with a stable request identity. Exact retries do not duplicate
events. A changed payload or stale version cannot overwrite another change.
The UI retains uncertain requests for exact retry; conflicts offer explicit reload.
Phases can be archived and restored with their dates, notes and events intact.
At most 1,000 retained phases are allowed per project.

Business export format 8 adds phases/events to the existing business data export.
Authentication material and all media bytes remain excluded.

## Verification and remaining scope

Database/API checks cover ranges, retries, conflicts, archive/restore, read-only
participants, task isolation, deliberate cover sharing, revocation during a read,
byte verification, MFA and export. Native browser cases exercise real uploads,
forms, timeline geometry, mobile containment, accessibility and concurrent edits.
Captures are synthetic references for comparison, not real studio project data.

Project documents, reference/mood-board authoring, meeting notes, delivery
packaging and animation review remain separate implementation work. The broader
Tasks/Academy/Sales/Team/Settings acceptance pass and live integrations are also
required before the complete NAM OS redesign can be accepted.
