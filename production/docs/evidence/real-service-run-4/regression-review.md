# Run 4 regression review

The retained real-service report records 11 of 13 browser tests passing. The overall suite remains failed. This review does not treat an incomplete lifecycle as a pass.

## Academy: harness correction

The lifecycle successfully reached private-resource download, saved course completion, reload, reopening a lesson and completing it again. Its final area-isolation step failed while expecting the Academy catalogue heading.

The test used `page.goto('/workspace#academy')` while the lesson view already had exactly that URL. Course detail deliberately shares the Academy hash; same-URL navigation does not emit a hash change and cannot express returning from the course view. The actual UI provides an **All courses** button that clears the selected course, refreshes data and renders the catalogue.

The corrected test clicks that visible button, requires the Academy heading, confirms the authored Sales course is visible in Sales, and retains the assertions that it is absent from 3D and Post-production. This is a correction to the browser harness; the prior heading failure alone does not establish an application defect. The corrected flow requires another real-service run.

## Tasks: application race remains under correction

Run 4 observed a successful HTTP 200 response after the rapid subtask completion and Done save. The Done value assertion passed. The following immediate close failed before the save's wider UI refresh settled. The test retains the fast close action and its original hidden-dialog assertion; it adds no delay or automatic discard confirmation. The application correction is owned separately.

## Installer: visual correction observed, assertion strengthened

Direct inspection of the retained 320 × 640 and 375 × 812 PNGs shows the installer below workspace content in a separate footer. The prior List/Board collision and task-panel footer overlay are absent in these two captured states. Install guidance remains available.

The first collision check selected `.pwa-tools button`; the corrected installer had moved into `.pwa-install-slot`, leaving that check unable to observe it. The harness now includes both containers, requires exactly one Install NAM OS button, checks its bounds against main action targets, and verifies that its mobile footer is in normal flow below the main content. The stronger geometry check has not yet run against real services.

Local verification of the harness update: JavaScript syntax passed, and Playwright discovery listed all 13 required tests in two files. Discovery is not test execution. Full website readiness, live NAM infrastructure, external provider integrations and native installation remain outside the claims of this review.
