## Why

After the SeaweedFS migration (add-seaweedfs-deployment, add-seaweedfs-tenant-identities), internal documentation still references MinIO as the object store and no authoritative SeaweedFS architecture or operations runbook exists, leaving operators without the topology, day-2 ops, and cutover/rollback guidance needed to run the new backend safely in production.

## What Changes

- Add a SeaweedFS architecture and operations runbook document under `docs-site/architecture/` (or `docs/reference/architecture/`) covering:
  - Component topology: master / volume / filer / S3-API gateway nodes
  - Filer-on-PostgreSQL metadata store configuration and considerations
  - Per-tenant credential and identity model (cross-referencing add-seaweedfs-tenant-identities outcomes)
  - Chosen replication factor and rationale
  - PVC sizing guidelines per component
  - TLS/ingress surface and internal-only networking rules
  - Day-2 ops: scaling volume servers, backup procedures, health checks
  - Cutover runbook cross-reference and rollback runbook cross-reference
- Add a short licensing note explaining why SeaweedFS (Apache-2.0) was chosen over AGPL alternatives, cross-linking ADR-13
- Retire all MinIO references in README, architecture diagram, and any other docs that name MinIO as the object store, replacing them with SeaweedFS equivalents
- Document where SeaweedFS component metrics and logs land in Falcone's existing observability stack (scrape targets, log labels, dashboards, alerts)

## Capabilities

### New Capabilities

- `storage-docs`: Authoritative SeaweedFS architecture documentation, operations runbook, licensing rationale, and observability integration notes for the storage capability

### Modified Capabilities

- `storage`: Documentation-level requirement added — an authoritative architecture/ops doc MUST exist and MinIO references MUST be retired from all repo documentation

## Impact

- `docs-site/architecture/` or `docs/reference/architecture/`: new SeaweedFS runbook document
- `docs-site/architecture/adrs.md` (or equivalent): cross-link from ADR-13 entry to the new runbook
- `README.md` and architecture diagram source: MinIO references replaced with SeaweedFS
- No source code, Helm charts, tests, or API contracts are changed
- Depends on: `add-seaweedfs-storage-adr-spike` (ADR-13), `add-seaweedfs-deployment` (topology details), `add-seaweedfs-tenant-identities` (per-tenant credential model), `add-seaweedfs-data-migration-runbook` (cutover runbook), `add-seaweedfs-rollback-plan` (rollback runbook)
- Priority: P2 / label: documentation
