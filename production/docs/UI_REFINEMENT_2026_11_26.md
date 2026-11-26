# NAM OS interface refinement — 26 November 2026

The requested direction is a modern sans-serif interface with neutral surfaces,
shorter panel transitions and consistent alignment. Inter now serves both
headings and controls. Existing compact navigation and 44 px mobile targets
remain; meaningful error states retain their distinct error tone.

Project overview reads the directory and selected project in parallel and
does not request an unused task list when the planning overview is available.
Live authorization checks and private media response headers are retained.

The cover picker previously accepted only existing verified production renders.
It now opens immediately and accepts JPEG/PNG files from the computer, up to
20 MiB, using the existing signed, non-upserting project-resource transfer and
server-side verification. A late image-choice response retains the chosen file.
The uploaded cover is a shared project file and does not create a production
deliverable. Only its verified preview is served by the cover endpoint.

Migration 038 adds the cover resource reference, enforces a single cover source,
preserves project/role boundaries and records idempotent cover changes with
optimistic concurrency. Wrong-project, private, archived and unverified resources
are rejected. Media reads recheck access and the selected cover after Storage
returns. Existing records and original media are not rewritten.

Validation includes the full source/database/API and native browser suites.
The new browser scenario exercises an actual signed laptop-file upload, late
chooser responses, project/artist access, mobile containment and accessibility.
Current commit results are recorded in its source review.
