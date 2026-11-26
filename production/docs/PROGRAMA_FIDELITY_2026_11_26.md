# Programa fidelity review — 26 November 2026

Reference: the authenticated application at https://app.programa.design/projects.
This records the directory comparison and its limits. It does not establish
complete application visual acceptance or hosted release readiness.

## Authenticated reference

Projects, an example project, Project Management and an existing task were
inspected without changing business records, invitations, approvals or sharing.
Temporary view choices were restored. The later directory inspection covered
1280 × 720, 1440 × 1000 and 390 × 844.

The desktop navigation allocation is 228 px and the workspace begins at x236.
The directory has four columns, 16 px gaps, 93:46 thumbnails and a 10 px gap above
42 px captions. List rows measure 54 px. The view menu is 280 px wide with 4 px
padding and an 8 px radius. Exact rectangles and responsive observations are in
`PROGRAMA_REFERENCE_MEASUREMENTS.json`; account text and artwork are excluded.

The task title measured 18 px / 28.8 px in InterVariable. Its properties rail
measured 400 px with 16 px top and 24 px side/bottom padding on
`rgb(248,246,243)`. This confirms those existing tokens, not every task control.

## Directory behavior and geometry

NAM's actual client modules were rendered with clearly synthetic responses.
At 1280 px, NAM and Programa both measured grid x252/y174, 1004 px grid width,
239 × 118.2109375 px thumbnails, 42 px captions and 16 px gaps. At 1440 px, both
measured 1164 px grids and 279 × 138 px thumbnails. NAM fits 320/390 px without
document overflow. It retains 44 px mobile controls, making its toolbar taller
than the observed reference.

Traditional scrollbars reserve space inside NAM's stable main-panel gutter.
The native geometry assertion therefore checks the panel's actual client width
minus its two 16 px content insets, while independently checking the outer panel
insets and 93:46 media ratio. Overlay-scrollbar measurements above retain their
recorded widths.

The directory provides client-side search by permitted name, client, location
and type; natural-name/date sorting; Grid/List; empty-search recovery; keyboard
dismissal/focus return; and retained filters when entering and leaving a project.
Opening a project adds a history entry for browser Back/Forward. All production
work remains available in the view menu. Unmount and identity/access changes
clear directory context. Manual ordering, pinning and reference context menus
remain outside this implementation.

Migration 037 exposes existing creation/update timestamps in the same read-only,
security-invoker summary. Existing RLS, task scope, ordering and the 200-record
bound remain. Search/sorting explicitly apply to those loaded summaries.

## Verification

The preceding `6ab59b33a15955a5b21a045ae8c781b35a275e93` baseline passed
776 source/database/API checks, TypeScript/build and 89 distinct isolated-provider
browser scenarios. Those counts are baseline evidence.

The first directory candidate, `44b2953aa32d79b3ad1c603392506c5ec8b9e15c`,
passed 782 of 784 source checks and 89 of 90 native scenarios. The follow-up
preserves the original exact directory-class assertion, waits for the upload
test's actual asynchronous hashing/review transition, and accounts for the
native browser's reserved scrollbar width. The upload test deliberately delays
real WebCrypto hashing and still requires explicit changed-sharing acknowledgement.
Its production upload implementation is unchanged.

The corrected focused controller/bridge/route/resource suite passes all 152
checks. Full current-commit source, database, build and native workflow results
are recorded in PR 15 after execution; interrupted or failed runs do not count
as passing.

The local visual fixture establishes client layout/interactions, not hosted
Auth/RLS or persisted writes. Native scenarios use the disposable provider and
check metadata, search/sort/List, browser history, 320/390 px containment,
accessibility and the artist's restricted directory. Hosted migration/recovery,
provider reconciliation, real curriculum/media and full visual acceptance remain
separate release requirements. Main, the hosted tenant and studio data are
unchanged by this source review.
