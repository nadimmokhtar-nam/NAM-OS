# NAM OS — Programa redesign

25 November 2026 · Phase 1: actual-reference collection

## Authoritative direction

Programa's actual application is the sole visual and interaction reference.
Use NAM branding and independently implemented components. Preserve functional
records, permissions, published learning, private media and source provenance.
Earlier Apple-oriented styling is a tested baseline, not the new direction.

Reference: https://programa.design/ and its linked https://app.programa.design/login/.
The supplied screenshot depicts the public feature menu, not authenticated screens.

Redesign branch: nam-os/programa-redesign. It starts from documentation checkpoint
a061f62d25f2dcbde804c0f4035d198002e45ce1, whose runtime is the verified1634e5c.
Baseline canonical45598630358 passed409 checks/TypeScript/build. Native45598630309
passed45/45 with eight managed identities. No Programa UI has been implemented yet.

## Observed references

Actual public login and password-recovery routes were rendered, measured and
captured at1280px desktop and390px mobile. No account submission was made.
Measurements apply only to these observed authentication screens; do not infer
authenticated workspace tokens from the marketing site or login page.

| Observed authentication property | Measured value |
| --- | --- |
| Font | Inter; input inner control reports InterVariable |
| Heading |22px /33px, weight600 |
| Label |16px /20px, weight400 |
| Desktop form |480px wide |
| Desktop composition |Full-height image rail about282px at1280px, centered form in remaining area |
| Mobile composition |Image rail hidden; form311px at390px, about40px side gutters |
| Primary action |40px high,8px radius,16px /20px, weight500 |
| Primary action surface |rgb(24,24,27), white text |
| Email control wrapper |32px high,6px radius,8px horizontal inset, rgb(252,251,249) |

The observed focused field has a neutral1px ring plus4px soft outer ring.
The default inner input is13px; mobile readability/accessibility must be checked
when adapting it. Reuse NAM-owned imagery rather than Programa's brand or imagery.
Do not add unsupported SSO buttons merely because they appear in the reference.

## Reference access still required

Authenticated Home/Projects, project details, tasks/list/board/timeline, task panel,
filters, menus, settings, notifications, empty/loading/error and responsive states.
The app requires sign-in. Request a user-controlled browser login; never request
passwords in chat or fabricate inaccessible interfaces. Screenshots/recordings
from the user's account can supplement direct inspection.

## Source audit and adaptation boundaries

Actual styles enter through app/styles.css and public/workspace.css.
public/styles.css is an outdated shadow copy. Consolidate the canonical system
instead of layering a third blanket override. Shell geometry is repeated across
breakpoints; centralize it after the reference dimensions are verified.

Preserve behavior hooks or migrate them explicitly: task/open/card selectors,
sidebar route links, lesson headings, dialog IDs, form IDs and data actions.
Keep Next.js, Supabase and the existing rendering engine; a framework rewrite
is not needed for visual fidelity.

The existing project directory, brief, lead, authorized members, references,
deadlines and shared tasks work. Tasks retain IDs across Today/Work/Projects,
version checks, owners, statuses, priorities, comments, checklists and private files.

Important product gaps must be solved truthfully:

- All current project-linked tasks count as deliverables. Distinguish image,
  animation and supporting work before presenting image totals; preserve
  unclassified historical records.
- Per-task production stages exist; project-level phases/milestones do not.
- Revision rounds, render-review assets and approval decisions are separate
  missing workflows. Task Done must not be relabelled Approved.
- Existing2MiB task attachments are private downloads, not a render review system.
- Managers' visibility must remain explicitly authorized. Layout changes cannot
  silently expand employee permissions.

## Implementation order after reference access

1. Complete the measured reference inventory and capture key interaction states.
2. Establish canonical tokens and reusable controls from those references.
3. Implement authentication, shell and representative project/task workflow.
4. Adapt Home, Academy, Sales, Team and Settings with the same primitives.
5. Implement additive, tested production capabilities without decorative tabs.
6. Compare rendered geometry/screens and rerun functional/security/accessibility,
   responsive and eight-user tests before hosted release.

Attio remains the CRM source of truth. Preserve planned Lemlist/JustCall
connections and source-labelled unavailable states. A visual redesign does not
make disconnected providers live. Existing release/recovery gates remain open.
