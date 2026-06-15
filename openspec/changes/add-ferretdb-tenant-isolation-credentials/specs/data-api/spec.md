## ADDED Requirements

### Requirement: Tenant onboarding provisions a per-tenant DocumentDB credential via wire-protocol createUser

The system SHALL, upon tenant onboarding, issue `db.runCommand({createUser: 'falcone_doc_{tenantId}', roles:[{role:'readWrite', db:'falcone_doc_{tenantId}'}]})` over the MongoDB wire protocol to produce a real Postgres login role (non-superuser, non-BYPASSRLS) scoped to the per-tenant logical namespace `falcone_doc_{tenantId}` — so that every tenant has a dedicated credential for least-privilege auth and audit, separate from the single shared `MONGO_URI` credential in `apps/control-plane/src/runtime/main.mjs::mongoUri`.

Note: `falcone_doc_{tenantId}` is a DocumentDB logical namespace (a `database_name` value in the shared `documentdb_data` schema), **not** a Postgres database. Provisioning is via wire-protocol `createUser`, **not** Postgres `CREATE USER` / `GRANT ALL ON DATABASE` DDL. The GUC names `documentdb.enableUserCrud` / `documentdb.maxUserLimit` are `⚠ not code-verifiable` at this spec revision — a pre-implementation task MUST verify them on postgres-documentdb 17-0.107.0-ferretdb-2.7.0 before the identity applier relies on them.

Evidence: `apps/control-plane/src/runtime/main.mjs:33-42` (single shared `MONGO_URI` / `MONGO_HOST` credential for all tenants); `services/adapters/src/mongodb-data-api.mjs:136,138` (`scoped_credential` / `MONGO_DATA_SCOPED_CREDENTIAL_TYPES` advertised but no backend provisioning); `apps/control-plane/src/mongo-data-api.mjs:73-81` (scoped_credential route wired, no executor implementation); `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` (manages `['schemas','tables','views','extensions','grants']` only — no role or identity logic; DocumentDB identity provisioning is net-new).

#### Scenario: Tenant onboarding creates a DocumentDB credential via wire protocol

- **WHEN** the provisioning orchestrator processes a new tenant onboarding event
- **THEN** the system MUST issue the MongoDB wire-protocol `createUser` command for `falcone_doc_{tenantId}` against the DocumentDB engine, confirm the Postgres login role exists (non-superuser, non-BYPASSRLS), persist the `credentialRef` via Vault/ESO (no plaintext), and mark onboarding complete only after the credential is confirmed

#### Scenario: Duplicate onboarding is idempotent and does not overwrite an existing credential

- **WHEN** the provisioning orchestrator calls the DocumentDB identity applier for a tenant that already has an active credential
- **THEN** the system MUST detect the existing credential and return without issuing duplicate `createUser` or overwriting the existing password

#### Scenario: Provisioning failure blocks tenant activation

- **WHEN** the DocumentDB identity applier cannot issue `createUser` (engine error, configuration failure, or capacity limit)
- **THEN** the system MUST throw a provisioning error, MUST NOT mark onboarding complete, and MUST NOT activate the tenant with the shared `MONGO_URI` credential

### Requirement: Per-tenant DocumentDB credential rotation is implemented and does not orphan access

The system SHALL implement credential rotation for per-tenant DocumentDB credentials: issue `db.runCommand({updateUser: 'falcone_doc_{tenantId}', pwd: '<new>'})` over the MongoDB wire protocol, update the Vault/ESO secret (consistent with ADR-9), emit a `credential_rotation` audit event, and invalidate the previous password immediately.

Evidence: `services/adapters/src/mongodb-data-api.mjs:136` (`scoped_credential` management capability); `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs` (sweep pattern for credential rotation); Vault/ESO credential storage pattern (ADR-9).

#### Scenario: Manual rotation updates the DocumentDB credential and invalidates the old password

- **WHEN** a tenant admin triggers credential rotation for the document-store scoped credential
- **THEN** the system MUST issue the wire-protocol `updateUser` command with the new password, update the Vault/ESO secret, confirm the previous password is no longer accepted, and deliver the new credential exactly once through the secret envelope

#### Scenario: Policy-sweep rotation applies and audits the rotation event

- **WHEN** the credential expiry sweep finds a per-tenant DocumentDB credential whose policy expiry has elapsed
- **THEN** the system MUST rotate the credential via `updateUser`, update the Vault/ESO secret, and emit a `credential_rotation` audit event with `rotationReason: "policy_expiry"` — no rotation attempt is silently skipped

### Requirement: App-layer tenantId scoping is retained as the authoritative isolation layer for all data-api operations

The system SHALL retain `applyTenantScopeToFilter` and `injectTenantIntoDocument` in `services/adapters/src/mongodb-data-api.mjs:620,655` as active on every document-store read and write operation — so that the application layer remains the authoritative isolation boundary and per-tenant credentials serve as least-privilege auth and audit, not as the sole isolation mechanism.

Evidence: `services/adapters/src/mongodb-data-api.mjs:620` (`applyTenantScopeToFilter`); `services/adapters/src/mongodb-data-api.mjs:655` (`injectTenantIntoDocument`); ADR-14 spike: cross-tenant read succeeds when the app-layer filter is bypassed — the app layer is the only reliable isolation gate at this engine version.

#### Scenario: App-layer filter is applied on every data-api read regardless of per-tenant credential

- **WHEN** a document find or aggregate is issued via the data-api executor
- **THEN** `applyTenantScopeToFilter` MUST inject a `tenantId` predicate before the MongoDB wire-protocol command is issued, in addition to routing the connection via the per-tenant credential

#### Scenario: App-layer stamp is applied on every data-api write regardless of per-tenant credential

- **WHEN** a document insert, update, replace, or bulk-write is issued via the data-api executor
- **THEN** `injectTenantIntoDocument` MUST stamp the `tenantId` field into the document before it is persisted, in addition to routing the connection via the per-tenant credential

### Requirement: Tenant->namespace/collection mapping is preserved at parity with the pre-migration MongoDB model

The system SHALL map each tenant's document collections to the per-tenant DocumentDB logical namespace (`falcone_doc_{tenantId}`) using the same collection names that existed under the shared MongoDB connection — so that the existing `applyTenantScopeToFilter` / `injectTenantIntoDocument` logic operates identically and no data migration is required for collection naming.

Evidence: `services/adapters/src/mongodb-data-api.mjs:620,655` (app-layer scoping uses collection names unchanged from the pre-migration model); ADR-14 spike (logical namespace confirmed as the per-tenant collection container).

#### Scenario: Collection operations target the per-tenant namespace and preserve collection names

- **WHEN** a tenant issues a document insert, find, update, or delete operation via the data-api
- **THEN** the system MUST route the MongoDB wire-protocol request to the tenant's dedicated DocumentDB logical namespace (`falcone_doc_{tenantId}`) using the same collection name that was used under the pre-migration shared MongoDB connection — no collection rename or remapping is applied

### Requirement: Tenant offboarding revokes the per-tenant DocumentDB credential with no orphaned access

The system SHALL, upon tenant offboarding or deletion, issue `db.runCommand({dropUser: 'falcone_doc_{tenantId}'})` over the MongoDB wire protocol and clean up the tenant's collections in the logical namespace — confirming the credential is gone before the tenant record is considered fully purged — so that no orphaned per-tenant DocumentDB credential remains after offboarding.

Evidence: `services/provisioning-orchestrator/src/` (tenant lifecycle and deletion cascade patterns); `apps/control-plane/src/runtime/main.mjs:33-42` (no per-tenant identity revocation exists today).

#### Scenario: Tenant deletion revokes the DocumentDB credential

- **WHEN** the provisioning orchestrator processes a tenant deletion event
- **THEN** the system MUST issue the wire-protocol `dropUser` command for `falcone_doc_{tenantId}` and confirm the Postgres login role no longer exists before the deletion event is marked complete

#### Scenario: Offboarding with no existing DocumentDB credential is a no-op

- **WHEN** the provisioning orchestrator processes a tenant deletion for a tenant that was never provisioned with a DocumentDB credential (e.g., onboarded before this change)
- **THEN** the system MUST complete offboarding cleanly without error — the absence of a per-tenant DocumentDB credential is treated as an already-clean state
