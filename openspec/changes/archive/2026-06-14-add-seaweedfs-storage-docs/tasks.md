## 1. Prerequisites and Scope Discovery

- [x] 1.1 Confirm that `add-seaweedfs-deployment` design.md is merged or stable enough to extract final component topology (master/volume/filer/S3-API node counts, PVC sizes, replication factor)
  - Done. `add-seaweedfs-deployment` is **archived** (`openspec/changes/archive/2026-06-14-add-seaweedfs-deployment`). Topology sourced from the live chart `charts/in-falcone/charts/seaweedfs` + wrapper `charts/in-falcone/values.yaml` (ground truth over the design doc).
- [x] 1.2 Confirm that `add-seaweedfs-tenant-identities` design.md is merged or stable enough to extract the per-tenant credential and identity model
  - Done. `add-seaweedfs-tenant-identities` is **archived**. Identity model sourced from its design.md + `services/adapters/src/seaweedfs-iam-client.mjs` / `storage-tenant-context.mjs`.
- [x] 1.3 Confirm that `add-seaweedfs-data-migration-runbook` and `add-seaweedfs-rollback-plan` have their canonical doc paths so the runbook can link to them
  - Done. Cutover = `tools/migration/RUNBOOK.md`; rollback = `tools/migration/ROLLBACK.md` (both files confirmed present).
- [x] 1.4 Resolve design open question OQ1: determine whether `docs-site/architecture/` or `docs/reference/architecture/` is the settled canonical docs location after the `docs/reconcile-readme-architecture` branch merges
  - Resolved → **`docs-site/architecture/`**. It is the established VitePress docs home (adrs.md, services.md, deployment.md, overview.md, flows-runbook.md, mcp-runbook.md). `docs/reference/architecture/` holds only an untracked auto-generated `public-api-surface.md` and is not the docs site.
- [x] 1.5 Resolve design open question OQ3: run `find docs/ docs-site/ -name "*.xml" -o -name "*.drawio" -o -name "*.puml" -o -name "*.mmd" -o -name "*.d2"` to identify the architecture diagram source format and path
  - Resolved → **no diagram source files exist** (no .xml/.drawio/.puml/.mmd/.d2). The platform "diagram" is an inline ASCII block in `README.md` (and `docs-site/architecture/overview.md` / `services.md`). No binary diagram tooling needed.

## 2. Retire MinIO References

- [x] 2.1 Run `grep -r -i "minio" docs/ docs-site/ README* --include="*.md" --include="*.rst" --include="*.adoc" -l` to list all files containing MinIO references
  - Done. Hits: README.md (+ README.fr/ru/zh/de/es.md), docs-site/index.md, architecture/{adrs,services,deployment,overview}.md, guide/{installation,what-is-falcone,roadmap,third-party-licenses}.md, contributing/index.md, operations/helm-configuration.md.
- [x] 2.2 Update `README.md`: replace MinIO with SeaweedFS in any section describing the object-store or storage backend (architecture overview, component list, diagram caption)
  - Done for the **go-forward / architecture** sections: ASCII architecture diagram (`S3/MinIO` → `SeaweedFS`), the (now-backwards) "under evaluation" note → "migrating MinIO → SeaweedFS (adopted, ADR-13)", license table (added SeaweedFS 4.33 Apache-2.0 row; MinIO annotated "legacy — retained during cutover"), license-compatibility note (SeaweedFS chosen to retire MinIO AGPL §13 exposure), AWS SDK row.
  - **Intentionally preserved** (truthful): the Docker-Compose dev-stack endpoints (MinIO on :59000/:59001) and "the MinIO bucket" helper text — the dev stack (`tests/env/docker-compose.yml`) still runs MinIO. See blocker note under 2.5.
- [x] 2.3 Update the architecture diagram source file (identified in 1.5): relabel the MinIO node as SeaweedFS and regenerate any derived image (PNG/SVG) if applicable
  - Done. No binary/text diagram source exists; the only diagram is the README ASCII block, relabeled in 2.2. No derived image to regenerate.
- [x] 2.4 Update any other docs files identified in 2.1 that present MinIO as the current store; historical mentions within ADR-13 or comparison notes may remain
  - Done (operator chose **full retirement**, including the translated READMEs). Updated: (A) go-forward/architecture refs → SeaweedFS — index.md:45, services.md (diagram + "Object Storage" section), deployment.md (alias list + data/storage note + deployed-namespace line), overview.md (diagram), what-is-falcone.md (capability table + screenshot caption + executor prose), roadmap.md (split bullet; object storage = adopted SeaweedFS), helm-configuration.md (component prose); (B) operational refs — installation.md (`seaweedfs` / `chrislusf/seaweedfs:4.33` image rows + airgap example), contributing/index.md (dev-compose comment), README dev-stack (prose + ports table → SeaweedFS S3 `:58333`); (C) license disclosures — third-party-licenses.md + README license tables (added SeaweedFS 4.33 Apache-2.0 row; MinIO annotated "legacy — retained during cutover"; SDK row; AGPL §13 note). Translated READMEs (fr/ru/zh/de/es) mirrored. ADR-13 historical mentions preserved.
- [x] 2.5 Verify: re-run the grep from 2.1 and confirm no remaining occurrence presents MinIO as the active store
  - Verified: every remaining `minio` occurrence across README*.md + docs-site is ADR-13 decision-record content, a license disclosure annotated legacy/cutover, or migration-context prose ("MinIO retained only during the cutover window"). None presents MinIO as the active store. markdownlint clean.
  - ⚠ **Honest caveat (operator-approved).** The docs now describe SeaweedFS as the active store **ahead of the infra cutover**: chart defaults are still `storage.enabled: true` (MinIO) / `seaweedfs.enabled: false`, and `tests/env/docker-compose.yml` still runs MinIO. To make the QuickStart literally runnable, a follow-up (out of scope here) must flip the chart toggles and migrate the dev compose to SeaweedFS (S3 on `:58333`).

## 3. Author SeaweedFS Architecture and Operations Runbook

- [x] 3.1 Create `docs-site/architecture/seaweedfs.md` (or the path confirmed in 1.4) with the following structure: Overview, Component Topology, Filer on PostgreSQL, Per-Tenant Identity Model, Replication, PVC Sizing, TLS and Networking, Day-2 Operations, Observability, Licensing
  - Done. Created `docs-site/architecture/seaweedfs.md` with all sections; added to the VitePress sidebar (`docs-site/.vitepress/config.mts`).
- [x] 3.2 Populate the "Component Topology" section with the master / volume / filer / S3-API gateway node roles, port assignments, and inter-component communication paths (sourced from `add-seaweedfs-deployment`)
- [x] 3.3 Populate the "Filer on PostgreSQL" section with the metadata store configuration, the PostgreSQL schema used, connection parameters, and any VACUUM / index considerations
- [x] 3.4 Populate the "Per-Tenant Identity Model" section with the per-tenant credentials scheme, how credentials are provisioned, and the isolation guarantees (sourced from `add-seaweedfs-tenant-identities`)
- [x] 3.5 Populate the "Replication" section with the chosen replication setting, rationale, and how to change it
  - Used the **code value** (dev `000`, HA `011`), not the design doc's `001` — the single-server dev topology fails PUTs at `001` (fixed in `fix-seaweedfs-deployment-defects`).
- [x] 3.6 Populate the "PVC Sizing" section with per-component PVC size guidelines (master journal, volume data, filer DB)
- [x] 3.7 Populate the "TLS and Networking" section: ingress configuration, internal-only service names, mTLS between components if applicable
- [x] 3.8 Populate the "Day-2 Operations" section: how to add a volume server, how to run backup (backup-restore change?), health check endpoints, and explicit cross-reference links to the cutover runbook and rollback runbook
- [x] 3.9 Populate the "Licensing" section: state that SeaweedFS is Apache-2.0, name the AGPL alternative(s) considered (e.g., MinIO AGPL edition, Garage), explain why Apache-2.0 was required, and cross-link ADR-13
- [x] 3.10 Add the "Observability" section: list Prometheus scrape targets or ServiceMonitor names for master, volume, filer, and S3-API components; describe the log label scheme (`app=seaweedfs`, `component=<master|volume|filer>`); reference or link to alert rules (or mark as TODO if not yet authored)
  - Alert rules marked **TODO** (none authored yet).

## 4. Cross-Link ADR-13

- [x] 4.1 Locate the ADR-13 entry in `docs-site/architecture/adrs.md` (or equivalent ADR index)
  - Found at `docs-site/architecture/adrs.md` "## ADR-13 — Migrate object store from MinIO to SeaweedFS".
- [x] 4.2 Add a "Runbook" field or link in the ADR-13 entry pointing to the new `seaweedfs.md` document
  - Added a **Runbook** line linking to `/architecture/seaweedfs`.

## 5. Verify Acceptance Criteria

- [x] 5.1 Confirm the runbook document exists at its canonical path and all required sections (topology, filer-on-PostgreSQL, per-tenant identity, replication, PVC sizing, TLS, day-2 ops, observability, licensing) are present
- [x] 5.2 Confirm ADR-13 is cross-linked from both the runbook and the ADR index
  - Bidirectional: runbook → ADR-13 anchor; ADR-13 → runbook.
- [x] 5.3 Confirm the cutover and rollback runbooks are cross-referenced by relative path from the runbook
  - `../../tools/migration/RUNBOOK.md` and `../../tools/migration/ROLLBACK.md`.
- [x] 5.4 Re-run the MinIO grep (from 2.1) and confirm no remaining occurrence presents MinIO as the active store in any README, docs, or docs-site file
  - Done — see 2.5. Remaining mentions are ADR-13 / license-disclosure / migration-context only, across English + 5 translated READMEs + docs-site. (Infra-cutover caveat recorded under 2.5.)
- [x] 5.5 Confirm the licensing note names at least one AGPL alternative and links to ADR-13
  - Names MinIO CE (AGPL-3.0); links ADR-13.
- [x] 5.6 Confirm the observability section references at least one Prometheus scrape target or ServiceMonitor per SeaweedFS component
  - ServiceMonitors per master/volume/filer/s3 on metrics port 9327; Grafana dashboard gnetId 10423.
