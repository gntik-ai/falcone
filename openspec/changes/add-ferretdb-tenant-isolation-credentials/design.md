## Context

Falcone's document-store isolation today relies entirely on app-level `tenantId` injection: every tenant's operations flow through a single shared `MONGO_URI` credential (`apps/control-plane/src/runtime/main.mjs:33-42`). The `scoped_credential` surface (`MONGO_DATA_SCOPED_CREDENTIAL_TYPES` in `services/adapters/src/mongodb-data-api.mjs:138`, route in `apps/control-plane/src/mongo-data-api.mjs:73-81`) is wired but has no backend implementation — no DocumentDB identity is ever provisioned per tenant.

ADR-14 (spike `add-ferretdb-adr-spike`, merged) established the tenancy ground truth for FerretDB 2.7.0 / postgres-documentdb 17-0.107.0:

- A Mongo "database" in DocumentDB is a **logical namespace** inside one shared Postgres database (`documentdb_data` schema, keyed by a `database_name` column). It is **not** a Postgres database per tenant.
- `db.runCommand({createUser, roles:[...]})` over the MongoDB wire protocol provisions a real Postgres login role (LOGIN, non-superuser, non-BYPASSRLS). FerretDB authenticates via this role.
- **Cross-tenant credential scoping is not enforced at the DocumentDB layer**: the spike confirmed that a user created with `readWrite` on `tenant_a` can successfully read `tenant_b`. A Mongo logical namespace + credential does NOT provide DB-level backend isolation at this engine version.
- RLS coexists cleanly with the DocumentDB engine: `ENABLE/FORCE ROW LEVEL SECURITY` + non-BYPASSRLS role + `app.tenant_id` GUC on `documentdb_data` tables is proven to work.

The existing Postgres RLS model is implemented via `services/adapters/src/tenant-rls-context.mjs::withTenantRlsContext` and a non-BYPASSRLS `falcone_app` role. `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` manages only `['schemas','tables','views','extensions','grants']` — it has no role creation or Mongo database logic. DocumentDB identity provisioning is therefore **net-new**.

This change depends on: `add-ferretdb-adr-spike` (ADR-14 merged), `add-ferretdb-documentdb-engine` (running DocumentDB instance), `add-ferretdb-gateway` (FerretDB gateway routing).

## Goals / Non-Goals

**Goals:**

- Provision a per-tenant DocumentDB credential via MongoDB wire-protocol `createUser` on tenant onboarding.
- Revoke the per-tenant DocumentDB credential via `dropUser` on tenant offboarding with no orphaned access.
- Implement credential rotation via `updateUser`; credential storage via Vault/ESO (ADR-9); no plaintext persisted.
- Preserve tenant->namespace/collection mapping at parity with pre-migration; retain app-level `tenantId` injection as the authoritative isolation layer.
- Document optional RLS hardening on `documentdb_data` tables as a defense-in-depth layer.
- Document dedicated-Postgres-database/instance-per-tier as the future path to hard DB-level isolation.

**Non-Goals:**

- Claiming that per-tenant DocumentDB logical namespace + credential enforces cross-tenant denial at the backend layer (the spike disproved this).
- Deploying or configuring FerretDB or DocumentDB (covered by `add-ferretdb-documentdb-engine` and `add-ferretdb-gateway`).
- Realtime/CDC tenant scoping (covered by `add-ferretdb-realtime-cdc-remediation`).
- Multi-tenant data migration or collection renaming.
- UI for credential management.
- Provisioning a dedicated Postgres database per tenant (this requires a dedicated DocumentDB instance, out of scope for this change).

## Decisions

### D1 — App-layer tenantId scoping is the authoritative isolation boundary

**Decision:** `applyTenantScopeToFilter` and `injectTenantIntoDocument` in `services/adapters/src/mongodb-data-api.mjs:620,655` remain the **primary** isolation mechanism and are **not** removed or demoted. They are authoritative across all document-store code paths regardless of the engine swap.

**Rationale:** The ADR-14 spike disproved per-database role scoping at the DocumentDB layer. The app-layer filter is the only mechanism that reliably enforces per-tenant isolation at this engine version. No code change removes or conditions this filter.

### D2 — Per-tenant credentials via wire-protocol createUser for least-privilege auth and audit

**Decision:** On tenant onboarding, issue `db.runCommand({createUser: 'falcone_doc_{tenantId}', pwd: '<pw>', roles:[{role:'readWrite', db:'falcone_doc_{tenantId}'}]})` over the MongoDB wire protocol, producing a real Postgres login role (non-superuser, non-BYPASSRLS). The logical Mongo namespace `falcone_doc_{tenantId}` is the per-tenant collection container.

**Rationale:** Per-tenant credentials reduce the blast radius of a credential compromise (least privilege), enable per-tenant audit trails, and satisfy the `scoped_credential` capability surface already wired in `services/adapters/src/mongodb-data-api.mjs`. They do NOT, by themselves, enforce cross-tenant document denial at the backend layer.

**What D2 is NOT:** This is not `CREATE USER` / `GRANT ALL ON DATABASE` Postgres DDL; `falcone_doc_{tenantId}` is a logical namespace, not a Postgres database; `GRANT ALL ON DATABASE` is not issued. This provisioning is not consistent with `postgres-applier.mjs` (which has no role/identity logic).

### D3 — Net-new DocumentDB identity applier (documentdb-identity-applier.mjs)

**Decision:** Introduce `services/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs` wrapping the MongoDB wire-protocol `createUser` / `updateUser` / `dropUser` commands over an injectable wire-protocol client. This is a new applier not extending `postgres-applier.mjs` or `mongo-applier.mjs`.

**Rationale:** Keeps DocumentDB identity management isolated, testable, and independently versioned. The `postgres-applier.mjs` manages relational DDL only (`['schemas','tables','views','extensions','grants']`); the `mongo-applier.mjs` handles MongoDB metadata reprovision. DocumentDB identity lifecycle is a distinct concern.

### D4 — GUC names documentdb.enableUserCrud / documentdb.maxUserLimit are unverified

**Decision:** The GUC names `documentdb.enableUserCrud` and `documentdb.maxUserLimit` are marked `⚠ not code-verifiable` — the ADR-14 spike did not confirm them as the gating knobs for wire-protocol `createUser`. A pre-implementation task (see tasks.md §1) MUST verify the actual GUC names and behaviour on the target engine version before the identity applier relies on them.

**Rationale:** Avoids building the fail-closed guard on unverified configuration names that may differ or be absent in postgres-documentdb 17-0.107.0-ferretdb-2.7.0.

### D5 — Fail-closed on provisioning failure

**Decision:** If the DocumentDB identity applier cannot issue `createUser` for a tenant (engine error, auth failure, or capacity limit), the provisioning MUST throw and the tenant onboarding MUST NOT be marked complete.

**Rationale:** Consistent with the RLS fail-closed policy in `openspec/specs/tenant-isolation/spec.md`. A tenant activated without a real per-tenant credential is an audit and blast-radius failure.

### D6 — Credential storage via Vault/ESO (ADR-9); no plaintext persisted

**Decision:** The DocumentDB credential password is generated at provisioning time via `node:crypto`, stored as a Vault/ESO secret, and referenced in the executor via `secretRef` (consistent with the embedding-store pattern in `apps/control-plane/src/runtime/main.mjs:74-80`). The plaintext password is delivered once via a secret envelope and never written to the relational database.

### D7 — Optional RLS hardening on documentdb_data tables

**Decision:** The design documents — but does not mandate in this change — the option to apply `ENABLE/FORCE ROW LEVEL SECURITY` + non-BYPASSRLS `falcone_app` role + `app.tenant_id` GUC on the `documentdb_data` backing tables. The spike confirmed this coexists cleanly with the DocumentDB engine.

**Rationale:** This layer provides defense-in-depth if the app-layer filter is bypassed. It is a hardening option, not the sole or primary boundary. Activation requires coordination with `add-ferretdb-documentdb-engine`; it is recorded here for the operator's decision.

### D8 — Hard DB-level isolation requires a dedicated Postgres instance per tier

**Decision:** The design records that hard cross-tenant DB-level isolation is only achievable with a dedicated Postgres database/instance per high-isolation tenant tier. A Mongo logical namespace does not provide this. This is documented as a future architecture option, explicitly NOT delivered by this change.

## Risks / Trade-offs

- **GUC names unverified** — `documentdb.enableUserCrud` / `documentdb.maxUserLimit` may differ on the target engine; mitigated by D4 pre-implementation verification task.
- **App-layer bypass** — Per-tenant credentials alone do not block a misconfigured executor from using the wrong credential and reading cross-tenant data; mitigated by retaining `applyTenantScopeToFilter` / `injectTenantIntoDocument` as the authoritative boundary.
- **Migration gap for pre-existing tenants** — Tenants onboarded before this change have no per-tenant DocumentDB credential. A back-fill step creates credentials for them; until back-filled, they continue on the shared `MONGO_URI`. Mitigation: back-fill script iterates all active tenants.
- **Credential rotation downtime** — `updateUser` takes effect immediately; active in-flight connections authenticated with the old password may be dropped. Mitigation: rotate during low-traffic windows; document in the runbook.

## Open Questions

- OQ1: Should the back-fill step force-rotate existing tenant credentials, or leave them on the shared credential until the next onboarding event? (Default: no-force-rotate; `--force-rotate` flag available in the back-fill script.)
- OQ2: Should RLS hardening on `documentdb_data` tables (D7) be activated as part of this change or deferred to a separate hardening change? (Deferred pending operator decision; this change documents the option only.)
