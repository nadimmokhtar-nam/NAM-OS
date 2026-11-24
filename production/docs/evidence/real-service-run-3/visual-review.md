# Authenticated responsive visual review — real-service run 3

Reviewed all five retained PNGs directly. They show the same synthetic founder task list after real local Supabase authentication, rendered by the built Next application in Chromium. These are captured states, not evidence that every module, modal, scroll position or native installed application has been visually reviewed. Identity details are intentionally masked in the images.

| Capture | Observed layout | Finding |
| --- | --- | --- |
| 320 × 640 | Heading wraps naturally; actions, tabs and two-column filters fit; the single task stacks legibly; navigation is collapsed. | **V-01, medium:** the fixed Install NAM OS button starts near x167/y585 and overlaps the List/Board switch, which extends approximately x16–172/y565–609. The bounding boxes intersect and the controls lack separation. |
| 375 × 812 | Heading fits one line; filters and action groups remain aligned; the task title and metadata are legible. | **V-01, same cause:** the installer floats over the task panel's divider/footer area near the viewport bottom. No task action is obscured in this particular image, but content is overlaid. |
| 768 × 1024 | Sidebar remains visible; title/actions wrap cleanly; filter rows and task panel share their left alignment; task columns remain legible. | No visible collision in this capture. Installer occupies empty lower-right space. |
| 1024 × 768 | Title and page actions share a clear header row; filters wrap before the view switch; task panel, tabs and filters align consistently. | No visible collision in this capture. Installer occupies empty lower-right space. |
| 1440 × 900 | Sidebar, top bar, page heading, tabs, filters and task panel form a consistent grid. Task columns and panel spacing are clear. | No visible collision in this capture. Installer occupies empty lower-right space. |

## Correction and verification

Keep install guidance available, and put the narrow-screen installer in normal document flow after workspace content or in Settings. A fixed bottom corner control cannot guarantee separation from scrolling content. Desktop placement can remain unchanged if it does not cover actions.

The responsive browser test now checks the actual installer bounds against every visible main action/input/link at each of the five viewports. It retains the existing horizontal-overflow, alignment, keyboard menu, dialog, and screenshot checks. This geometric assertion is newly added and requires the next real-service run; it has not been executed against a corrected installer yet. Review the next retained mobile captures to verify text is no longer overlaid as well.

The five images show a coherent task-list layout. They do not establish full website visual readiness. Academy and Sales states, longer task lists, modal states, zoom, screen-reader output, other browser engines and native installation remain separate review work.
