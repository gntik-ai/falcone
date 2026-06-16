## 1. Prerequisites and Scope Discovery

- [x] 1.1 Confirm that `add-ferretdb-engine-deployment` design.md is merged or stable enough to extract the final DocumentDB engine topology, PostgreSQL extension prerequisites (`shared_preload_libraries`, GUCs), and per-tenant database/role model
- [x] 1.2 Confirm that `add-ferretdb-gateway-deployment` design.md is merged or stable enough to extract the FerretDB gateway configuration, port assignments, and connection parameters
- [x] 1.3 Confirm that `add-ferretdb-tenant-credentials` design.md is merged or stable enough to extract per-tenant credential provisioning details; note that the ADR-14 spike has established the verified tenancy model (shared backing Postgres DB, app-layer scoping authoritative, per-tenant role does NOT provide isolation)
- [x] 1.4 Confirm that `add-ferretdb-realtime-cdc-remediation` has a canonical path for cross-reference (change-stream remediation owned there)
- [x] 1.5 Resolve design open question OQ1: determine whether `docs-site/architecture/` or another location is the settled canonical docs location
- [x] 1.6 Run `grep -r -i "mongodb\|mongo" docs/ docs-site/ README* --include="*.md" -l` to list all files containing MongoDB references and scope the retirement surface area
- [x] 1.7 Run `find docs/ docs-site/ -name "*.xml" -o -name "*.drawio" -o -name "*.puml" -o -name "*.mmd" -o -name "*.d2"` to identify any diagram source format and path

## 2. Retire MongoDB References

- [x] 2.1 Update `README.md`: replace MongoDB with FerretDB+DocumentDB in any section describing the document store or storage backend (architecture overview, component list, diagram caption)
- [x] 2.2 Update the architecture diagram source file (identified in 1.7): relabel any MongoDB node as FerretDB+DocumentDB and regenerate any derived image if applicable
- [x] 2.3 Update any other docs files identified in 1.6 that present MongoDB as the current document store; historical mentions within ADR-14 or comparison notes may remain
- [x] 2.4 Verify: re-run the grep from 1.6 and confirm no remaining occurrence presents MongoDB as the active document store

## 3. Author FerretDB+DocumentDB Architecture and Operations Runbook

- [x] 3.1 Create `docs-site/architecture/ferretdb.md` (or the path confirmed in 1.5) with the following structure: Overview, Two-Layer Design, Deployment Topology, Pinned Image Pair and Upgrade Order, PostgreSQL Extension Prerequisites, Tenancy Model, Known Compatibility Differences, Change-Stream Remediation, Observability, Licensing
- [x] 3.2 Populate the "Two-Layer Design" section with the FerretDB gateway and DocumentDB engine roles, port assignments, and inter-component communication paths (sourced from sibling deployment changes)
- [x] 3.3 Populate the "Pinned Image Pair and Upgrade Order" section: state the pinned pair (`ghcr.io/ferretdb/ferretdb:2.7.0` + `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`), the upgrade rule (engine before gateway; never advance gateway ahead of a matching engine release), and how to verify version compatibility via the engine image tag suffix
- [x] 3.4 Populate the "PostgreSQL Extension Prerequisites" section: `shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'`, `cron.database_name='postgres'`, DocumentDB GUCs, and restart requirements
- [x] 3.5 Populate the "Tenancy Model" section: state that a Mongo "database" is a logical namespace in one shared backing Postgres DB (shared `documentdb_data` schema); app-layer `tenantId` scoping (`applyTenantScopeToFilter` / `injectTenantIntoDocument` in `mongodb-data-api.mjs`) is the authoritative isolation boundary; RLS coexists as a hardening layer; a per-tenant DocumentDB role does NOT provide isolation (a `tenant_a` role can read `tenant_b` data); hard DB-level isolation requires a dedicated DocumentDB instance per tenant tier; describe how credentials are provisioned per-tenant
- [x] 3.4b Add a "Deployment Topology" section: state that the DocumentDB engine runs in a dedicated Postgres instance; record that the colocated topology was evaluated and rejected due to image and `shared_preload_libraries` coupling; state engine-first startup requirement; list bundled extensions: pgvector 0.8.1, PostGIS 3.6.0, rum 1.3, pg_cron 1.6
- [x] 3.6 Populate the "Known Compatibility Differences" section with a table covering: no change streams (remediation direction: Postgres logical replication / pgoutput; owning change: `add-ferretdb-realtime-cdc-remediation`); no multi-document transactions (remediation: idempotent single-document writes); aggregation pipeline policy — all 15 adapter-allowed stages are engine-supported; `$out` and `$merge` are engine-functional but blocked by the Falcone adapter allowlist (policy decision, not engine limitation)
- [x] 3.7 Populate the "Change-Stream Remediation" section with a brief summary and a cross-reference link to the CDC remediation change
- [x] 3.8 Populate the "Observability" section: list Prometheus scrape targets or ServiceMonitor names for FerretDB gateway and DocumentDB engine components; describe the log label scheme; reference or link to alert rules (or mark as TODO if not yet authored)
- [x] 3.9 Populate the "Licensing" section: state that FerretDB is Apache-2.0 and the DocumentDB extension is MIT, name MongoDB (SSPL) as the eliminated alternative, explain why SSPL was not acceptable, and cross-link ADR-14
- [x] 3.10 Add the runbook to the VitePress sidebar (`docs-site/.vitepress/config.mts`)

## 4. Cross-Link ADR-14

- [x] 4.1 Locate the ADR-14 entry in `docs-site/architecture/adrs.md`
- [x] 4.2 Add a "Runbook" field or link in the ADR-14 entry pointing to the new `ferretdb.md` document
- [x] 4.3 Add an ADR-14 reference link from the Overview section of the runbook back to the ADR index

## 5. Verify Acceptance Criteria

- [x] 5.1 Confirm the runbook document exists at its canonical path and all required sections (two-layer design, pinned pair + upgrade order, PostgreSQL prerequisites, per-tenant tenancy mapping, compatibility differences table, change-stream cross-reference, observability, licensing) are present
- [x] 5.2 Confirm ADR-14 is cross-linked bidirectionally (runbook to ADR-14; ADR-14 to runbook)
- [x] 5.3 Confirm the compatibility-differences table covers at minimum: no change streams (with pgoutput/logical replication as remediation direction and `add-ferretdb-realtime-cdc-remediation` cross-referenced), no multi-document transactions (idempotent single-document writes), and aggregation pipeline policy (`$out`/`$merge` blocked by adapter allowlist, all other adapter-allowed stages supported)
- [x] 5.4 Re-run the MongoDB grep (from 1.6) and confirm no remaining occurrence presents MongoDB as the active document store in any README, docs, or docs-site file
- [x] 5.5 Confirm the licensing note names MongoDB SSPL as the eliminated alternative and links to ADR-14
- [x] 5.6 Confirm the observability section references at least one Prometheus scrape target or ServiceMonitor per FerretDB+DocumentDB component (or marks them as TODO with a tracking note)
