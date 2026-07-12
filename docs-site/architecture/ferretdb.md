# FerretDB + DocumentDB Document-Store Runbook (Architecture & Operations)

Authoritative architecture and operations reference for Falcone's document store, **FerretDB v2
over a PostgreSQL + DocumentDB engine**. For the decision record see
[ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb);
for cutover and rollback procedures see the migration runbooks linked under
[Day-2 Operations](#day-2-operations).

> **Migration status.** FerretDB + DocumentDB is the document store (ADR-14, epic #454),
> deployed by the umbrella chart's `documentdb` and `ferretdb` sub-charts and enabled by default.
> The migration off the bundled **MongoDB** server is **complete**: that component has been
> removed from the chart and the cutover/rollback window is closed. The MongoDB driver, wire
> protocol and Mongo-style data API are unchanged — clients still connect via `MONGO_URI`. The
> migration runbooks below remain as the historical record of the MongoDB → FerretDB cutover.

## Overview

The document store is a **two-layer** stack that preserves the MongoDB wire protocol while
replacing the storage engine:

1. **FerretDB gateway** (`ghcr.io/ferretdb/ferretdb:2.7.0`) — a stateless process that speaks the
   MongoDB wire protocol (reports `maxWireVersion:21` / MongoDB 7.0 wire level) and translates it
   to SQL against the engine below. Falcone's existing MongoDB driver, the data-API executor
   (`apps/control-plane-executor/src/runtime/mongo-data-executor.mjs`), and the adapter plan builder
   (`packages/adapters/src/mongodb-data-api.mjs`) connect to it unchanged via `MONGO_URI`.
2. **DocumentDB engine** (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) — a
   PostgreSQL 17 instance with the `pg_documentdb` / `pg_documentdb_core` extensions, storing each
   logical document as a row in the `documentdb_data` schema.

Both layers are **ClusterIP only** — there is no tenant-facing exposure; tenant document traffic
reaches the gateway through Falcone's data plane, never directly. Source:
`../falcone-charts/charts/in-falcone/values.yaml` (`documentdb:` / `ferretdb:` stanzas) and
`tests/env/docker-compose.yml` (the validated dev equivalent).

## Two-Layer Design

| Layer | Image | Workload | Replicas | Wire/SQL port | Debug/health | Service (ClusterIP) |
|-------|-------|----------|----------|---------------|--------------|---------------------|
| **FerretDB gateway** | `ghcr.io/ferretdb/ferretdb:2.7.0` | Deployment | 2 | 27017 (MongoDB wire) | 8088 (`/debug/livez`, `/debug/readyz`) | `<release>-ferretdb` |
| **DocumentDB engine** | `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` | StatefulSet | 1 | 5432 (PostgreSQL) | `pg_isready` | `<release>-documentdb` |

Communication path: data plane → `MONGO_URI` (`mongodb://…@<release>-ferretdb:27017/`) → gateway →
`FERRETDB_POSTGRESQL_URL` (`postgres://…@<release>-documentdb:5432/postgres`) → engine. The gateway
is **stateless** (it can scale horizontally; the chart runs 2 replicas); all durable state lives in
the engine's PostgreSQL volume.

- **Gateway readiness** is gated on backend connectivity: the kubelet probes `GET /debug/readyz` on
  `:8088`, which returns 200 only once the DocumentDB connection is established (NOT `/debug/healthz`,
  which 200s from the debug index without checking the backend). The `:8088` server is bound on all
  interfaces via `FERRETDB_DEBUG_ADDR=:8088`. Source: `../falcone-charts/charts/in-falcone/values.yaml` (`ferretdb.readinessProbe`).
- The dev/test equivalent (`tests/env/docker-compose.yml`) maps the gateway to host port **57017**;
  the in-cluster wire port is **27017**.

## Deployment Topology

The DocumentDB engine runs in a **dedicated** PostgreSQL instance — it is NOT colocated on Falcone's
relational `bitnami/postgresql` tier. The colocated topology was **evaluated and rejected** (ADR-14):
`pg_documentdb_core` / `pg_documentdb` ship only in the `postgres-documentdb` image and require
`shared_preload_libraries` (a server-start setting that cannot be patched per session), so colocation
would force replacing the relational Postgres image for every tenant's RLS schemas.

- **Engine-first startup is mandatory** — start (and make Ready) the DocumentDB engine **before** the
  FerretDB gateway. The `pg_documentdb` libraries are preloaded via `shared_preload_libraries` and the
  `documentdb_api` schema must exist before the gateway's first wire handshake; gateway-first fails.
  In the chart this is enforced by the gateway's `readyz` probe (it cannot become Ready until the
  backend answers); in Docker Compose by `depends_on: documentdb (service_healthy)`.
- **RLS coexists cleanly.** Falcone's schema-per-tenant RLS (non-`BYPASSRLS` `falcone_app` role +
  `app.tenant_id` GUC) runs on the same instance as the DocumentDB extensions with no DDL conflict
  (verified in the ADR-14 spike).
- **Bundled extensions** (engine image): **pgvector 0.8.1** (in-place vector search for tenant
  documents), **PostGIS 3.6.0**, **rum 1.3**, **pg_cron 1.6**.
- **PVC**: the engine StatefulSet uses a 20Gi data volume by default (`documentdb.persistence.size`);
  the gateway is stateless (no PVC). The engine PVC is the durable document store and is the **rollback
  anchor's counterpart** — see the [rollback runbook](#day-2-operations).

## Pinned Image Pair and Upgrade Order

The gateway and engine images form a **matched pair** — the engine tag encodes the compatible gateway
version via its `-ferretdb-2.7.0` suffix:

| Layer | Pinned tag | Digest |
|-------|------------|--------|
| FerretDB gateway | `ghcr.io/ferretdb/ferretdb:2.7.0` | `sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985` |
| DocumentDB engine | `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` | `sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7` |

> **Upgrade rule (first-class — do not bury this in prose):** upgrade the **DocumentDB engine before**
> advancing the FerretDB gateway, and **never advance the gateway ahead of a matching engine release**.
> Verify compatibility by reading the engine tag suffix (`…-ferretdb-<X.Y.Z>`) and confirming it equals
> the gateway tag (`<X.Y.Z>`). Every downstream change is coded to **2.7.0 / 0.107**; any upgrade must
> re-run the ADR-14 compatibility matrix (aggregation, indexes, transactions, change streams) before
> adoption. Source: `../falcone-charts/charts/in-falcone/values.yaml` (both image stanzas, pinned by tag + digest).

## PostgreSQL Extension Prerequisites

The engine requires these server-start settings (set on the Postgres command line so they are active
on the first-init temp server too; a `conf.d` include does NOT work because the init temp server does
not read it):

```
shared_preload_libraries = pg_cron,pg_documentdb_core,pg_documentdb
cron.database_name        = postgres
wal_level                 = logical
```

- `shared_preload_libraries` cannot be changed per session — it is the exact reason a **dedicated**
  instance is required (see [Deployment Topology](#deployment-topology)).
- `cron.database_name=postgres` binds pg_cron to the `postgres` database. **The `documentdb` extension
  MUST be created in the `postgres` database** (not Falcone's `in_falcone` DB): `pg_documentdb` cascades
  `pg_cron`, which is bound to `postgres`, so `CREATE EXTENSION documentdb` elsewhere fails with "can
  only create extension in database postgres". `FERRETDB_POSTGRESQL_URL`, the engine init Job, and the
  gateway engine-gate all target `postgres`.
- `wal_level=logical` is required for the realtime/CDC pipeline (see
  [Change-Stream Remediation](#change-stream-remediation)) — `pg_create_logical_replication_slot` fails
  on the default `replica`.
- The engine image has **no server TLS** in dev; the gateway connects with `sslmode=disable`.

Source: `../falcone-charts/charts/in-falcone/values.yaml` (`documentdb.config.inline`) and
`../falcone-charts/charts/in-falcone/templates/documentdb-configmap.yaml`.

## Tenancy Model

> **The app-layer `tenantId` filter is the authoritative isolation boundary. A per-tenant DocumentDB
> role is NOT an isolation boundary.**

- A Mongo "database" is a **logical namespace inside one shared backing Postgres DB** (`documentdb_data`,
  keyed by database/collection) — NOT a database-per-tenant. Tenants coexist in shared collections,
  distinguished by a `tenantId` field on every document.
- **Authoritative isolation** is enforced in `packages/adapters/src/mongodb-data-api.mjs`:
  `applyTenantScopeToFilter` injects the verified `tenantId` predicate into every read filter, and
  `injectTenantIntoDocument` stamps it onto every write (a forged `tenantId` in a payload or filter is
  rejected with HTTP 403). A forgotten filter cannot cross tenants and a write cannot forge another
  tenant. Mongo has no RLS / `SET ROLE` — **the filter is the guard**.
- **Per-database role scoping does NOT isolate.** DocumentDB 0.107 does not enforce per-database role
  scoping: a credential scoped to one tenant's namespace can read another tenant's data at the backend
  layer (live-verified by the [migration-validation](#day-2-operations) isolation-gap probe, #462). The
  go/no-go gate does **not** assume a backend security boundary exists. Note: `apps/control-plane-executor/src/
  postgres-applier.mjs` manages schemas/tables/views/extensions/grants only — it provisions **no**
  per-tenant DocumentDB identity.
- **RLS coexists as hardening**, not as the document-store isolation boundary (RLS protects the
  relational tenant schemas on the engine instance).
- **Hard DB-level isolation** (if ever required for a tenant tier) needs a **dedicated DocumentDB
  instance per tier**, not a per-tenant role on the shared instance.

See [ADR-1](/architecture/adrs#adr-1-shared-database-with-row-level-security-for-tenant-isolation)
and [Security & Auth](/architecture/security) for the broader isolation model.

## Known Compatibility Differences

All entries below are **live-verified** on the pinned `2.7.0` / `17-0.107.0-ferretdb-2.7.0` pair
(ADR-14 spike + the migration-validation gate, #462). Codes are exact MongoDB wire error codes.

| Area | Behaviour on FerretDB v2 | Remediation / mitigation | Owner |
|------|--------------------------|--------------------------|-------|
| **Change streams** | UNSUPPORTED. `collection.watch()` → `CommandNotSupported (115)`; `collMod changeStreamPreAndPostImages` → `UnknownBsonField (40415)` | Re-architected onto a Postgres **pgoutput** logical-replication slot on `documentdb_data` (`REPLICA IDENTITY FULL` for delete pre-images) | `add-ferretdb-realtime-cdc-remediation` (#460) |
| **Multi-document transactions** | UNSUPPORTED. `commitTransaction` → `CommandNotFound (59)` and the in-flight write **persists non-atomically**; `abortTransaction` is a **silent no-op (no rollback)** | Use **idempotent single-document writes** (`replaceOne({_id}, …, {upsert:true})`); the data-API rejects multi-doc transaction ops at the boundary (HTTP 501) | `add-ferretdb-data-access-cutover` (#459) |
| **Aggregation stages** | All **15 adapter-allowed** stages are SUPPORTED (`$match`/`$project`/`$sort`/`$limit`/`$skip`/`$group`/`$unwind`/`$lookup`/`$count`/`$facet`/`$addFields`/`$set`/`$unset`/`$replaceRoot`/`$replaceWith`); `$group` `$sum`/`$avg` over mixed int+double is exact | — (no shim needed) | — |
| **`$out` / `$merge` / `$geoNear`** | Engine-**functional**, but **blocked by Falcone's adapter allowlist** (`AGGREGATION_BLOCKED_STAGES`) — a **policy** decision, not an engine limitation | Documented as policy; do not misattribute to FerretDB | adapter policy |
| **Cross-database `$lookup`** | REJECTED by the engine with `Location40321` | Assert the exact code; same-namespace `$lookup` (≤1 join) is supported | — |
| **Indexes** | All five types SUPPORTED: single, compound, unique (duplicate → `E11000`), sparse, TTL (purged ~45s). pgvector 0.8.1 powers vector indexes via `/v1/collections/{name}/vector-indexes` | — | — |

## Change-Stream Remediation

FerretDB v2 has **no MongoDB change streams** (see the table above). Realtime SSE and the Kafka CDC
bridge are therefore re-architected onto **Postgres logical replication**: a `pgoutput` slot on the
DocumentDB engine's `documentdb_data` tables, with `REPLICA IDENTITY FULL` providing delete
pre-images and **consumer-side `tenantId` filtering** (the structural equivalent of the old
change-stream `$match`). A WAL `UPDATE` surfaces as `operationType: 'replace'` (logical replication
carries the full new image, not a `$set` diff). `wal_level=logical` (see
[PostgreSQL Extension Prerequisites](#postgresql-extension-prerequisites)) is the enabling GUC. The
full design and implementation are owned by **`add-ferretdb-realtime-cdc-remediation` (#460)**;
`apps/control-plane-executor/src/runtime/realtime-executor.mjs` and
`packages/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` consume the slot (they no longer call
`collection.watch()`).

## Observability

- **FerretDB gateway** exposes its debug/health and Prometheus-format metrics on `:8088`
  (`FERRETDB_DEBUG_ADDR=:8088`): `/debug/livez`, `/debug/readyz`, `/debug/metrics`. Readiness
  (`/debug/readyz`) is backend-gated and is the signal to slice gateway availability on.
- **DocumentDB engine** is a PostgreSQL 17 instance — scrape it with the standard Postgres exporter
  patterns; `pg_isready` is the liveness signal used by the chart/compose health gates.
- **Log label scheme** (mirrors the chart's component wrapper): `app.kubernetes.io/name=ferretdb` /
  `documentdb`, `app.kubernetes.io/instance=<release>` — slice logs/metrics by component with these.
- **ServiceMonitors / alert rules.** *TODO — no FerretDB/DocumentDB-specific `ServiceMonitor` or alert
  rules are authored in the chart yet (OQ2).* Until then, rely on the gateway `readyz` probe, the
  engine `pg_isready` gate, and the rollout gating in `helm upgrade --install`. Per-layer saturation
  alerts (engine WAL/replication-slot lag, gateway error rate, connection saturation) should be added
  when the monitoring stack is enabled in a target environment — WAL/slot lag is especially relevant
  because the realtime/CDC pipeline consumes a logical replication slot.

## Day-2 Operations

**Core service contract.** FerretDB + DocumentDB are always rendered by the umbrella chart and cannot
be disabled with `ferretdb.enabled=false`, `documentdb.enabled=false`, or zero-replica overrides. They
are the sole document store; the former `mongodb` server component has been removed. The cutover and
rollback runbooks below remain as the historical migration record.

**Health checks.** `helm upgrade --install` gates on rollout completion; after install:

```bash
kubectl -n <ns> rollout status statefulset/<release>-documentdb --timeout=300s   # engine FIRST
kubectl -n <ns> rollout status deployment/<release>-ferretdb --timeout=120s      # then gateway
kubectl -n <ns> get pods -l app.kubernetes.io/name=ferretdb
```

Per-layer probes: engine `pg_isready -d postgres` (5432), gateway `GET /debug/readyz` (8088).

**Migration, validation, cutover, and rollback** are owned by dedicated runbooks and tooling
(cross-referenced, not duplicated, to avoid drift):

- **Cutover / data migration** — [`tools/migration/ferretdb/RUNBOOK.md`](../../tools/migration/ferretdb/RUNBOOK.md):
  ordered, write-freeze cutover (initial bulk copy → delta convergence → integrity verify → re-point
  `MONGO_URI` → resume). All applies are idempotent `replaceOne({_id}, …, {upsert:true})`; no oplog
  replay (unsupported on FerretDB). Owned by `add-ferretdb-data-migration-runbook` (#461).
- **Migration validation (go/no-go gate)** — `tests/env/validation/run-ferretdb-validation.sh`:
  document-parity checker + per-tenant data-API smoke covering the risk areas above. Owned by
  `add-ferretdb-migration-validation` (#462).
- **Rollback / decommission** — [`tools/migration/ferretdb/ROLLBACK-RUNBOOK.md`](../../tools/migration/ferretdb/ROLLBACK-RUNBOOK.md):
  the read-only MongoDB retention window (rollback anchor), the two-plane rollback (data-API
  `MONGO_URI` re-point vs realtime **pre-#460 image redeploy** — a `MONGO_URI` re-point alone does not
  restore realtime), best-effort `_id`-UPSERT delta-back, point-of-no-return, and a non-prod gate.
  Owned by `add-ferretdb-rollback-plan` (#463).
- **Real-stack E2E** — `tests/e2e/specs/document-store/` (run with `E2E_FERRETDB=true`): Playwright
  CRUD/query/aggregation/vector-index/auth/cross-tenant coverage. Owned by
  `add-ferretdb-document-store-e2e` (#464).

The MongoDB StatefulSet + PVC are retained during the rollback window, so a `MONGO_URI`-based
rollback never destroys document data until the PVC is deliberately reclaimed (the point-of-no-return).

## Licensing

FerretDB is **Apache-2.0** (Linux Foundation governance) and the DocumentDB extension is **MIT** — no
commercial-licence risk for the self-hosted install. ADR-14 selected the pair specifically to retire
**MongoDB's SSPL** exposure for a BaaS that re-exposes the document-store wire protocol directly to
tenants.

- **MongoDB (SSPL)** — *eliminated.* The Server Side Public License is a source-available copyleft
  whose "offer-as-a-service" clauses are a legal misfit for an open-source BaaS that exposes MongoDB's
  functionality as a service. FerretDB preserves the MongoDB driver/wire contract Falcone's clients
  already use while removing the licence risk.
- **Percona Server for MongoDB** — *rejected:* also SSPL (swapping vendors does not change the licence).
- **Native PostgreSQL JSONB** — *rejected:* drops the MongoDB wire protocol (a client rewrite, not a migration).
- **ArangoDB (BSL)**, **RavenDB (AGPLv3)**, **Couchbase (source-available)** — *rejected* on licence
  and/or wire-compatibility grounds.

Full rationale and the rejected alternatives are recorded in
[ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb).
