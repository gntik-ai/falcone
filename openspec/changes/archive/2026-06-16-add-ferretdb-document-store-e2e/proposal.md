## Why

No Playwright E2E specs exist today for document CRUD, query, aggregation, or
per-tenant isolation against the document store. The ADR-14 spike (merged;
FerretDB 2.7.0 / postgres-documentdb:17-0.107.0-ferretdb-2.7.0) established
the live compatibility matrix for the two-layer stack. That spike surfaced two
hard constraints that invalidate the earlier E2E scope:

1. **Realtime/CDC is a separate, pgoutput-based suite (already remediated).**
   `add-ferretdb-realtime-cdc-remediation` (#460, MERGED) replaced the Mongo
   change-stream path: `apps/control-plane/src/runtime/realtime-executor.mjs` no
   longer calls `collection.watch()` — it owns a pgoutput logical-replication slot
   on the DocumentDB engine (`WalReplicationClient`). The realtime E2E specs
   (`tests/e2e/realtime/`) are now pgoutput-based and owned by #460. They are a
   SEPARATE suite and out of scope for this document-store change, which neither
   runs nor modifies them. (Mongo change streams were only ever unsupported on
   FerretDB — `CommandNotSupported(115)` / `UnknownBsonField(40415)` — which is
   exactly why #460 removed that path; declaring those specs in this change would
   conflate two suites.)

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
- Scope the realtime suite (`tests/e2e/realtime/`, now pgoutput-based, owned by
  #460) as out of scope; those specs are NOT run or modified by this change and
  carry a documented out-of-scope note.
- Reuse the existing FerretDB E2E wiring in `tests/e2e/stack.sh up`
  (`E2E_FERRETDB=true` enables the `documentdb` + `ferretdb` sub-charts of the
  in-falcone chart with the FerretDB values overlay; ENGINE-FIRST is enforced by
  the chart's DocumentDB readiness and the existing `healthy()` gate), adding only
  the two FerretDB image pre-pulls and confirming teardown coverage; the existing
  path and teardown trap are preserved unchanged.
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
- `tests/e2e/stack.sh` — reuse the existing `E2E_FERRETDB=true` FerretDB +
  DocumentDB wiring (additive image pre-pull + comments; existing path unchanged).
- `openspec/changes/add-ferretdb-document-store-e2e/specs/data-api/spec.md` —
  ADDED requirements delta.
- Depends on: `add-ferretdb-gateway` (FerretDB gateway Helm chart),
  `add-ferretdb-documentdb-engine` (DocumentDB backend),
  `add-ferretdb-data-access-cutover` (MONGO_URI repoint).
- Does NOT depend on `add-ferretdb-realtime-cdc-remediation` (#460, MERGED) — that
  change re-architected realtime onto pgoutput; its E2E suite (`tests/e2e/realtime/`)
  is separate and out of scope here.
- GitHub issue: #464. Epic: #454.
- Labels: `e2e`, `tenant-isolation`, priority `P2`.
