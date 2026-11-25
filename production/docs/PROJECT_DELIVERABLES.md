# Project camera and deliverable inventory

25 November 2026. Implemented on the Programa redesign draft branch. Migration
`202611250024_project_deliverables.sql` is additive and has not been applied to
the hosted workspace. Source and isolated-provider verification are recorded in
the pull request; this document is not a release acceptance statement.

## Records and work

Projects now contain an Images & deliverables view with real records for still
images, animations and 360 panoramas. Each has a stable identity, a unique camera
code within its project, a name, assigned artist, target date, camera brief,
production stage, version, archive state and immutable change history. Archived
codes remain reserved. Lists support search, stage/type filters, sorting, complete
authorized totals and pagination. No sample render or image approval is implied.

The ten current stages are Briefing, Modelling, Camera approval, Materials and
lighting, Draft production, Internal review, Client review, Revisions, Final
approval and Delivery. Historical tasks retain Brief, Materials and Lighting.

An optional composite foreign key links existing tasks to a deliverable in the
same workspace and project. Add task opens the existing task form with that
project, image, phase, artist and target date. Central Work and Project Management
read the same task identities, comments, subtasks and private attachments. Task
completion never approves an image or changes its production stage.

## Access and consistency

- Founder manages image creation, metadata, assignment, archive and restore.
- Explicit project participation and Projects access are required for image reads.
- Artists read images assigned to them, plus image briefs explicitly linked to
  their own active tasks. They cannot use that brief to read other owners' tasks.
- Only the primary assigned artist can update a camera brief and production
  stage; assignment, dates and other metadata remain management controls.
- Revoking project access immediately hides image metadata. Existing ordinary
  assigned tasks remain usable without exposing their hidden project or image.
- RPC writes recheck access after locking, compare captured versions and write
  immutable history. Creation retry keys return the same record only for the
  same original payload. Direct authenticated writes are not granted.
- Archived images reject new linked work and editing until restored. Moving a
  task outside production clears its image, phase and project atomically.
- Conflict responses preserve the open draft and offer explicit reload. Pending
  saves freeze fields and prevent closing/navigation until acknowledgement.

Business export format 5 includes deliverables and their event history alongside
existing task associations. Authentication secrets and attachment bytes remain
outside this business export.

## Reference composition and remaining work

The inventory extends Programa's measured schedule treatment: compact 48px rows,
2px gaps, 10px row corners, warm surfaces, existing controls and a standard side
drawer. Narrow layouts wrap metadata rather than hiding production information.
NAM uses the authorized Newsreader display face with Inter for the UI.

This inventory does not implement render uploads, version comparisons, image
annotations, revision-round decisions, client portal access or image approval.
Those need independent permissioned records and actual populated Programa
references. Ordinary task attachments are not a substitute for a review system.
