# Programa fidelity review — 26 November 2026

Reference: the authenticated application at https://app.programa.design/projects.
This is a measured-reference source correction, not completed visual acceptance.

## Fresh reference inspection

The local authenticated browser successfully opened Projects, a populated example
project, Project Management and an existing task. No task, project, invitation,
approval or sharing setting was changed. The original Timeline selection was
restored before returning to Projects.

At 1280 × 720, the directory displayed four project columns. The project-list DOM
reported a 16 px gap and a 1004 px content width. The screenshot shows approximately
240 × 120 px thumbnails (a 2:1 frame); individual thumbnail rectangles were not
separately measured. Titles stay on one line with an ellipsis. These observations
do not establish other viewport breakpoints.

The task title again measured 18 px / 28.8 px in InterVariable. The properties
rail measured 400 px, with 16 px top and 24 px side/bottom padding, on the warm
`rgb(248,246,243)` surface. These agree with the existing task tokens and rules.
The prior 1440 px shell measurements remain separate from this 1280 px inspection.

## Source correction

The reviewed branch used three desktop project columns, 24 px gaps and a 156 px
minimum cover height. Its 24 px thumbnail padding also inset selected cover images.

The directory now uses four desktop columns and 16 px gaps. Desktop frames use a
2:1 ratio; covers fill and crop inside the frame without changing the selected
render or original bytes. Project titles visually truncate while retaining their
full text in the button's accessible name. Existing two-column and one-column
breakpoints remain; the narrower layouts retain their earlier 16:9 cover ratio
and minimum heights. Changes stay in the canonical workspace/planning stylesheets.

## Verification and limits

The preceding source commit `836d67ee3d9ccc034d9fbfb891096a1206acd71e` passed
776 source/database/API checks, TypeScript, the production build and 89 distinct
isolated-provider browser scenarios. Those counts are baseline evidence and
must not be attributed to this correction before its own workflows finish.

The development computer became unavailable during source reconciliation.
The live reference was inspected before disconnection; the corrected NAM layout
has not yet been directly rendered alongside it. GitHub verification and another
matching-size visual review remain required. Main, hosted migrations and studio
data are outside this source-only correction.

## Connected directory pass after reconnection

The authenticated reference was measured again at 1280 × 720, 1440 × 1000 and
390 × 844. The earlier 220 px navigation estimate was inaccurate: the reference
uses a 228 px desktop navigation allocation and a workspace starting at 236 px.
Its project thumbnail ratio is 93:46, with a 10 px gap above a 42 px caption.
The List view uses 54 px rows. The view menu is 280 px wide, with 4 px padding
and an 8 px radius. The measured record is in
`PROGRAMA_REFERENCE_MEASUREMENTS.json`; private account text and artwork are
excluded.

NAM's actual client modules were rendered locally with clearly synthetic project
responses. This local fixture establishes layout and client interactions, not
Supabase authorization, persisted writes or hosted readiness. The existing
native-provider test captures were also read from the preceding verified run.

At 1280 px, NAM and the reference both measure: grid x252/y174, 1004 px grid width,
239 px cards, 118.2109375 px thumbnails, 42 px captions and 16 px grid gaps.
At 1440 px, both grids are 1164 px wide with 279 × 138 px thumbnails. The mobile
client fits 320/390 px without document overflow. NAM retains 44 px mobile
controls, so its toolbar is deliberately taller than Programa's observed one.

The directory now provides real client-side search by permitted name, client,
location and type; natural-name/date sorting; Grid/List; empty-search recovery;
keyboard dismissal/focus return; and retained filters when opening a project
and returning. Opening a project adds a browser-history entry for Back/Forward.
All production work remains available in the view menu. Directory context is
cleared at unmount and identity/access changes. No permission scope is expanded.

Migration 037 adds existing creation/update timestamps to the same read-only,
security-invoker project summary. Its existing RLS, task scope, ordering and
200-record bound remain. Search/sorting are explicitly limited to those loaded
summaries; manual ordering and pinning are not represented as implemented.

The local 130-check controller/bridge/route suite passes. The new native scenario
uses the disposable provider to check metadata, search/sort/List, Back/Forward,
320/390 px containment, accessibility and the artist's restricted directory.
The complete source/database/build and native workflows still need their run on
this candidate. Hosted migrations, provider reconciliation and full application
visual acceptance remain separate requirements.
