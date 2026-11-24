# P0 fixed roles and section access

Migration 013 adds founder administration for existing members and explicit assigned-only section grants. It does not implement managed teams, collaborators, restricted-task sharing, delegated publishing, project membership or cost access. A Sales Manager or Production Manager label still does not grant team-wide authority. Those remaining requirements are documented in Product Foundation §4.

## Founder workflow

A verified AAL2 founder opens Settings → Workspace access → Manage access. Choose one of the five non-founder role templates, enable eligible sections, and select whether the person can create tasks there. Existing assigned work remains readable when task creation is disabled. Role selection retains only compatible selected sections; newly eligible sections start unchecked. Saving all sections unchecked removes section work access while retaining the account and work history.

Founder accounts and the current founder's own access cannot be edited through this flow. Founder promotion, transfer or recovery stays in a verified operator process. This protects the last founder as well as avoiding self-lockout. Pending invitations must be accepted or revoked before editing access. Suspended accepted accounts can have their intended permissions prepared before restoration.

Each save uses the member's access revision. Concurrent/stale edits produce a conflict with an explicit reload choice. Role, active-status and name changes invalidate old access forms too. The database records trusted actor, target, old/new role, old/new grants, revision and timestamp. Ordinary members cannot mutate grant tables or read founder audit rows.

## Initial and existing memberships

The migration performs a one-time assigned-only backfill for existing non-founder memberships, preserving the previous role ceiling and task-creation behaviour. This is a compatibility step, not an implicit grant for every future member.

New direct membership inserts receive no grants. The trusted invitation transaction explicitly creates a new person's assigned-only baseline from the selected fixed template. The invite form discloses those initial sections. Reinviting an existing person retains only previously granted compatible sections; it does not restore revoked grants or automatically add a new role's sections. Synthetic test/operator provisioning must explicitly populate intended grants rather than relying on a permissive insert trigger.

The role ceiling is enforced even if an operator leaves an incompatible grant row behind. This release's grant scope is constrained to `assigned_only`. `can_create` concerns ordinary tasks; it does not authorise course publishing, assignment to colleagues, report review, targets, exports or integration administration.

## Enforcement

`nam_section`, `nam_task_read_scopes` (including migration 011's optimised policy), task detail/action checks, task pages/counts and Academy/Sales policies all consult live membership/grants. Creating tasks requires the separate creation permission. Assigning a task requires an active eligible recipient with actual access to that section. Revoking a section prevents the same still-valid session/JWT from reading that work or its notifications/attachments; it does not delete the work.

Bootstrap uses the database's effective section/create/member-section metadata, skips unavailable Academy content, and supplies only permitted owner identities. The browser hides unavailable creation controls and fails closed on missing/malformed permission metadata. API and database checks remain authoritative. Existing short-lived signed downloads can remain usable until their expiry, and the UI cannot erase information someone has already viewed.

## Evidence and release limits

Focused PostgreSQL tests apply the actual migration and cover deny-by-default membership, compatibility backfill, founder MFA/session checks, protected founder access, direct grant-table denial, section revocation across the optimised task path/counts/notifications, Academy enrollment revocation, separate creation capability, assignee eligibility, fixed-role ceilings, malformed/duplicate grants, stale revisions and audit attribution. API tests execute the actual TypeScript dispatcher against PostgreSQL RPCs and check body-time revocation. UI interaction tests cover compatible role changes without automatic new grants, dependent checkboxes, conflict draft retention and clearing revoked administration.

These are source/PostgreSQL tests with represented Supabase-managed auth/storage schemas. Real hosted Supabase migrations, provider sessions, direct PostgREST/Storage requests, browser responsiveness/keyboard behaviour and an eight-user hosted pilot remain release gates. This slice does not establish compliance with the complete §4 permissions matrix.

## Rollout order

Apply the migration to an isolated staging database first, verify the explicit-grant backfill against intended members, then deploy the matching API/UI. The new API deliberately fails closed if the effective-access RPC or permission metadata is unavailable. Review actual grants before inviting a broader team. Preserve a verified database backup before any production migration; do not drop the grant table as an ad-hoc rollback while these policies depend on it.
