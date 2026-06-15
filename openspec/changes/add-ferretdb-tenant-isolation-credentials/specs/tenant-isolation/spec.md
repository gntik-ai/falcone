## ADDED Requirements

### Requirement: App-layer tenantId scoping is the authoritative document-store isolation boundary

The system SHALL ensure that `applyTenantScopeToFilter` and `injectTenantIntoDocument` in `services/adapters/src/mongodb-data-api.mjs:620,655` remain active and are applied on every document-store read and write operation — so that the application layer is the primary and authoritative isolation boundary for all document-store tenants, regardless of which credential or DocumentDB logical namespace the executor connects to.

Evidence: `services/adapters/src/mongodb-data-api.mjs:620` (`applyTenantScopeToFilter` injects `tenantId` into query filters on every read/bulk operation); `services/adapters/src/mongodb-data-api.mjs:655` (`injectTenantIntoDocument` stamps `tenantId` into every written document); `apps/control-plane/src/runtime/main.mjs:33-42` (today all tenants share a single `MONGO_URI` credential — app-layer scoping is the only isolation layer and must remain active post-migration).

#### Scenario: App-layer tenantId filter is applied on every document read

- **WHEN** a tenant issues a document find or aggregate operation via the data-api executor
- **THEN** the system MUST apply `applyTenantScopeToFilter` to inject a `tenantId` equality predicate into the query filter before issuing any MongoDB wire-protocol command — regardless of which per-tenant DocumentDB credential is in use

#### Scenario: App-layer tenantId stamp is applied on every document write

- **WHEN** a tenant issues a document insert, update, replace, or bulk-write operation via the data-api executor
- **THEN** the system MUST apply `injectTenantIntoDocument` to stamp the `tenantId` field into the document payload before persisting it — regardless of which per-tenant DocumentDB credential is in use

#### Scenario: Per-tenant credential does not substitute for app-layer filter

- **WHEN** a per-tenant DocumentDB credential is provisioned for a tenant
- **THEN** the system MUST NOT remove or bypass `applyTenantScopeToFilter` or `injectTenantIntoDocument` on any data-api code path — the credential provides least-privilege auth and audit, not cross-tenant denial at the backend layer

### Requirement: Per-tenant DocumentDB credentials reduce blast radius and enable per-tenant audit

The system SHALL provision a dedicated DocumentDB credential for each tenant via the MongoDB wire-protocol `createUser` command, yielding a real Postgres login role (non-superuser, non-BYPASSRLS) — so that a compromised credential is scoped to one tenant's operations and a per-tenant audit trail is available, without relying on that credential to enforce cross-tenant document denial at the DocumentDB layer.

Evidence: `apps/control-plane/src/runtime/main.mjs:33-42` (single shared `MONGO_URI` today — all tenants share one credential; blast radius of a credential compromise is unbounded); `services/adapters/src/mongodb-data-api.mjs:136,138` (`scoped_credential` / `MONGO_DATA_SCOPED_CREDENTIAL_TYPES` wired but no backend provisioning); `apps/control-plane/src/mongo-data-api.mjs:73-81` (scoped_credential route, no executor implementation); ADR-14 spike: `db.runCommand({createUser})` over the wire protocol provisions a real Postgres login role (non-superuser, non-BYPASSRLS).

#### Scenario: Tenant onboarding provisions a wire-protocol credential

- **WHEN** the provisioning orchestrator processes a new tenant onboarding event
- **THEN** the system MUST issue `db.runCommand({createUser: 'falcone_doc_{tenantId}', roles:[...]})` over the MongoDB wire protocol, confirm the Postgres login role exists (non-superuser, non-BYPASSRLS), persist the credential reference via Vault/ESO (no plaintext), and mark onboarding complete only after the credential is confirmed

#### Scenario: Shared credential is not used as a fallback after provisioning

- **WHEN** the DocumentDB identity applier cannot provision a per-tenant credential (engine error, capacity limit, or configuration failure)
- **THEN** the system MUST throw a provisioning error and MUST NOT fall through to activating the tenant with the shared `MONGO_URI` credential

### Requirement: Optional RLS hardening on documentdb_data tables provides defense-in-depth

The system SHALL support the optional activation of `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` on the `documentdb_data` backing tables, with a non-BYPASSRLS application role and the `app.tenant_id` GUC (consistent with `services/adapters/src/tenant-rls-context.mjs::withTenantRlsContext`) — so that, when enabled, a query missing the correct `app.tenant_id` GUC context returns zero rows even if the app-layer filter is absent.

Evidence: `services/adapters/src/tenant-rls-context.mjs` (`withTenantRlsContext` sets `app.tenant_id` GUC inside a transaction; non-BYPASSRLS role enforces RLS); ADR-14 spike: RLS coexists cleanly with the DocumentDB engine (non-BYPASSRLS `falcone_app` role saw 1 row vs owner 2 rows in the same table). This is a hardening layer; activation is an operator decision and is not mandated by this change.

#### Scenario: RLS hardening limits exposure when app-layer filter is absent (optional activation)

- **WHEN** RLS hardening is enabled on `documentdb_data` tables AND a query reaches the DocumentDB engine without the correct `app.tenant_id` GUC context set
- **THEN** the engine MUST return zero rows for that tenant's documents — the RLS policy acts as a secondary catch even when the app-layer `applyTenantScopeToFilter` is absent

### Requirement: Hard DB-level isolation requires a dedicated Postgres instance per high-isolation tier

The system SHALL document that a Mongo logical namespace (e.g., `falcone_doc_{tenantId}`) does NOT provide hard cross-tenant DB-level isolation in DocumentDB at the current engine version, and that a dedicated Postgres database or instance per tenant tier is the only architectural path to credential-level cross-tenant denial at the backend layer.

Evidence: ADR-14 spike finding: a user created with `readWrite` on `tenant_a` successfully read `tenant_b` — per-database role scoping is not enforced by the DocumentDB engine in postgres-documentdb 17-0.107.0-ferretdb-2.7.0. A Mongo logical namespace is a `database_name` column value in the shared `documentdb_data` schema, not a Postgres database boundary.

#### Scenario: Mongo logical namespace does not enforce cross-tenant credential denial

- **WHEN** a per-tenant DocumentDB credential scoped to logical namespace `falcone_doc_{tenantA}` is used to issue a wire-protocol `find` on logical namespace `falcone_doc_{tenantB}`
- **THEN** the DocumentDB engine at the current version MUST NOT be assumed to return an authorization error — the app-layer `applyTenantScopeToFilter` is the authoritative guard, and this scenario documents a known limitation of the engine tier

#### Scenario: Hard isolation requires a dedicated Postgres instance

- **WHEN** an operator requires DB-level credential isolation between tenants (i.e., Tenant A's credential is incapable of reading Tenant B's data even if app-layer filters are bypassed)
- **THEN** the system MUST deploy a dedicated Postgres database or instance per high-isolation tenant tier — this requirement is documented as a future architecture option, explicitly out of scope for this change
