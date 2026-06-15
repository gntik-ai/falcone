## Why

Falcone's document-store isolation today is **app-level only**: every tenant's collection reads, writes, and queries flow through a single shared Mongo credential resolved from `MONGO_URI` in `apps/control-plane/src/runtime/main.mjs::mongoUri` (lines 33–42). The per-tenant credential surface (`scoped_credential` / `MONGO_DATA_SCOPED_CREDENTIAL_TYPES`) is advertised in `services/adapters/src/mongodb-data-api.mjs` (lines 136, 138) and routed in `apps/control-plane/src/mongo-data-api.mjs` (lines 73–81) but has no backend implementation — there is no executor route that provisions a real per-tenant DocumentDB identity. App-level `tenantId` injection (`applyTenantScopeToFilter` / `injectTenantIntoDocument` in `services/adapters/src/mongodb-data-api.mjs:620,655`) is the only isolation layer. Any bypass of that application code — a misconfigured executor, a raw MongoDB connection, or a future code path that omits the filter — leaks all tenants' documents.

The FerretDB migration epic (#454) moves from MongoDB to FerretDB 2.7.0 fronted over a DocumentDB 0.107 engine. ADR-14 (spike `add-ferretdb-adr-spike`, merged) established the key tenancy facts: a Mongo "database" in DocumentDB is a **logical namespace** inside one shared Postgres database (the `documentdb_data` schema, keyed by a `database_name` column) — it is **not** a Postgres-database-per-tenant. The spike also confirmed that `db.runCommand({createUser, roles:[...]})` over the MongoDB wire protocol provisions a real Postgres login role (LOGIN, non-superuser, non-BYPASSRLS) that FerretDB authenticates. Critically, the spike **disproved** per-database role scoping at the DocumentDB layer: a user created with `readWrite` on `tenant_a` could successfully read `tenant_b`. DB-level credential isolation is therefore **not** enforced at this engine version.

This change (GitHub issue #458, epic #454 child) delivers:

1. **Per-tenant credential provisioning** via the MongoDB wire-protocol `createUser`/`updateUser`/`dropUser` commands, yielding a real non-superuser/non-BYPASSRLS Postgres login role per tenant — for **least-privilege auth and audit trail**, not as the isolation boundary.
2. **Explicit reaffirmation** that `applyTenantScopeToFilter` / `injectTenantIntoDocument` remain the **authoritative isolation boundary** — unchanged by the engine swap.
3. **Defense-in-depth RLS hardening**: the backing `documentdb_data` tables can be protected by `ENABLE/FORCE ROW LEVEL SECURITY` + the non-BYPASSRLS `falcone_app` role + `app.tenant_id` GUC (proven to coexist cleanly with DocumentDB in the spike), described as a hardening layer, not the sole boundary.
4. **Record of hard-isolation option**: a dedicated Postgres database/instance per high-isolation tenant tier is the only path to DB-level cross-tenant denial; this is documented as a future option, explicitly not delivered by a Mongo logical namespace.

## What Changes

- Introduce a net-new DocumentDB identity applier (`services/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs`) that provisions, rotates, and revokes per-tenant DocumentDB credentials via the MongoDB wire-protocol `createUser` / `updateUser` / `dropUser` commands — **not** Postgres `CREATE USER` / `GRANT ALL ON DATABASE` DDL, and **not** consistent with `postgres-applier.mjs` which manages only `['schemas','tables','views','extensions','grants']` and has no role/identity logic.
- On tenant onboarding: issue `db.runCommand({createUser: 'falcone_doc_{tenantId}', roles:[{role:'readWrite', db:'falcone_doc_{tenantId}'}]})` over the wire protocol, producing a real Postgres login role (non-superuser, non-BYPASSRLS). The logical Mongo namespace `falcone_doc_{tenantId}` is used as the per-tenant collection container — it is a DocumentDB logical namespace, not a Postgres database.
- On tenant offboarding: issue `dropUser` for the per-tenant credential; the logical namespace is cleared via collection deletion (not a Postgres `DROP DATABASE`).
- Implement credential rotation: issue `updateUser` with a new password, update the Vault/ESO secret (ADR-9), emit a `credential_rotation` audit event.
- Retain and explicitly document `applyTenantScopeToFilter` / `injectTenantIntoDocument` as the **authoritative** isolation layer; app-layer scoping is the primary boundary throughout.
- Describe optional RLS hardening (`ENABLE/FORCE ROW LEVEL SECURITY` + non-BYPASSRLS role + `app.tenant_id` GUC on `documentdb_data` tables) as a defense-in-depth layer provably compatible with the DocumentDB engine.
- Record dedicated-Postgres-database/instance-per-tier as the only path to hard DB-level isolation; mark it out of scope for this change.
- Mark `documentdb.enableUserCrud` / `documentdb.maxUserLimit` GUC names as `⚠ not code-verifiable` — the spike did not confirm them as the gating knobs for wire-protocol `createUser`; add a pre-implementation task to verify before relying on them.

## Capabilities

### New Capabilities

_(none — this change implements per-tenant credential provisioning within the existing data-api and tenant-isolation capabilities)_

### Modified Capabilities

- `data-api`: ADDED requirements — per-tenant DocumentDB credential provisioned on tenant onboarding via wire-protocol `createUser`; credential rotation via `updateUser`; revocation via `dropUser` on offboarding; app-layer `tenantId` scoping (`applyTenantScopeToFilter` / `injectTenantIntoDocument`) is explicitly the authoritative isolation boundary; tenant->namespace/collection mapping preserved at parity.
- `tenant-isolation`: ADDED requirements — app-layer tenantId scoping is the primary isolation boundary for document-store operations; per-tenant credentials provide least-privilege auth and audit; optional RLS hardening on `documentdb_data` tables is a defense-in-depth layer; hard DB-level isolation requires a dedicated Postgres instance per tier (out of scope for this change; documented).

## Impact

- **Code**: new `services/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs`; tenant lifecycle hooks in `services/provisioning-orchestrator/`; `apps/control-plane/src/runtime/main.mjs` credential wiring updated from single shared `MONGO_URI` to per-tenant credential resolver.
- **APIs**: No new public routes; existing provision/rotate/revoke routes now have real DocumentDB backend effect for the document-store capability.
- **Dependencies**: DEPENDS ON `add-ferretdb-adr-spike` (spike findings / ADR-14 merged), `add-ferretdb-documentdb-engine` (running DocumentDB instance), `add-ferretdb-gateway` (FerretDB gateway routing).
- **Security**: Reduces shared-credential attack surface; per-tenant credential enables audit trail; app-layer `tenantId` scoping remains authoritative; no plaintext credentials persisted; credential storage consistent with Vault/ESO (ADR-9).
- **Schema**: No new Postgres migrations for Falcone's relational schemas; DocumentDB identity provisioning is issued at runtime over the MongoDB wire protocol.
