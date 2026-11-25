# Academy learning paths and subjects

The additive migration `202611250030_academy_paths.sql` retains the existing
Sales / 3D / Post-production areas and all course/module/lesson authoring,
immutable publications, enrollment, self-reported progress, written resources,
practical submissions and private-video APIs.

The Academy subject vocabulary is Interior, Exterior, Lighting & composition,
Materials & texturing, Post-production, AI workflows, NAM standards & SOPs and
Onboarding. Subjects classify a course's working copy. The next explicit
publication captures that classification; existing publications are not
retagged or populated from guesses. The assigned-course library filters the
subjects of each learner's actual enrolled publication.

A Founder creates a path, writes its outcome, chooses subjects and orders up to
100 exact published course versions. An empty draft is valid; assignment
requires at least one course. Editing or archiving a path never changes earlier
learner snapshots. A learner sees only their active path assignments. Paths are
not publicly discoverable and do not grant administration capabilities.

Assignment checks current learner membership and Academy grants, locks native
course enrollment rows through their course locks, then reuses the existing
`nam_academy_admin(...,'enroll',...)` transaction with an explicit publication
version. A matching active enrollment is reused and a mandatory course is never
demoted. A different active version rejects the whole path assignment with 409;
the Founder must review that existing enrollment explicitly. No course is
partly assigned when another course conflicts. No enrollments are automatically
upgraded when a course is published or the path changes.

Path completion is derived at read time from the exact snapshotted publication,
matching still-active enrollment, actual lesson-progress rows and existing
self-reported course-completion record. Reopened lessons remove current
completion credit while retaining history. Archived courses, removed enrollments
or explicitly changed versions are shown as unavailable and receive no current
path credit. Practical approval is a separate workflow.

Removing a path assignment retains course enrollments, mandatory course flags,
private-video access controlled by those enrollments, and completion history.
Those courses can also serve another path or a direct assignment. Remove course
access separately through the existing course administration when appropriate.
An archived path cannot receive new learners; its previously assigned snapshots
remain available.

## API and UI integration

The authenticated catch-all route calls `dispatchLearningPaths` from
`lib/api/learning-paths.ts` after the existing context and Origin/CSRF gates,
before the existing Academy dispatcher. The RPCs also independently recheck
managed sessions, optional enrolled-factor MFA and current membership/grants.

| HTTP route | Operation |
| --- | --- |
| `GET /academy/topics` | Canonical subjects and own assigned-publication subject mapping; at most 1000 course mappings, declared by `course_limit`. |
| `GET /academy/paths` | Own active path snapshots; `page_size` 1–100, default 50, `offset` 0–100000. |
| `GET /academy/paths/:assignmentId` | One own active assignment with real version-specific progress. |
| `GET /academy/admin/paths` | Founder path definitions with counts and the same bounded paging. |
| `POST /academy/admin/paths` | Create with `id`, `command_key`, `title`, `summary`, `topics`, `courses`. |
| `GET /academy/admin/paths/:pathId` | Current definition, at most 50 active learner snapshots and 50 recent events; learner continuation via `offset`. |
| `PATCH /academy/admin/paths/:pathId` | Replace editable definition with `expectedRevision`, `command_key`, `title`, `summary`, `topics`, `courses`. |
| `POST /academy/admin/paths/:pathId/assign` | `expectedRevision`, `command_key`, `member_id`, `mandatory`. |
| `POST /academy/admin/paths/:pathId/revoke` | `expectedRevision`, `command_key`, `assignment_id`. |
| `POST /academy/admin/paths/:pathId/archive` | `expectedRevision`, `command_key`, `archived`. |
| `GET /academy/admin/path-courses` | Bounded course choices with at most 20 recent exact publications each; `older_publications` identifies truncated history. |
| `GET /academy/admin/path-courses/:courseId/publications` | Bounded publication history; the editor can explicitly load earlier choices without dropping its draft. |
| `PATCH /academy/admin/course-topics/:courseId` | Explicit working-copy classification with `expectedRevision`, `command_key`, `topics`; never publishes. |

Each course choice is `{course_id, publication_id}`; neither latest nor a draft
is inferred. Mutation commands require a UUID `command_key`. A transaction lock
and stored actor/payload/result make identical retries return one acknowledgment.
Changing the body under the same key conflicts. A completed acknowledgment is
followed by a separate current read. Version conflicts retain the local editor
until the user explicitly reloads. Unknown fields, malformed IDs, duplicates,
unbounded pages and mismatched publication/course pairs are rejected.

Import `public/learning-paths.css` through the existing shared stylesheet entry.
Instantiate the controller once:

```js
const learningPaths=createLearningPaths({
 request:api,openDialog,toast,onViewChange:render,onChange:refresh,
 getContext:()=>({founder:founder(),members:state.data?.members||[]})
});
```

Add a Paths Academy tab, call `await learningPaths.load()` before rendering it,
and render `learningPaths.render()`. Founder-only Manage paths and Course
subjects views live inside that tab. The controller owns its `data-path-action`
and `data-path-form` event listeners; no extra root event handlers are needed.
Before My learning, call `loadSubjects()` and pass
`...learningPaths.libraryState()` into `renderLearning`. Its optional new props
are `topics`, `courseTopics` and `topic`; existing callers remain compatible.

Include `hasUnsavedChanges()`, `discardUnsavedChanges()` and `isSaving()` in the
shared navigation/sign-out guards. Call `reset()` on account/workspace reset.
Async replies from an earlier account generation are rejected. In-flight forms
disable their controls, preserving the submitted draft; lost-response retries
reuse the same command key for the same payload.

Path reader buttons use the existing `data-action="course"` contract plus
`data-publication`. After loading a course, the shell should compare that hint
with its returned `publication_id`, refuse a stale version and refresh paths if
the enrollment changed since the path was rendered. The ordinary course reader
and its existing downloads/video/progress controls continue unchanged.

The UI consumes shared Inter/Newsreader, warm-neutral surfaces, compact pills,
28px desktop actions, restrained separators and 44px mobile touch controls.
It adds no inline styles or new package. Direct browser/reference comparison is
still needed to establish responsive and visual acceptance.

## Preservation and verification

New persistent tables for export/retention integration are
`nam_academy_topics`, `nam_course_topics`, `nam_course_version_topics`,
`nam_learning_paths`, `nam_learning_path_topics`, `nam_learning_path_courses`,
`nam_learning_path_assignments`, `nam_learning_path_assignment_courses`,
`nam_learning_path_events` and `nam_learning_path_commands`. Commands are private
to the transaction; helpers that build another learner's progress have no
authenticated EXECUTE grant. Client table privileges are SELECT-only and RLS
guards raw reads as well as API routes. No hosted migration or data import is
performed by this code change.

`test/learning-paths-api.test.mjs` runs the real TypeScript dispatchers against
the disposable PostgreSQL migration/RLS harness. It covers pinned publication
progress/reopen, all-or-nothing conflict behavior, immutable path snapshots,
idempotent retries, revocation, enrollment changes, topic publication capture,
direct SQL/API access, optional MFA, current grants and bounded inputs.
`test/learning-paths-ui.test.mjs` runs the real controller and library renderer
with a bounded DOM/HTTP fixture. It covers exact-version navigation metadata,
draft preservation/order, retry keys, explicit conflict reloads, grant-filtered
assignment, working-copy subjects, compatible area filtering and stale account
responses. These fixtures are synthetic and contain no NAM curriculum.

Actual authored NAM course text, source-approved downloads, licensed resources
and private videos must be verified from their authorized sources and imported
through the existing course authoring/upload workflow before publication and
assignment. The eight subject labels and path scaffolding are not a curriculum.
No portfolio text, requirements document, UI screenshot or invented lesson is
substituted for authored studio training.
