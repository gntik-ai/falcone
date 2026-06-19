# tenant-provisioning — spec delta for fix-workspace-slug-conflict-409

## ADDED Requirements

### Requirement: Resource-name conflicts return 409 without leaking a database SQLSTATE

The system SHALL map a unique-constraint violation (`SQLSTATE 23505`) from `store.insertWorkspace`
to an HTTP `409 Conflict` response with error code `WORKSPACE_SLUG_CONFLICT`, so that a caller
that races past the pre-existence check receives a structured conflict response rather than a `500
Internal Server Error`.

The `(tenant_id, slug)` UNIQUE constraint is the authoritative guard against duplicate workspace
slugs within a tenant. Because the pre-check (`workspaceSlugTaken`) is a TOCTOU read, concurrent
creates with the same slug can both pass it; the constraint alone is guaranteed to reject the
loser. The handler SHALL catch the resulting `23505` error and return `409 WORKSPACE_SLUG_CONFLICT`
so the constraint acts as the definitive enforcement point.

The system SHALL additionally ensure that no raw Postgres SQLSTATE or other backend-specific error
code appears in the body of any `5xx` response; the central error handler SHALL substitute the
generic `CONTROL_PLANE_ERROR` code on unhandled 5xx paths (defense-in-depth).

#### Scenario: concurrent slug creates — loser returns 409, never 500

- **WHEN** two `POST /v1/tenants/{id}/workspaces` requests with the same slug are issued
  concurrently and one triggers a `23505` unique-constraint violation from `store.insertWorkspace`
- **THEN** exactly one request returns `201 Created` (the winner) and the other returns
  `409 Conflict` with error code `WORKSPACE_SLUG_CONFLICT` in the body — no `500` is returned and
  the string `23505` does not appear in any response body

#### Scenario: happy path workspace create is unaffected

- **WHEN** a `POST /v1/tenants/{id}/workspaces` request is issued with a slug that does not
  conflict with any existing workspace under that tenant
- **THEN** the response is `201 Created` and the workspace is persisted
