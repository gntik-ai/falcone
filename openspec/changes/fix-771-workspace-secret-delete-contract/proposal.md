## Why

Workspace Secret DELETE diverged from the published API contract. The OpenAPI operation
`deleteFunctionWorkspaceSecret` declares `204 No Content` for an existing secret and `404` for a
missing secret, but the kind control-plane handler unconditionally called the vault delete operation
and returned `200 { "deleted": true }`.

That idempotent runtime behavior is defensible in isolation, but it breaks strict clients and SDKs
generated from the contract. The fix chooses the already-published contract as the source of truth and
brings the runtime back into agreement.

## What Changes

- `deploy/kind/control-plane/fn-handlers.mjs::secretDelete` now validates `secretName`, probes the
  verified tenant/workspace path with `vault.exists`, returns `404 SECRET_NOT_FOUND` when the secret
  is absent, and returns `204` with no response body after deleting an existing secret.
- Existing tenant/workspace isolation and tenant-admin role ordering is preserved: cross-tenant still
  returns `404 WORKSPACE_NOT_FOUND` before role or existence checks; own-tenant non-admin still returns
  `403 FORBIDDEN` before probing the vault.
- The OpenAPI contract, SDK, and route catalog do not change. The runtime now matches the existing
  contract.
- The web-console HTTP helper now treats `204`/`205` and empty JSON responses as `null`, so the
  existing Workspace Secrets delete flow accepts the contract-strict no-body success response instead
  of attempting to parse an empty JSON payload.
- Docs and tests now encode the `204` / `404 SECRET_NOT_FOUND` behavior.

## Impact

- Backend: one handler in the kind control-plane.
- Frontend: shared request helper handles authenticated no-body success responses; the secrets client
  comment documents the contract-strict DELETE behavior.
- Contract/codegen: no OpenAPI or generated artifact changes expected.
- Deployment: no data migration. The only behavior change is DELETE status/body conformance.
