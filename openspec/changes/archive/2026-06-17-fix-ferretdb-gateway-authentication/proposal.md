# fix-ferretdb-gateway-authentication

## Change type
bug-fix

## Capability
document-store (cap-mongo-data-api)

## Priority
P1

## Why (Problem Statement)
Neither the control-plane nor a direct Mongo driver can authenticate to the
FerretDB gateway. All `/v1/mongo/*` browse and data operations return 500, and
document-DB provisioning returns 400.

**Evidence (live campaign 2026-06-17):**
- `GET /v1/mongo/databases` → 500
- insert/list documents → 500 `CONTROL_PLANE_ERROR`
- control-plane log: `MongoServerError … HandshakeError`
- direct `mongosh` with documentdb credentials → `Authentication failed`
- The control-plane's `MONGO_USER=falcone` + documentdb password is not a valid
  identity on the FerretDB gateway (B.1, F2 in the campaign report).

Also blocks: `POST /v1/workspaces/{w}/databases {engine:mongodb}` → 400 (B.2/F5,
same root cause — folded into this change).

## What Changes

1. **Reconcile FerretDB auth model** — configure the FerretDB gateway to accept
   the `falcone` principal mapped to the documentdb role, *or* repoint
   `MONGO_USER`/`MONGO_PASSWORD` (and the FerretDB `postgresql-url`) to a coherent
   identity that both sides agree on.
2. **Startup readiness probe** — add a probe/init-check that fails closed on an auth
   error rather than allowing the service to start in a broken state.
3. **Real-stack test** — add a test in `tests/env` that validates the
   insert+list document round-trip via the FerretDB gateway.
4. **B.2 folded** — once auth is fixed, verify that
   `POST /v1/workspaces/{w}/databases {engine:mongodb}` returns 2xx.

## Impact
- **Functional:** restores the entire Mongo/document-store data-API surface
  (`/v1/mongo/*`) and Mongo database provisioning.
- **Downstream:** also unblocks cap-realtime Mongo SSE and cap-change-data-capture
  paths that depend on a healthy FerretDB.
- **Breaking change:** none — the routes already exist; this makes them functional.
- **Dependencies:** DocumentDB (PostgreSQL + extension) must be running and healthy.
