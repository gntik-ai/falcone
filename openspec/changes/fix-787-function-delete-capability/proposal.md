## Why

Falcone function actions can be deployed, listed, invoked, updated, and rolled back, but the kind
control-plane had no runtime route for deleting a deployed function and the web console had no
delete affordance. The published public contract already advertises
`DELETE /v1/functions/actions/{resourceId}` as `deleteFunctions`, so deployed function rows and their
Knative services accumulated indefinitely instead of following the documented lifecycle.

## What Changes

- Add the kind control-plane route `DELETE /v1/functions/actions/{actionId}` and dispatch it to a new
  `fnDelete` handler.
- Resolve the action through `store.getFnAction(ctx.pool, id, callerTenantId(ctx.identity))` before
  any side effect, preserving tenant-scoped not-found behavior for missing and cross-tenant IDs.
- Gate deletion as a structural function write: superadmin/internal and the owning tenant's
  owner/admin roles may delete; same-tenant non-admin callers receive `403` before teardown.
- Tear down the associated Knative service through the existing `deleteKnativeService` helper when
  `ksvc_name` is present, then remove the action row plus associated retained versions and
  activations.
- Add a web-console selected-function delete control using the shared destructive confirmation flow.
  Successful delete refreshes inventory and clears selection; failed delete leaves selection intact
  and surfaces the error without showing success.
- Add deterministic backend and web-console tests covering route dispatch, tenant scoping, row
  cascade, Knative delete seam invocation, destructive confirmation success, and destructive
  confirmation failure.
- Add human docs for function delete lifecycle and console/API mapping.

## Impact

- Affected capabilities: `functions`, `web-console`.
- Wire compatibility: no contract shape change. Existing OpenAPI/public-route-catalog artifacts
  already declare `DELETE /v1/functions/actions/{resourceId}` with a `202 GatewayMutationAccepted`
  response and `Idempotency-Key`; this change brings runtime and console behavior into sync.
- No live cluster mutation is required for tests; Knative teardown is exercised through an injected
  helper seam.
