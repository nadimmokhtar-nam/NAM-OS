# Task calendar, repeats and prerequisites

The calendar reads real authorized task records for an explicit inclusive date window. A month shows that month's due dates; a week starts Monday. Dates use the studio's Europe/Paris day. Unscheduled tasks are counted separately and never assigned an invented date. All six task statuses remain available.

`GET /api/tasks/calendar?from=2027-04-01&to=2027-04-30&page=1&page_size=100` returns exact matching totals, per-day totals, unscheduled totals and bounded pages. Windows contain at most 366 days; pages contain at most 200 records. Section, owner, status, priority, project, deliverable, search, focus, scope and archive filters run in SQL with task RLS. The API revalidates current permitted sections, membership revision and every returned task UUID before releasing a page. Scheduling responses refresh task/prerequisite access after their final identity check. The calendar never treats the first 50 bootstrap tasks as the complete set. Its loaded count distinguishes partial pages from complete day totals. A changed membership access revision restarts calendar paging.

`GET /api/tasks/:uuid/scheduling` reads saved repeat settings and prerequisites. `PATCH` accepts `{expectedVersion, changes}` with an `Idempotency-Key` header. `changes` contains `recurrence` and/or `prerequisite_ids`. Repeat values are `null` or `{frequency: 'daily' | 'weekly' | 'monthly', interval: 1..99, until: 'YYYY-MM-DD' | null}`. Prerequisites contain at most 100 unique task UUIDs. Version checks prevent lost updates; an identical retry returns the current saved record without another write. A reused key with a different task, expected version or payload conflicts.

List and board requests accept `sort=due_date|priority|newest|title`. Sorting runs across the complete matching authorized task set before pagination. The default due-date order retains the existing open-first behavior, then due date, priority and task number. Priority sorts Urgent through Low, then due date and task number. Newest sorts creation time and task number descending. Name sorts case-insensitive title, exact title and task number. No sort runs on just the first loaded 50 records. The existing project/deliverable fields and all task scopes, filters and RLS remain intact.

Completing a repeating task atomically creates one real Todo successor. It retains the owner, section, title, description, priority, project, stage and deliverable. Checklists, comments, files and prerequisites belong to the completed occurrence and are not copied. Monthly dates keep their original day anchor: 31 January repeats on 28 February and 31 March. `until` is inclusive. Canceled tasks do not generate a successor. Overdue repeats create the next scheduled occurrence one at a time; they do not skip overdue dates or materialize an unlimited future series. Dates beyond year 9999 end the sequence.

Every occurrence has its own task UUID, a unique series/index pair and an immutable, uniquely constrained predecessor link. Reopening and recompleting an earlier occurrence cannot create another successor, including after the latest task changes its rule or due date. Change the latest occurrence to adjust future repeats. A changed rule or date starts a new sequence from that same task; predecessor history remains intact. A deleted successor is retained as the same occurrence and is not silently recreated.

Repeat completion uses the caller's managed session and current create, section, owner and project permissions. No scheduled service identity impersonates a user. If current access cannot create the successor, completion rolls back; the owner can remove the repeat rule to finish without generating another task. An archived occurrence never spawns a successor. No notifications or emails are sent by the scheduling layer beyond the existing task-assignment notification behavior.

Prerequisites may connect only permitted, nonarchived tasks in the same workspace. Self links, duplicates, cycles and unavailable links are rejected with generic errors. A prerequisite satisfies completion only when it is Done, undeleted and accessible to the editor. Canceled tasks do not satisfy it. Open checklists retain their existing confirmation rule; that confirmation cannot bypass prerequisites. A completed prerequisite cannot be reopened or deleted while a completed task depends on it. Reopen the dependent task first. Deleting a prerequisite of open work leaves an unavailable link that must be resolved or removed.

An unavailable prerequisite is represented by a count, without its UUID or title. Repeat-only saves preserve those links. The UI requires explicit removal of unavailable links before replacing a prerequisite set. All task saves, task actions and prerequisite edits take the same workspace advisory lock before task locks, preventing reciprocal-edge and completion/reopen races. The lock is intentionally coarse; task writes within one workspace serialize.

## Application hooks

- Mount `dispatchTaskScheduling` before `dispatchTasks` because the latter parses the second path segment as a task UUID.
- Load `/task-scheduling.css`; initialize `createTaskScheduling` with the existing request, task, actor, route context and active task-filter callbacks.
- Render `controller.render()` in calendar mode, and call `load()` on navigation, filter changes and committed task changes. The controller owns month/week movement and additional calendar pages.
- Insert `controller.detail(task)` in task properties, then call `loadDetail(task)` after the task opens or updates. It refreshes its own region and preserves other unsaved task fields.
- Include `isSaving()` in task write/close controls and `hasUnsavedChanges()` in the task discard guard. `onTaskChanged(id, schedule)` must update the displayed task's version and refresh relevant counts without discarding unsaved parent fields.
- Call `reset()` on identity changes and unmount. Include `nam_task_dependencies` and `nam_task_schedule_requests` in the founder's business-export allowlist. Repeat columns are already part of `nam_tasks`.
- Call `closeDetail()` after an accepted task close or navigation. It invalidates pending detail/search responses and clears detail drafts without resetting the calendar period. It refuses to clear an active scheduling write.
- Security-definer workflows that hold project/deliverable locks before creating tasks must call `nam_task_schedule_lock(w)` first to preserve the common lock order. Its internal helper ACL intentionally excludes direct authenticated and service-role execution.

## Validation

`test/task-scheduling-db.test.mjs` executes current migrations, calendar paging, grants/session/MFA revocation, dependencies, repeats and retry identity in actual PostgreSQL through PGlite. `test/task-scheduling-api.test.mjs` exercises the real dispatcher and RPC transport, including revocation after a read, overlapping API requests and meaningful completion errors. PGlite has one backend; those overlapping API tests do not establish independent-backend lock behavior. `test/task-scheduling-ui.test.mjs` executes the browser controller, including response races, loaded/total labels, access-revision repaging, retained exact retries, repeat drafts and hidden-link removal.

For actual independent-backend locking, provision a **new empty disposable local PostgreSQL database**, with `psql` available and an account allowed to create the synthetic auth/storage schemas and test roles. Run:

```sh
NAM_SCHEDULING_TEST_DATABASE_URL=postgresql://localhost:5432/nam_scheduling_disposable node --test tools/task-scheduling-concurrency.mjs
```

The optional runner refuses remote hosts and existing NAM databases, applies all migrations to the empty database, verifies the second backend is waiting on an advisory lock, then tests reciprocal dependencies and concurrent repeat completion. It leaves that disposable database available for inspection. It is outside the default test glob. It has not been run in this workspace; no hosted database, provider session or deployment has been touched.
