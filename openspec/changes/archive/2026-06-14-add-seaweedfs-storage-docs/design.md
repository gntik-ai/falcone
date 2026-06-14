## Context

Falcone's storage capability is mid-migration from MinIO to SeaweedFS. Several sibling changes handle the operational work (deployment, tenant identities, migration runbook, rollback plan, ADR-13). This change is documentation-only: it ensures that once those changes land, authoritative docs exist and no MinIO references remain. The repo currently has `docs-site/architecture/adrs.md` (ADR-1–ADR-12) and an emerging `docs/reference/architecture/` directory introduced on the `docs/reconcile-readme-architecture` branch. The existing storage spec (`openspec/specs/storage/spec.md`) covers credential rotation policy requirements but says nothing about documentation completeness.

## Goals / Non-Goals

**Goals:**

- Produce one canonical SeaweedFS architecture + ops runbook document in the existing docs location (`docs-site/architecture/` or `docs/reference/architecture/`) that covers topology, metadata store, tenant credential model, replication, PVC sizing, TLS/networking, and day-2 ops
- Record the Apache-2.0 licensing rationale in a short licensing note, cross-linking ADR-13
- Remove every MinIO reference from README, architecture diagram source, and any prose docs that name MinIO as the object store
- Document SeaweedFS observability integration (metrics scrape targets, log labels, dashboards, alert rules) in line with the existing observability stack

**Non-Goals:**

- Authoring ADR-13 itself (owned by `add-seaweedfs-storage-adr-spike`)
- Changing tenant-facing API docs or contracts (contract is unchanged)
- Modifying source code, Helm charts, or tests
- Writing migration or rollback runbooks (owned by `add-seaweedfs-data-migration-runbook` and `add-seaweedfs-rollback-plan`); this change cross-links them, not duplicates them

## Decisions

### D1 — Single runbook document, not scattered sections

The SeaweedFS topology, day-2 ops, and observability notes are placed in one document (e.g., `docs-site/architecture/seaweedfs.md` or `docs/reference/architecture/seaweedfs.md`) rather than spread across multiple files. Rationale: operators need a single authoritative reference; ADR-13 is the decision record, this is the operational guide.

### D2 — Cross-link rather than duplicate sibling runbooks

The cutover and rollback runbooks are owned by their respective changes. This document references them by relative path rather than embedding content. Rationale: avoids drift between the source of truth and the architecture doc.

### D3 — Retire MinIO references in-place

Existing MinIO references in README and the architecture diagram are updated to SeaweedFS in the same PR. No redirect or alias needed since these are internal docs. A grep pass (`grep -r "minio\|MinIO" docs/ docs-site/ README*`) scopes the surface area before editing.

### D4 — Licensing note co-located with the runbook

A "Licensing" section within the runbook (rather than a standalone file) records the Apache-2.0 rationale and links to ADR-13. Rationale: keeps the rationale discoverable from the primary reference document.

## Risks / Trade-offs

- [Dependency on sibling changes] Final topology/credential/runbook details are not finalized until `add-seaweedfs-deployment` and `add-seaweedfs-tenant-identities` are applied → **Mitigation**: Tasks are ordered to author the runbook after those changes' design artifacts are stable; placeholders may be used with a TODO marker until resolved.
- [Doc location not yet settled] Two candidate locations exist (`docs-site/architecture/` and `docs/reference/architecture/`); the branch that introduced the latter has not yet merged → **Mitigation**: Prefer `docs-site/architecture/` (established convention) unless the new directory is confirmed merged; task includes a verification step.
- [Stale diagram tooling] If the architecture diagram is a binary (e.g., draw.io) rather than text source, updating the MinIO label requires the correct tooling → **Mitigation**: Scope the grep pass to identify diagram source format before committing.

## Open Questions

- OQ1: Is `docs/reference/architecture/` the settled canonical location after the `docs/reconcile-readme-architecture` merge, or does `docs-site/architecture/` remain authoritative?
- OQ2: What is the exact scrape target label and dashboard name for SeaweedFS in Falcone's observability stack? (Blocked on `add-seaweedfs-deployment` completing its monitoring setup.)
- OQ3: Is the architecture diagram a text-based format (Mermaid, PlantUML, D2) or a binary, and where is its source file?
