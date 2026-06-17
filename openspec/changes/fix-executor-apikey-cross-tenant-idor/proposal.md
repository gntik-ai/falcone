# fix-executor-apikey-cross-tenant-idor

## Change type
bug-fix

## Capability
tenant-isolation / access-control (cap-external-apps-service-accounts)

## Priority
P0

## Why (Problem Statement)
The executor's `POST /v1/workspaces/{workspaceId}/api-keys` route issues an API key
without verifying that `{workspaceId}` belongs to the authenticated caller's tenant.
A tenant-A owner can mint an API key scoped to a tenant-B workspace and then use that
key to reach tenant-B's data-plane — a confirmed cross-tenant IDOR.

**Verified reproduction (live campaign 2026-06-17):**
1. `acme-ops` (JWT `tenant_id=<acme>`) → `POST /v1/workspaces/<GLOBEX_workspace>/api-keys` → **201** (key returned).
2. Acme-minted key → `GET /v1/postgres/workspaces/<GLOBEX_workspace>/data/postgres/schemas/public/tables/x/rows` → **404 TABLE_NOT_FOUND** (authorised into globex's database, not denied).
3. Acme's *own* API key against globex workspace → **403** (correctly denied, per-key scoping works).

The issuance route does not re-derive the workspace's owning tenant and compare it to
the verified caller's `tenant_id` before issuing the key.

## What Changes

1. **Workspace ownership check** — in the executor's api-key issuance handler, resolve
   the owning tenant of `{workspaceId}` (via the control-plane or the executor's
   local workspace store) and reject with **403 `CROSS_TENANT_VIOLATION`** when it
   differs from the caller's verified `tenant_id`.
2. **Consistent guard** — audit all other admin routes that accept a `{workspaceId}`
   path parameter and apply the same ownership check where missing.
3. **Black-box test** — add a test that mints a key in the caller's own workspace (201)
   and a key in a foreign-tenant workspace (403); add the cross-tenant probe to the
   E2E isolation fixture.

## Impact
- **Security:** closes a confirmed P0 IDOR that allows cross-tenant data exposure.
- **Breaking change:** none (only previously-incorrect 201 responses become 403).
- **Dependencies:** none — the workspace→tenant mapping is already available in the
  data layer used by the executor.
