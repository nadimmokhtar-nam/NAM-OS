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
