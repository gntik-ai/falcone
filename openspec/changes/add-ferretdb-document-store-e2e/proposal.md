## Why

No Playwright E2E specs exist today for document CRUD, query, aggregation, or
per-tenant isolation against the document store. The ADR-14 spike (merged;
FerretDB 2.7.0 / postgres-documentdb:17-0.107.0-ferretdb-2.7.0) established
the live compatibility matrix for the two-layer stack. That spike surfaced two
hard constraints that invalidate the earlier E2E scope:

1. **Mongo change-stream realtime is unsupported on FerretDB.** The realtime
   executor (`apps/control-plane/src/runtime/realtime-executor.mjs:66`) calls
   `collection.watch(...)` and `collMod changeStreamPreAndPostImages` — both
   return `CommandNotSupported(115)` / `UnknownBsonField(40415)` on FerretDB.
   All existing `tests/e2e/realtime/` specs exercise this Mongo change-stream
   path and WILL NOT pass against a FerretDB backend until the pgoutput CDC
   remediation (`add-ferretdb-realtime-cdc-remediation`) lands. Declaring them
   "SHALL pass" in this change would be incorrect.

2. **There is no `/v1/collections/{name}/indexes` route.** The route catalog
   (`services/gateway-config/public-route-catalog.json`) exposes only
   `/v1/collections/{name}/vector-indexes` (POST + DELETE). Any spec that
   exercises `PUT /v1/collections/{name}/indexes` would target a non-existent
   surface.

This change authors the document-store E2E specs with a corrected scope:
aggregation stages confirmed supported by the spike are asserted affirmatively;
vector-index creation is tested via the wired route; the Mongo change-stream
realtime path is explicitly out of scope (tracked on
`add-ferretdb-realtime-cdc-remediation`); multi-doc transactions are asserted
to return the deterministic unsupported error; and cross-tenant isolation is
validated through the data API (app-layer tenantId scoping is authoritative).

## What Changes

- Add Playwright E2E specs under
  `tests/e2e/specs/issues/add-ferretdb-document-store-e2e.spec.ts` (per-issue
  runner entry point) and companion spec files under
  `tests/e2e/specs/document-store/` covering document CRUD, list, query,
  aggregation (adapter-allowed stages, `$out`/`$merge` blocked, cross-DB
  `$lookup` rejected), vector-index creation/deletion, transaction unsupported
  error, auth rejection, and cross-tenant isolation probe (A/B tenants).
- Scope the Mongo change-stream realtime path (`tests/e2e/realtime/`) as an
  explicit known failure on FerretDB; those specs are NOT run as part of this
  change and carry a documented out-of-scope note.
- Extend `tests/e2e/stack.sh up` to deploy the FerretDB + DocumentDB two-layer
  stack with ENGINE-FIRST readiness ordering (DocumentDB engine Ready before
  FerretDB gateway) into the ephemeral namespace; teardown trap preserved
  unchanged.
- Provide a per-issue runner path:
  `bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e`.

## Capabilities

### New Capabilities

_(none — specs fall under the existing `data-api` capability)_

### Modified Capabilities

- `data-api`: ADDED real-stack E2E requirements — a Playwright suite covering
  document CRUD, query, adapter-allowed aggregation stages, vector-index
  management via `/v1/collections/{name}/vector-indexes`, transaction
  unsupported error assertion, auth rejection, and cross-tenant isolation
  (A/B API-level probes). Mongo change-stream realtime path explicitly scoped
  out pending `add-ferretdb-realtime-cdc-remediation`. ENGINE-FIRST readiness
  ordering enforced in `stack.sh`.

## Impact

- `tests/e2e/specs/issues/add-ferretdb-document-store-e2e.spec.ts` — new
  Playwright entry-point spec.
- `tests/e2e/specs/document-store/` — new directory with per-operation specs
  and cross-tenant isolation probe.
- `tests/e2e/helpers/document-store/` — new helpers: tenant-fixtures re-export,
  typed API client for document-store routes, live-gate probe function.
- `tests/e2e/stack.sh` — FerretDB + DocumentDB wiring with ENGINE-FIRST
  readiness ordering (conditional, additive; existing path unchanged).
- `openspec/changes/add-ferretdb-document-store-e2e/specs/data-api/spec.md` —
  ADDED requirements delta.
- Depends on: `add-ferretdb-gateway` (FerretDB gateway Helm chart),
  `add-ferretdb-documentdb-engine` (DocumentDB backend),
  `add-ferretdb-data-access-cutover` (MONGO_URI repoint).
- Explicitly does NOT depend on `add-ferretdb-realtime-cdc-remediation` — that
  change resolves the out-of-scope Mongo change-stream failure.
- GitHub issue: #464. Epic: #454.
- Labels: `e2e`, `tenant-isolation`, priority `P2`.
