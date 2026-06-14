## 1. Pin version pair and stand up spike environment

- [x] 1.1 Pull `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` and confirm `shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` and `cron.database_name='postgres'` GUC are applied; record the exact image digest
- [x] 1.2 Pull `ghcr.io/ferretdb/ferretdb:2.7.0`; start it connected to the DocumentDB engine; confirm the MongoDB wire-protocol port (default 27017) accepts a `hello` command
- [x] 1.3 Confirm the engine-first startup order: start `postgres-documentdb`, then `ferretdb` gateway; document the exact startup sequence as the upgrade-order finding

## 2. Aggregation stage compatibility matrix

- [x] 2.1 Execute each allowed aggregation stage from `services/adapters/src/mongodb-data-api.mjs` against the live FerretDB instance: `$match`, `$project`, `$sort`, `$limit`, `$skip`, `$group`, `$unwind`, `$lookup` (<=1 stage), `$count`, `$facet` (<=4 pipelines), `$addFields`, `$set`, `$unset`, `$replaceRoot`, `$replaceWith`
- [x] 2.2 Classify each stage SUPPORTED / PARTIAL / UNSUPPORTED; for PARTIAL record the exact deviation from MongoDB 6.0+ semantics observed in the response
- [x] 2.3 Confirm blocked stages `$out`, `$merge`, `$geoNear` are rejected by FerretDB (expected UNSUPPORTED); record the wire error code returned
- [x] 2.4 Test `$group` with `$sum` and `$avg` over mixed numeric types; record whether results match MongoDB semantics

## 3. Index type compatibility matrix

- [x] 3.1 Create a single-field index; classify SUPPORTED / PARTIAL / UNSUPPORTED
- [x] 3.2 Create a compound index; classify
- [x] 3.3 Create a unique index; verify uniqueness enforcement on insert collision; classify
- [x] 3.4 Create a sparse index; verify documents missing the indexed field are excluded; classify
- [x] 3.5 Create a TTL index; verify expired documents are removed within the expected window; classify
- [x] 3.6 Confirm text indexes and geo indexes are UNSUPPORTED (already excluded from `mongodb-data-api.mjs`); record the wire error code

## 4. Transaction gap validation

- [x] 4.1 Issue `startTransaction` / `commitTransaction` against FerretDB 2.7; record whether the command is accepted or returns an error; classify multi-document transactions as SUPPORTED / PARTIAL / UNSUPPORTED
- [x] 4.2 Issue `startTransaction` / `abortTransaction`; record outcome; classify
- [x] 4.3 Assign a remediation path (shim to single-operation semantics / drop / re-architect) with a one-sentence rationale; flag the owner for the downstream child

## 5. Change-stream gap validation

- [x] 5.1 Call `collection.watch()` against FerretDB 2.7 with the `$match` pipeline used by `apps/control-plane/src/runtime/realtime-executor.mjs` (`fullDocument.tenantId`); record whether the command is accepted or returns an error
- [x] 5.2 Attempt to enable pre-images via `db.command({collMod, changeStreamPreAndPostImages:{enabled:true}})` as used by `realtime-executor.mjs`; record the outcome
- [x] 5.3 Attempt to open a change stream via the CDC bridge pattern (`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`); record the outcome
- [x] 5.4 Assign a remediation path (re-architect with Postgres logical replication / shim / drop) for each of: realtime-executor, CDC bridge; flag the owner for the downstream child; record whether a Postgres logical replication slot + pgoutput could substitute

## 6. Gap recommendations

- [x] 6.1 For every PARTIAL or UNSUPPORTED entry in the matrix, assign a use / shim / drop / re-architect recommendation with a one-sentence rationale
- [x] 6.2 Specifically resolve the change-stream gap for `realtime-executor.mjs` and `ChangeStreamWatcher.mjs` with a concrete remediation path; escalate if no viable shim exists at this version pair
- [x] 6.3 Specifically resolve the multi-document-transaction gap for `mongodb-data-api.mjs`'s transaction ops (snapshot/majority read concern); recommend shim or drop

## 7. Per-tenant DocumentDB database/role/auth tenancy spike

- [x] 7.1 Create a dedicated DocumentDB database for a test tenant in the running engine; confirm it is isolated from a second tenant's database (cross-database query is rejected)
- [x] 7.2 Create a per-tenant Postgres role with the minimum privileges required by FerretDB; confirm the FerretDB gateway can authenticate using that role's credentials
- [x] 7.3 Map the database naming convention and role creation pattern against the existing `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` applier model; record any DDL gaps or extension requirements
- [x] 7.4 Verify that enabling `pg_documentdb_core,pg_documentdb` extensions coexists with Falcone's schema-per-tenant relational schemas and the `falcone_app` non-BYPASSRLS role; record any conflict
- [x] 7.5 Record the exact database/role/auth mapping as a spike finding; confirm or correct the credential injection pattern for the downstream per-tenant provisioning change

## 8. Colocated vs dedicated Postgres decision

- [x] 8.1 Assess whether `shared_preload_libraries` requirements (`pg_cron,pg_documentdb_core,pg_documentdb`) can be satisfied on Falcone's existing in-chart Postgres (`charts/in-falcone/values.yaml` ~1694-1791) without conflicting with existing extensions
- [x] 8.2 Evaluate resource isolation: colocated (reuse existing Postgres, add DocumentDB extensions) vs dedicated (separate Postgres instance solely for DocumentDB); record a decision with rationale
- [x] 8.3 Document the chosen option in ADR-14's Decision section with a one-sentence rationale; record the rejected option and why

## 9. Author ADR-14

- [x] 9.1 Append `## ADR-14 — Migrate document store from MongoDB to FerretDB v2 + DocumentDB` to `docs-site/architecture/adrs.md` (the established location; ADR-13 was MinIO -> SeaweedFS)
- [x] 9.2 Decision section: state FerretDB 2.7.0 + DocumentDB 0.107 (Apache-2.0, LF governance) is selected; record the pinned version pair and upgrade order from task 1.3
- [x] 9.3 Why section: MongoDB SSPL licence misfit for open-source BaaS; FerretDB: Apache-2.0, MongoDB wire-protocol compatibility, Postgres storage leverage, AI-ready vector path via pgvector
- [x] 9.4 Evidence section: reference the aggregation matrix (task 2), index matrix (task 3), transaction gap (task 4), change-stream gap (task 5), tenancy spike (task 7), colocated-vs-dedicated decision (task 8)
- [x] 9.5 Risks section: change-stream gap (realtime + CDC blockers), multi-doc-transaction gap, aggregation stage divergence, version divergence (downstream changes pinned to spike version), colocated Postgres extension coupling
- [x] 9.6 Rejected alternatives section: Percona Server (SSPL), native-JSONB (not MongoDB-wire-compatible — existing drivers break), ArangoDB (BSL licence), RavenDB (AGPL), Couchbase (source-available) — each with one-sentence rejection rationale

## 10. Validate and finalize

- [x] 10.1 Run `openspec validate add-ferretdb-adr-spike --strict` from the project root and confirm it passes; fix any residual issues
- [x] 10.2 Confirm the compatibility matrix, tenancy spike findings, colocated-vs-dedicated decision, and gap remediation paths are referenced by or attached to this change so downstream children can consume them
