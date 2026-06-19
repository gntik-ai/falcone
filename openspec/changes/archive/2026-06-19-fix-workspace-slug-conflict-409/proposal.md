# fix-workspace-slug-conflict-409

## Change type
bugfix

## Capability
tenant-provisioning

## Priority
P2

## Why
Two concurrent `POST /v1/tenants/{id}/workspaces` requests carrying the same slug race past the
`workspaceSlugTaken` pre-check (a TOCTOU read) and both reach `store.insertWorkspace`. The
`(tenant_id, slug)` UNIQUE constraint correctly keeps exactly one row — but the losing request
propagated the raw Postgres unique-violation error (`SQLSTATE 23505`) up through the handler
unhandled, producing a `500 Internal Server Error` whose body exposed the backend SQLSTATE to the
caller. GitHub issue #634.

**Root cause (code-verified).**
`deploy/kind/control-plane/b-handlers.mjs::createWorkspace` called `store.insertWorkspace` with no
surrounding try/catch for unique-violation errors. The slug availability guard
(`workspaceSlugTaken`) is a plain `SELECT` before the `INSERT` — a classic TOCTOU gap: under
concurrency, both callers can read "not taken", proceed to insert, and one gets `23505` from
Postgres. Without a catch that maps `e.code === '23505'` to a structured `409`, that error
propagated to `deploy/kind/control-plane/server.mjs`'s central error handler, which at the time
did not redact backend-specific codes on 5xx responses, leaking `23505` in the response body.

Two separate defects are therefore fixed together as defense-in-depth:
1. **Handler-level**: `createWorkspace` now catches `e.code === '23505'` from `insertWorkspace` and
   returns `409 WORKSPACE_SLUG_CONFLICT` — the constraint becomes the definitive guard.
2. **Server-level**: the central error handler in `server.mjs` no longer surfaces a raw SQLSTATE on
   any 5xx response; a backend-specific error code such as `23505` is replaced with the generic
   `CONTROL_PLANE_ERROR`, so callers can never observe a Postgres internals string on an unhandled
   error path.

## What Changes
- `deploy/kind/control-plane/b-handlers.mjs::createWorkspace`: wrap `store.insertWorkspace` in
  try/catch; map `e.code === '23505'` to `409 WORKSPACE_SLUG_CONFLICT`; re-throw any other error
  so the central handler still processes it.
- `deploy/kind/control-plane/server.mjs` (central error handler): replace any backend-specific
  error code (e.g. a raw SQLSTATE) with the generic `CONTROL_PLANE_ERROR` on 5xx responses,
  preventing internals disclosure on any unhandled path.

## Impact
- The losing concurrent create returns `409 WORKSPACE_SLUG_CONFLICT` instead of `500`/`23505`.
- The body of any unhandled 5xx no longer contains a Postgres SQLSTATE or other backend-specific
  error code.
- The happy path (`POST /v1/tenants/{id}/workspaces` with a novel slug) is unaffected and still
  returns `201`.
- Affected specs: `tenant-provisioning`.
