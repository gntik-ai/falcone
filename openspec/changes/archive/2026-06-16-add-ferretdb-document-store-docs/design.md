## Context

Falcone's document-store capability is mid-migration from MongoDB to a two-layer FerretDB+DocumentDB stack (epic #454). Sibling changes handle the operational work (engine deployment, gateway deployment, tenant credentials, CDC remediation, ADR-14). This change is documentation-only: it ensures that once those changes land, authoritative docs exist and no MongoDB references remain. The repo currently has `docs-site/architecture/adrs.md` (ADR-1–ADR-13) and the established VitePress docs home at `docs-site/architecture/`. The existing data-api spec (`openspec/specs/data-api/spec.md`) covers the Mongo CRUD executor and tenant isolation requirements but says nothing about documentation completeness, version-pinning constraints, or compatibility differences.

## Goals / Non-Goals

**Goals:**

- Produce one canonical FerretDB+DocumentDB architecture + ops runbook document in `docs-site/architecture/` covering: two-layer topology, deployment topology (dedicated Postgres, colocated rejected, engine-first startup, bundled extensions: pgvector 0.8.1 / PostGIS 3.6.0 / rum 1.3 / pg_cron 1.6), pinned image pair, upgrade order (engine before gateway), PostgreSQL extension prerequisites, the verified tenancy model (shared backing Postgres DB; app-layer `tenantId` scoping authoritative; RLS as hardening; per-tenant role does NOT provide isolation; hard isolation requires dedicated DocumentDB instance per tier), change-stream remediation cross-reference (pgoutput/logical replication direction), compatibility-differences + remediations table, and observability hooks
- Record the Apache-2.0 + MIT licensing rationale in a licensing section within the runbook, cross-linking ADR-14 and naming MongoDB SSPL as the eliminated alternative
- Remove every MongoDB reference from README, architecture diagrams, and any prose docs that present MongoDB as the active document store, replacing with FerretDB+DocumentDB equivalents
- Cross-link ADR-14 bidirectionally: from the runbook and from the ADR index

**Non-Goals:**

- Authoring ADR-14 itself (owned by `add-ferretdb-adr-spike`)
- Implementing change-stream remediation (owned by `add-ferretdb-realtime-cdc-remediation`); this doc cross-references it only
- Changing tenant-facing API docs or contracts (contract is unchanged)
- Modifying source code, Helm charts, or tests
- Writing migration or rollback runbooks (owned by sibling changes); this change cross-links them

## Decisions

### D1 — Single runbook document, not scattered sections

The FerretDB+DocumentDB topology, upgrade rules, compatibility table, and observability notes are placed in one document (e.g., `docs-site/architecture/ferretdb.md`) rather than spread across multiple files. Rationale: operators need a single authoritative reference; ADR-14 is the decision record, this is the operational guide.

### D2 — Upgrade order is a first-class section

The rule "upgrade the DocumentDB engine image before advancing the FerretDB gateway; never advance the gateway ahead of a matching engine release" is stated explicitly as its own section with the matched image pair pinned by tag. Rationale: version skew between the two layers is a known operational hazard in two-layer stacks; burying the rule in prose invites errors.

### D3 — Compatibility-differences table is required

A table enumerating known MongoDB compatibility gaps with their remediation status and owning change is included. The verified entries are: no change streams (remediation direction: Postgres logical replication / pgoutput, owned by `add-ferretdb-realtime-cdc-remediation`); no multi-document transactions (mitigation: idempotent single-document writes); aggregation pipeline policy — all 15 adapter-allowed stages are engine-supported; `$out` and `$merge` are engine-functional but blocked by the Falcone adapter allowlist (this is a policy decision, not an engine limitation, and MUST be documented as such to avoid misattribution). Rationale: operators and integrators must know before relying on MongoDB-specific features; publishing a false "partial support" claim for `$lookup`/`$facet` or a false "unsupported" claim for `$out`/`$merge` without naming the allowlist constraint creates operational confusion.

### D4 — Cross-link rather than duplicate sibling runbooks

Cutover, rollback, and CDC-remediation runbooks are owned by their respective changes. This document references them by relative path. Rationale: avoids drift between the source of truth and the architecture doc.

### D5 — Licensing note co-located with the runbook

A "Licensing" section within the runbook records the Apache-2.0 + MIT rationale and links to ADR-14. Rationale: keeps the rationale discoverable from the primary reference document.

### D6 — Retire MongoDB references in-place

Existing MongoDB references in README and architecture docs are updated to FerretDB+DocumentDB in the same PR. A grep pass (`grep -r -i "mongodb\|mongo" docs/ docs-site/ README*`) scopes the surface area before editing.

### D7 — Tenancy model documented without false isolation guarantee

The runbook MUST NOT publish "one DocumentDB database + one role per tenant = isolation". The ADR-14 spike confirmed that a `tenant_a` role can read `tenant_b` data in the shared backing Postgres DB. The authoritative isolation boundary is app-layer `tenantId` scoping (`applyTenantScopeToFilter` / `injectTenantIntoDocument` in `mongodb-data-api.mjs`). RLS is a hardening layer. Hard DB-level isolation requires a dedicated DocumentDB instance per tenant tier. Rationale: publishing a false isolation guarantee is a security documentation defect; operators sizing a deployment or performing a security review must have the correct model.

### D8 — Deployment topology is a first-class section

The runbook includes an explicit topology section stating that the DocumentDB engine runs in a dedicated Postgres instance (colocated topology was evaluated and rejected due to image and `shared_preload_libraries` coupling), that engine-first startup order is required, and that the engine bundles pgvector 0.8.1, PostGIS 3.6.0, rum 1.3, and pg_cron 1.6. Rationale: operators need the topology and available extensions to make infrastructure and query-design decisions.

## Risks / Trade-offs

- [Dependency on sibling changes] Final topology and credential model details are not finalized until `add-ferretdb-engine-deployment` and `add-ferretdb-tenant-credentials` are applied. Mitigation: tasks are ordered to author the runbook after those design artifacts are stable; placeholders may be used with a TODO marker.
- [Image tags may change at release time] The pinned pair (`2.7.0` / `17-0.107.0-ferretdb-2.7.0`) is correct at time of authoring; if the release tag changes before merge, the runbook must be updated. Mitigation: the tasks include a verification step against the live chart values.
- [Stale diagram tooling] No binary diagram source was found in the SeaweedFS analog (ASCII only). A grep pass will confirm the same for MongoDB references before committing.

## Open Questions

- OQ1: Does `docs-site/architecture/` remain the settled canonical location, or has a new `docs/reference/architecture/` directory been confirmed as canonical after any recent branch merge?
- OQ2: Are there any Prometheus scrape targets or ServiceMonitor names already defined for FerretDB or DocumentDB components in the sibling deployment changes, or will they be added later?
- OQ3: What is the exact path to the migration/rollback runbook for the MongoDB-to-FerretDB cutover (owned by sibling change)?
