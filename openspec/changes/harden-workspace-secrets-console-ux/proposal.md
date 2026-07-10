## Why

Issue #772 confirmed that the Workspace Secrets console page worked functionally but still used
several one-off UX patterns on a high-consequence secrets surface. Referenced secret deletion used a
local confirm dialog without type-to-confirm, create validation reported only one combined error, the
success message for replace/delete lived in the create card, and the metadata table forced a wide
`min-w-[64rem]` layout. The page also kept local warning/stage styling rather than reusing the
console primitives added by later design-system work.

This change hardens the existing `/console/workspace-secrets` page without changing the secrets API,
OpenAPI, generated clients, backend authorization, or write-only value contract.

## What Changes

- Route Workspace Secrets delete confirmation through the shared
  `DestructiveConfirmationDialog` / `useDestructiveOp` flow.
- Require type-to-confirm for deleting a referenced secret or any secret in a production workspace.
- Show the referenced-function count in the shared destructive dialog's cascade-impact section.
- Add static cascade-impact support to `useDestructiveOp` so UI-owned impact summaries can use the
  canonical dialog without inventing an admin cascade endpoint.
- Split create validation into per-field name/value errors, with `aria-invalid` and
  `aria-describedby` wired to each input.
- Keep create success near the create form, but move replace success to the affected row and delete
  success to the table/list region rather than the create card.
- Add an in-page Workspace Secrets breadcrumb while preserving the shell breadcrumb.
- Reuse `getConsoleContextStatusBadgeClasses` for the active stage badge and the shared table
  primitive for metadata rows, removing the hard `min-w-[64rem]` table.
- Update focused web-console tests and the Workspace Secrets console architecture note.

## Non-Goals

- No backend, storage, OpenBao, route, OpenAPI, public catalog, SDK, or generated contract change.
- No new secrets API behavior. Server-side role enforcement, workspace isolation, write-only values,
  and default-off backend semantics remain unchanged.
- No broad table primitive redesign outside this page.
- No live data mutation beyond the existing deployed test-cluster verification workflow; the
  frontend behavior is covered by unit tests and, after deployment, by the same live-bundle marker
  checks used by adjacent console polish fixes.

## Exit Criteria

- Focused Workspace Secrets tests cover per-field validation, confirmable referenced/prod deletion,
  row/table-local success feedback, shared table usage, and stage-badge helper reuse.
- `openspec validate harden-workspace-secrets-console-ux --strict` passes.
- `npm run generate:public-api` produces no tracked generated contract diff.
- The working diff remains limited to frontend, docs, tests, and OpenSpec files for issue #772.

## Risks and Rollback

The change is frontend-only and additive. The shared destructive dialog is already used by storage,
service accounts, functions, plans, and auth-config flows; static cascade-impact support preserves
existing fetch-based cascade behavior and only skips the fetch when a caller passes a known static
summary. Rollback is a straight revert of the page/test/docs/OpenSpec changes plus the hook extension.
