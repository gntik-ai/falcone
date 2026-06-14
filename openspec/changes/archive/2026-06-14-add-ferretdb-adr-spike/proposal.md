## Why

Falcone's document store is backed by MongoDB (reached via `MONGO_URI` in
`apps/control-plane/src/runtime/main.mjs`). MongoDB's Server Side Public License
(SSPL) is a source-available copyleft licence incompatible with Falcone's open-source
BaaS model, and every tenant's collection reads, writes, queries, and realtime
subscriptions flow through MongoDB's proprietary wire protocol. FerretDB v2 with
DocumentDB 0.107 is the selected successor — it speaks the MongoDB wire protocol over
a PostgreSQL 17 storage engine, carrying an Apache-2.0 licence — but two hard blockers
have been confirmed in code: FerretDB v2 has no change-stream support (used by
`apps/control-plane/src/runtime/realtime-executor.mjs` and
`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`), and multi-document
transactions (`commit`/`abortTransaction`) are unimplemented. Neither the feature-level
compatibility of Falcone's full aggregation and index usage nor the mechanics of mapping
per-tenant FerretDB "databases" onto Falcone's existing schema-per-tenant + RLS model
has been validated. The migration cannot proceed safely without a recorded decision and
empirical de-risking of those gaps.

## What Changes

- ADR-14 is recorded in `docs-site/architecture/adrs.md` (the established location; ADR-13
  was MinIO -> SeaweedFS) with sections Decision / Why / Evidence / Risks, documenting
  the selection of FerretDB 2.7.0 + DocumentDB 0.107 (Apache-2.0, LF governance,
  MongoDB wire-protocol compatible, Postgres leverage, AI-ready vector path) and the
  rejection of: Percona Server (SSPL), native-JSONB (not wire-compatible with existing
  MongoDB drivers), ArangoDB (BSL licence), RavenDB (AGPL), and Couchbase
  (source-available).
- A per-feature compatibility matrix is produced, pinned to the version pair
  `ghcr.io/ferretdb/ferretdb:2.7.0` / `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`,
  covering every aggregation stage, index type, transaction mode, and realtime operation
  that Falcone's code uses (sourced from `services/adapters/src/mongodb-data-api.mjs`
  and the realtime/CDC executors), with each entry classified SUPPORTED / PARTIAL /
  UNSUPPORTED and a remediation path assigned (use / shim / drop / re-architect). The
  change-stream and multi-document-transaction gaps are explicitly flagged with their
  downstream owners.
- A tenancy spike resolves how a FerretDB "database" maps to an isolated DocumentDB
  backend given the decision to use real per-tenant databases and roles; the exact
  database/role/auth mapping is pinned, and the colocated-vs-dedicated Postgres decision
  (factoring `shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` and
  resource isolation) is recorded.
- The version pair and upgrade order (engine `postgres-documentdb` first, then FerretDB
  gateway) are documented.
- No source code, Helm charts, or tests are modified; this change produces only the ADR
  and spike findings.

## Capabilities

### New Capabilities

<!-- none: all outcomes land in the existing data-api capability -->

### Modified Capabilities

- `data-api`: ADDED requirements capturing the guaranteed outcomes of this spike —
  ADR-14 recorded with all five rejected alternatives, a version-pinned compatibility
  matrix covering aggregation / index / transaction / realtime usage with gap remediation
  paths, the change-stream and multi-doc-transaction gaps explicitly resolved, and the
  per-tenant DocumentDB database/role/auth mapping and colocated-vs-dedicated Postgres
  decision recorded.

## Impact

- **`docs-site/architecture/adrs.md`**: ADR-14 appended (spike deliverable, not a
  source-code change).
- **`services/adapters/src/mongodb-data-api.mjs`**: not modified here; the spike
  validates the aggregation stages, index types, and transaction calls this module
  constructs against the live FerretDB/DocumentDB versions.
- **`apps/control-plane/src/runtime/realtime-executor.mjs`**: change-stream gap
  surfaced here; remediation path (re-architect or shim) is assigned by this spike and
  consumed by a downstream child.
- **`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`**: CDC change-stream gap
  surfaced here; remediation path assigned by this spike.
- **`apps/control-plane/src/runtime/main.mjs`**: `MONGO_URI` -> FerretDB DSN swap is
  out of scope; the spike validates the connection semantics.
- **Blocked downstream changes** (consume this spike's findings): FerretDB deployment
  manifests, per-tenant database/role provisioning, realtime-executor re-architecture,
  CDC bridge remediation, and chart migration.
