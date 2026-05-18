## Why

Four files in `apps/console/` reach across the monorepo with deep relative
paths to import backend type definitions. This couples the UI build to the
backend's directory layout and breaks silently on a rename. From
`openspec/audit/cap-l2-backup-audit-reporting-ui.md`:

- **B7** (`apps/console/src/components/backup/AuditEventTable.tsx`,
  `AuditEventDetail.tsx`, `AuditEventTypeBadge.tsx`,
  `lib/api/backup-audit.api.ts`) — all four import
  `../../../../services/backup-status/src/audit/audit-trail.types.js` (note
  the `.js` extension on a `.ts` source). The resolver depends on whatever
  consumes these files; without a path mapping the build silently snaps when
  the backend file moves.
- **G3** (same files) — cross-service relative imports are flagged as the
  same anti-pattern documented in C2, D2, and E2.

## What Changes

- Publish backup-audit type definitions as a workspace package
  `@in-falcone/backup-audit-types` sourced from the existing
  `services/backup-status/src/audit/audit-trail.types.ts` (re-export only,
  no behaviour change in the backend).
- Update the four `apps/console/` files to import from the workspace
  package; remove every `../../../../services/...` relative path.
- Add a CI lint rule (or `eslint-plugin-import` `no-restricted-paths`)
  forbidding cross-service relative imports from `apps/console/src/`.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: source-tree boundary between the console app and
  backend service packages.

## Impact

- **Affected code**: new `packages/backup-audit-types/{package.json, src/index.ts}`,
  `services/backup-status/package.json` (add re-export entry), four files
  under `apps/console/src/` updated to use the workspace package.
- **Migration required**: none at runtime; CI updates required (lint rule
  added).
- **Breaking changes**: none — types only.
- **Out of scope**: replacing the runtime audit API client; renaming
  backend types.
