## Why

After the MongoDB-to-FerretDB+DocumentDB migration (epic #454), internal documentation still references MongoDB as the document store and no authoritative two-layer architecture or operations runbook exists. Operators lack the topology, version-pinning constraints, upgrade-order rules, per-tenant tenancy mapping, change-stream remediation guidance, and compatibility-differences table needed to run the new backend safely in production. A licensing decision note (SSPL eliminated, Apache-2.0 + MIT adopted) must also be recorded. Corresponds to GitHub issue #465.

## What Changes

- Add a FerretDB+DocumentDB architecture and operations runbook document under `docs-site/architecture/` covering:
  - Two-layer design: FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) fronting DocumentDB engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
  - Version pinning: the gateway image and engine image form a matched pair; the engine version encodes the compatible gateway version (`ferretdb-2.7.0` suffix)
  - Upgrade order: DocumentDB engine MUST be upgraded before the FerretDB gateway; the gateway MUST NEVER be advanced ahead of a matching engine release
  - PostgreSQL extension requirements: `shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'`; `cron.database_name='postgres'`; DocumentDB GUCs
  - Verified tenancy model: a Mongo "database" is a logical namespace in one shared backing Postgres DB; app-layer `tenantId` scoping (`applyTenantScopeToFilter` / `injectTenantIntoDocument`) is the authoritative isolation boundary; RLS coexists as hardening; a per-tenant role does NOT provide isolation; hard isolation requires a dedicated DocumentDB instance per tenant tier
  - Deployment topology: dedicated Postgres instance (colocated rejected due to image / `shared_preload_libraries` coupling); engine-first startup; bundled extensions (pgvector 0.8.1, PostGIS 3.6.0, rum 1.3, pg_cron 1.6)
  - Change-stream remediation: FerretDB v2 does not support change streams; remediation direction is Postgres logical replication (pgoutput); owned by `add-ferretdb-realtime-cdc-remediation`; this doc cross-references that change
  - Known compatibility differences and remediations table: no multi-document transactions (idempotent single-document writes recommended); all 15 adapter-allowed aggregation stages supported; `$out`/`$merge` blocked by Falcone adapter allowlist (policy, not engine limitation); no change streams
  - A licensing-decision section: MongoDB SSPL eliminated; FerretDB (Apache-2.0) and DocumentDB extension (MIT) selected
- Update stale MongoDB references in `docs-site/` and any `README*` files that present MongoDB as the active document store, replacing them with FerretDB+DocumentDB equivalents
- Cross-link ADR-14 from the new runbook and from the ADR index

## Capabilities

### New Capabilities

- `document-store-docs`: Authoritative FerretDB+DocumentDB architecture documentation, operations runbook, upgrade-order rules, compatibility-differences table, and licensing rationale for the document-store capability

### Modified Capabilities

- `data-api`: Documentation-level requirement added — an authoritative architecture/ops doc MUST exist for the FerretDB+DocumentDB backend, MongoDB references MUST be retired from all repo documentation, and known compatibility differences MUST be documented with their remediations

## Impact

- `docs-site/architecture/` : new FerretDB+DocumentDB runbook document (e.g., `ferretdb.md`)
- `docs-site/architecture/adrs.md`: cross-link from ADR-14 entry to the new runbook
- `README.md` and any translated variants: MongoDB references replaced with FerretDB+DocumentDB
- No source code, Helm charts, tests, or API contracts are changed
- Depends on: `add-ferretdb-adr-spike` (ADR-14), `add-ferretdb-engine-deployment`, `add-ferretdb-gateway-deployment`, `add-ferretdb-tenant-credentials`, `add-ferretdb-realtime-cdc-remediation`
- Priority: P2 / label: documentation
