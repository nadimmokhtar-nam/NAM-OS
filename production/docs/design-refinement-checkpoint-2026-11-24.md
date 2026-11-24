# NAM OS — design refinement checkpoint

Date: 24 November 2026

Status: paused at the user's request before implementation. The user will first try the application; the next design review is deferred until they return. No CSS, JavaScript, authentication, database, Figma, main-branch or hosted-application changes were made in this refinement workstream.

## Source baseline

Canonical source reviewed: `05c39b4fbe49f5826aa88dcabe60e3520b0d67ec`, PR #11, `nam-os/password-first-login`.

| Source | Exact blob |
| --- | --- |
| `production/app/styles.css` | `e5265acd71be372e5b8a55c755a0dd7798d81f2a` |
| `production/public/styles.css` | `c96eaa83e83b4346b1f80c5e7d305af1b1a07494` |
| `production/public/icons.js` | `b055b7d33c51889aaa42d12ebf0f503b0e45c779` |

The complete nine-page `NAM_OS_UI_UX_Design_Specification.pdf`, version 1.0, was read. Figma design context with screenshots was retrieved for the approved file `xnMxoEBJXnriPYznIgivFb`: Overview `19:2459`, My Tasks `5:195`, and Academy Catalogue `19:3274`. Retrieval alone is not a completed visual comparison.

The available private, masked, synthetic QA run-4 captures cover 320×640, 375×812, 768×1024, 1024×768 and 1440×900. They remain private. Their pixel review and comparison with Figma are still pending. No screenshots are included in this commit.

## Confirmed design constraints

- Preserve the original NAM logo and approved 68 px sidebar placement, 240 px desktop sidebar, 72 px header and 24 px desktop horizontal content padding.
- Preserve the approved 32 px desktop page heading. Keep Inter and the self-hosted font assets.
- Retain application background `#f1f1f1`, panel surface `#fdfdfd`, fine borders and restrained pill controls.
- Maintain aligned panel edges, common content baselines, consistent table rows, card footers, control heights and content spacing.
- Academy includes Sales, 3D and Post-production.
- Use semantic status information in addition to colour, visible keyboard focus and reduced-motion support.
- The latest instruction overrides the older PDF's proposed button press scaling, sidebar-width animation and modal scaling. Do not add button scaling, layout motion or decorative transitions.
- The PDF identifies several dimensions and colours as proposals. Actual approved Figma geometry and later user decisions take precedence over those proposals.

## Primary guidance retrieved

Official Apple Human Interface Guidelines were retrieved through their Markdown versions:

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout.md): deliberate alignment and grouping; layouts adapt to window and text-size changes.
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography.md): legible hierarchy and support for changes in text size.
- [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons.md): understandable actions, consistent related controls and usable activation regions.
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility.md): readable contrast, keyboard support and information that does not depend only on colour.
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion.md): purposeful, brief feedback with reduced-motion alternatives.

These are native-platform guidelines. Their platform-specific point sizes and visual materials are not a direction to replace NAM's approved web typography or monochrome design. The proposed web control target remains 44 CSS px where appropriate; compact controls require a separate spacing and accessibility review.

## Deferred review backlog

These are review tasks, not verified defects.

| Priority | Review | Acceptance evidence |
| --- | --- | --- |
| 1 | Compare actual shell, alignment, typography and card bottoms with approved Figma at all five baseline sizes | Annotated private before/after captures, viewport and source SHA recorded |
| 1 | Review every module and control state, including empty, loading, error, validation, success and permissions | Completed route/state inventory with defects and verified corrections |
| 1 | Verify keyboard navigation, focus visibility, meaningful control labels and 200% zoom | Direct keyboard and browser checks, automated findings reviewed manually |
| 1 | Measure normal text contrast at 4.5:1 and essential non-text/focus contrast at 3:1 where applicable | Recorded foreground/background pairs and calculated ratios |
| 2 | Establish shared colour, spacing, typography, radius, control, focus and motion tokens without visual redesign | Isolated CSS diff, cascade review and visual regression results |
| 2 | Check 320/375/768/1024/1440 px layouts, long labels and values, wrapping and horizontal overflow | Browser measurements; no unintended document overflow, obscured actions or cropped labels |
| 2 | Review all animations and transitions | No automatic button scaling/layout motion; reduced-motion preference respected |
| 2 | Measure responsiveness, layout stability and rendering cost before accepting changes | Recorded baseline and candidate metrics, explicit agreed budgets and unchanged feature behaviour |
| 3 | Run Founder and Sales realistic-use simulations | Two separate observed 30-minute sessions, task outcomes and friction log |

## Cycle accounting and resumption

Completed design cycles: **0 of 4**. No implementation, correction verification, authenticated simulation, candidate rendering or performance measurement has been completed in this workstream. The existing release-testing cycles are separate and do not count as design cycles.

On resumption:

1. Confirm the post-trial source SHA and rebase the isolated design workstream on it.
2. Read the user's trial feedback and inspect actual baseline screenshots and Figma contexts.
3. Agree concrete measurement budgets with the release owner, then complete the first documented design review, narrow correction set and verification.
4. Repeat meaningful review, corrections and verification for all four design cycles, retaining private evidence.
5. Keep CSS ownership separate from the interaction agent's JavaScript changes and from authentication or feature work. No deployment occurs through this workstream.

This checkpoint contains no readiness claim. It preserves the grounding completed before the pause.
