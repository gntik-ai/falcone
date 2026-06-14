## Context

Falcone's document-store layer reaches MongoDB through a single `MONGO_URI` environment
variable (`apps/control-plane/src/runtime/main.mjs`). All collection reads, writes,
queries, and aggregations flow through `apps/control-plane/src/runtime/mongo-data-executor.mjs`
and the plan builder in `services/adapters/src/mongodb-data-api.mjs`, which applies
per-tenant scoping via `applyTenantScopeToFilter` and `injectTenantIntoDocument` (default
tenant field `tenantId`). Routes are exposed at `/v1/collections/{name}/documents`,
`/v1/collections/{name}/query`, and `/v1/collections/{name}/search`
(`services/gateway-config/public-route-catalog.json`).

Two Falcone subsystems consume MongoDB change streams:

- `apps/control-plane/src/runtime/realtime-executor.mjs` — per-collection `watch()` with
  `$match` on `fullDocument.tenantId` and `fullDocumentBeforeChange.tenantId` (deletes),
  pre-images enabled via `db.command({collMod, changeStreamPreAndPostImages:{enabled:true}})`.
- `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` — change streams to Kafka;
  resume tokens stored in Postgres via `ResumeTokenStore`.

FerretDB v2 does not implement change streams or multi-document transactions
(`commit`/`abortTransaction`). These are confirmed blockers. The aggregation and index
set used by `mongodb-data-api.mjs` (allowed: `$match`, `$project`, `$sort`, `$limit`,
`$skip`, `$group`, `$unwind`, `$lookup` (<=1), `$count`, `$facet` (<=4), `$addFields`,
`$set`, `$unset`, `$replaceRoot`, `$replaceWith`; blocked: `$out`, `$merge`, `$geoNear`;
indexes: single, compound, unique, sparse, TTL) has not been validated against
FerretDB 2.7 / DocumentDB 0.107.

Falcone's existing Postgres tenancy model uses schema-per-tenant + RLS with a non-BYPASSRLS
`falcone_app` role (`services/adapters/src/tenant-rls-context.mjs::withTenantRlsContext`
sets `app.tenant_id` GUC). The decision to use real per-tenant DocumentDB databases and
roles is already made; the spike must pin the exact mapping mechanics.

## Goals / Non-Goals

**Goals:**

- Produce ADR-14 in the established format so the MongoDB -> FerretDB migration decision
  is on record with all five rejected alternatives.
- Run a version-pinned compatibility spike against
  `ghcr.io/ferretdb/ferretdb:2.7.0` / `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`
  covering every aggregation stage, index type, transaction call, and realtime operation
  Falcone uses.
- Explicitly classify the change-stream and multi-document-transaction gaps and assign
  each a remediation path (re-architect / shim / drop).
- Resolve the per-tenant DocumentDB database/role/auth mapping mechanics via a spike
  and record the colocated-vs-dedicated Postgres decision.
- Pin the version pair and upgrade order.

**Non-Goals:**

- Modifying any source code, Helm charts, or tests in this change.
- Implementing FerretDB deployment, per-tenant provisioning, realtime re-architecture,
  or CDC bridge remediation (those are separate downstream changes).
- Evaluating FerretDB for non-MongoDB workloads or vector-search paths.

## Decisions

### D1 — Run the spike against Docker-based FerretDB + DocumentDB at the pinned version pair

**Rationale**: Pinning `ghcr.io/ferretdb/ferretdb:2.7.0` and
`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` is the only way to
produce a reproducible compatibility matrix. Docker provides a controlled environment
without requiring changes to the kind test cluster. The version pair is the primary
deliverable anchor — all downstream changes are written against it.

**Alternatives considered**: Running against the kind test cluster (harder to pin and tear
down cleanly); evaluating against FerretDB HEAD (moving target, not reproducible).

### D2 — Start DocumentDB engine before FerretDB gateway (upgrade order)

**Rationale**: The `postgres-documentdb` extension must exist and be loadable before the
FerretDB gateway connects; starting in reverse order causes a startup failure. The spike
validates and records this order so it becomes the documented constraint for deployment
children.

**Alternatives considered**: Simultaneous start (fails due to extension dependency);
gateway-first (fails on first MongoDB wire-protocol handshake).

### D3 — Use real per-tenant DocumentDB databases and roles for tenant isolation

**Rationale**: The decision to use per-tenant DocumentDB databases (not per-collection
name-prefix scoping) is already made at the epic level. The spike resolves the exact
mechanics: database naming convention, role creation and grant pattern, authentication
credential injection, and whether these map onto or extend Falcone's existing
schema-per-tenant Postgres conventions (`charts/in-falcone/values.yaml` ~1694-1791;
`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`).

**Alternatives considered**: Collection-prefix scoping (rejected — insufficient isolation
guarantee, harder to revoke); shared database with `tenantId` field only (rejected —
relies solely on application-layer scoping with no DB-level isolation boundary).

### D4 — Classify every operation SUPPORTED / PARTIAL / UNSUPPORTED with evidence from the running instance

**Rationale**: Binary yes/no is insufficient — PARTIAL captures cases where FerretDB
accepts the wire command but produces results that diverge from MongoDB semantics in ways
that break `mongodb-data-api.mjs` consumers (e.g., `$facet` stage count limit, `$lookup`
pipeline sub-stages). Evidence must come from the running FerretDB 2.7 / DocumentDB 0.107
instance, not third-party blogs or FerretDB's own docs.

### D5 — Assign a remediation path to every gap before this change closes

**Rationale**: Leaving gaps without resolution owners blocks the downstream children
(GitHub issue #455 gates every other child of epic #454). Remediation paths are:
`use` (FerretDB native equivalent works), `shim` (thin adaptation in `mongodb-data-api.mjs`
or executor), `drop` (feature removed from Falcone's data-api capability), or
`re-architect` (structural change required — applies to change streams).

## Risks / Trade-offs

- **Change-stream gap blocks realtime + CDC** → `realtime-executor.mjs` and
  `ChangeStreamWatcher.mjs` are structurally dependent on `collection.watch()`. The spike
  assigns the remediation path (re-architect with an alternative event mechanism or drop
  the capability pending FerretDB roadmap). This is the highest-severity gap.

- **Multi-doc transaction gap** → `mongodb-data-api.mjs` declares transaction ops with
  `snapshot`/`majority` read concern; if FerretDB cannot honor these, consistency
  guarantees degrade. The spike assigns the remediation (shim to single-op or drop).

- **Aggregation stage divergence** → `$facet` (<=4 pipelines) and `$lookup` (<=1 stage)
  are already constrained in `mongodb-data-api.mjs`; FerretDB's implementation may be
  PARTIAL within those bounds. The spike validates the exact sub-set.

- **Version divergence** → Downstream changes are coded to the pinned version pair;
  upgrade paths must re-run the relevant matrix cells. Mitigation: record the version
  prominently in the spike output and in ADR-14's Evidence section.

- **Colocated DocumentDB on shared Postgres** → `shared_preload_libraries` must include
  `pg_documentdb_core,pg_documentdb` alongside `pg_cron`; this cannot be patched at
  session level. Mitigation: the colocated-vs-dedicated decision is explicitly resolved
  by the spike to avoid a late-breaking infrastructure change.

## Open Questions

1. Does `$group` with `$sum` / `$avg` produce results consistent with MongoDB semantics
   for mixed numeric types? (Answered by spike.)
2. Can a single DocumentDB-enabled Postgres instance host both Falcone's relational schemas
   (with RLS) and per-tenant document databases, or does the extension conflict with
   schema-per-tenant DDL? (Answered by spike.)
3. Is there a FerretDB-supported alternative to change streams (e.g., logical replication
   slot + pgoutput) that could preserve the CDC bridge contract? (Answered by spike;
   drives the `re-architect` vs `drop` decision.)
