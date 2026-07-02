## 1. Backend runtime

- [x] 1.1 Add `DELETE /v1/functions/actions/{actionId}` to the kind control-plane route table and
  map it to a local `fnDelete` handler.
- [x] 1.2 Implement `fnDelete` with tenant-scoped action lookup, same-tenant write-role gating, the
  existing Knative delete helper seam, and a `202 GatewayMutationAccepted`-style response.
- [x] 1.3 Add a store helper that deletes the resolved action's activations, retained versions, and
  action row without using request-supplied tenant/workspace scope.

## 2. Web console

- [x] 2.1 Add a service-layer `deleteFunction` wrapper for
  `DELETE /v1/functions/actions/{resourceId}` with optional idempotency key support.
- [x] 2.2 Add a selected-function delete button on `/console/functions`, disabled while the function
  is not write-actionable.
- [x] 2.3 Use `useDestructiveOp` and `DestructiveConfirmationDialog` for destructive confirmation.
- [x] 2.4 On success, refresh inventory, remove the deleted row, clear selected detail, and show
  success feedback. On failure, keep the row/selection and show the backend error without false
  success feedback.

## 3. Tests

- [x] 3.1 Add backend regression coverage for route dispatch to `fnDelete`.
- [x] 3.2 Add backend regression coverage for tenant-scoped not-found behavior, same-tenant
  non-admin denial, row cascade, and owned Knative service deletion through the injected seam.
- [x] 3.3 Add web-console service tests for the DELETE wrapper and idempotency key.
- [x] 3.4 Add web-console page tests for destructive confirmation success/failure and provisioning
  disabled state.

## 4. Docs, OpenSpec, and verification

- [x] 4.1 Add this OpenSpec change under
  `openspec/changes/fix-787-function-delete-capability/`.
- [x] 4.2 Update function lifecycle/docs with delete behavior and console/API mapping.
- [x] 4.3 Run focused backend tests.
- [x] 4.4 Run focused web-console Vitest tests.
- [x] 4.5 Run `openspec validate fix-787-function-delete-capability --strict`.
- [x] 4.6 Run `npm run generate:public-api` and confirm generated artifacts are unchanged or report
  any tracked drift.
- [x] 4.7 Run `git diff --check`.
