# tenant-isolation Specification

## Purpose
TBD - created by archiving change add-rls-enforced-tenant-migrations. Update Purpose after archive.
## Requirements
### Requirement: RLS enabled on all tenant-scoped service tables

The system SHALL enable Row-Level Security (`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`) on every tenant-scoped table in the webhook-engine, scheduling-engine, realtime-gateway, and provisioning-orchestrator services.

#### Scenario: Direct query without tenant context is blocked by RLS

- **WHEN** a database session issues `SELECT * FROM scheduled_jobs` without setting `app.tenant_id`
- **THEN** the database MUST return zero rows (policy denies access) rather than returning rows from all tenants

#### Scenario: Query with correct tenant context returns only that tenant's rows

- **WHEN** a database session sets `app.tenant_id = 'ten_A'` and issues `SELECT * FROM scheduled_jobs`
- **THEN** the database MUST return only rows where `tenant_id = 'ten_A'`

### Requirement: RLS policies block cross-tenant leakage even when application predicate is omitted

The system SHALL ensure that omitting a `WHERE tenant_id = $1` predicate in an application query does not result in cross-tenant data disclosure, because the RLS policy enforces the same constraint at the database level.

#### Scenario: Forgotten WHERE tenant_id predicate is blocked by RLS policy

- **WHEN** an application query omits the `tenant_id` predicate on a table that has an RLS policy bound to `current_setting('app.tenant_id')`
- **THEN** the database MUST silently filter the result set to only rows matching the session's `app.tenant_id`, equivalent to having included the predicate

#### Scenario: Cross-tenant probe is blocked end-to-end

- **WHEN** tenant A's session (with `app.tenant_id = 'ten_A'`) attempts to read a row known to belong to tenant B
- **THEN** the query MUST return zero rows and MUST NOT expose any tenant-B data

### Requirement: Legitimate superuser and sweep paths continue to function

The system SHALL allow designated superuser / migration-runner sessions to bypass RLS via `BYPASSRLS` privilege or an explicit wildcard sentinel setting, so orphan-sweep and cross-tenant administrative actions are not broken.

#### Scenario: Superuser session with BYPASSRLS reads all tenant rows

- **WHEN** a database session with the `BYPASSRLS` privilege (or the migration runner role) issues an unscoped query
- **THEN** the database MUST return all rows across all tenants, unfiltered by the RLS policy

#### Scenario: Normal application role cannot bypass RLS

- **WHEN** an application service role (without `BYPASSRLS`) issues a query without setting `app.tenant_id`
- **THEN** the database MUST return zero rows and MUST NOT expose any tenant data

### Requirement: KNN query result set is bounded to the authenticated tenant by RLS

The system SHALL execute every KNN similarity search under the non-BYPASSRLS
`falcone_app` application role (consistent with the existing RLS architecture described
in the `tenant-isolation` spec) and SHALL ensure that the RLS policy on the vector
table filters candidate rows BEFORE the pgvector distance ranking step, so that a
tenant's KNN query NEVER returns vectors belonging to a different tenant even if those
vectors are numerically closer to the query than any of the tenant's own vectors.

#### Scenario: Cross-tenant KNN probe returns only tenant-A rows

- **WHEN** tenant A and tenant B each have rows in the same Postgres table with a
  `vector` column, and tenant A issues a KNN search whose query vector is geometrically
  nearest to a row owned by tenant B
- **THEN** the response contains only rows whose `tenant_id` matches tenant A;
  no tenant B row appears in the response, and the `distance` values reflect ranking
  among tenant A's rows exclusively

#### Scenario: KNN query executed under non-BYPASSRLS role cannot see other-tenant rows

- **WHEN** the KNN plan executor acquires the database connection under the
  non-BYPASSRLS `falcone_app` role and issues
  `SELECT … ORDER BY embedding <=> $queryVector LIMIT k`
  without an explicit `WHERE tenant_id = $1` predicate
- **THEN** the active RLS policy (bound to `current_setting('app.current_tenant_id')`)
  prevents any row from another tenant from entering the candidate set, and the
  result set contains at most k rows all belonging to the session tenant

#### Scenario: Absent tenant session setting produces zero rows rather than a cross-tenant leak

- **WHEN** the `app.current_tenant_id` session variable is unset or empty at the time
  a KNN query is executed under the application role
- **THEN** the RLS policy returns zero rows, consistent with the existing RLS
  fail-closed policy described in the tenant-isolation spec, and no data from any
  tenant is disclosed

### Requirement: Temporal visibility queries are always bounded to the authenticated tenant

The system SHALL ensure that no Temporal visibility query (list executions, count executions, or any search against the Temporal visibility store) can return executions belonging to a different tenant, even when a caller crafts query parameters that attempt to remove, broaden, or override the server-injected `tenantId` search-attribute filter. The enforcement mechanism MUST be server-side and MUST NOT rely on clients supplying correct filter values.

#### Scenario: Injected search-attribute filter cannot be overridden by client query parameters

- **WHEN** an authenticated tenant-A caller submits a list-executions request whose query string contains a `query` or `filter` parameter that omits or contradicts the `tenantId = A` constraint
- **THEN** the system MUST overwrite any client-supplied tenantId filter with the value derived from the authenticated identity and MUST return only tenant A's executions

#### Scenario: Absent tenantId search attribute produces zero results rather than a cross-tenant leak

- **WHEN** a Temporal visibility query is issued without a `tenantId` search-attribute constraint (for example due to a code path that omits the filter)
- **THEN** the system MUST treat this as a fail-closed condition — returning zero results — consistent with the RLS fail-closed policy defined in this spec for Postgres-backed tables

### Requirement: Workflow IDs whose tenant prefix does not match the caller are treated as non-existent

The system SHALL intercept any describe, history, signal, cancel, or retry request whose workflow ID prefix (the `tenantId` component of `{tenantId}:{workspaceId}:{flowId}:{runUuid}`) does not equal the caller's authenticated `tenantId`, and MUST return HTTP 404 without forwarding the request to Temporal, so that the existence of another tenant's workflow is never disclosed.

#### Scenario: Mis-prefixed workflow ID is intercepted before reaching Temporal

- **WHEN** tenant A's authenticated session submits a describe-execution request with a workflow ID whose prefix is `tenantB:`
- **THEN** the system MUST return HTTP 404 and MUST NOT issue any Temporal RPC call, so that Temporal's own error messages (which might confirm or deny existence) are never exposed to tenant A

### Requirement: Per-tenant storage credentials enforce cross-tenant denial at the SeaweedFS S3 layer

The system SHALL ensure that each tenant's SeaweedFS S3 identity is scoped exclusively to that tenant's bucket(s) so that cross-tenant access is denied by SeaweedFS at the S3 authentication/authorisation layer — not only by application-layer guards — meaning that a key issued for Tenant A's workspace is cryptographically incapable of accessing Tenant B's bucket even if the application layer is bypassed or misconfigured.

Evidence: `deploy/kind/control-plane/storage-handlers.mjs:13-14` (today all tenants share a single root credential — a shared credential cannot enforce per-tenant bucket isolation at the S3 layer); `services/adapters/src/storage-access-policy.mjs` (in-process policy engine, never serialised to a SeaweedFS backend); `services/adapters/src/storage-tenant-context.mjs:465-469` (`provisionWorkspaceStorageBoundary` stub — no real identity is ever created).

#### Scenario: Cross-tenant probe — Tenant A's key is rejected for Tenant B's bucket

- **WHEN** Tenant A has an active SeaweedFS S3 identity scoped to bucket `ten-a-ws-1` and issues an S3 `GetObject` request targeting bucket `ten-b-ws-1` (owned by Tenant B) using Tenant A's `accessKey`/`secretKey`
- **THEN** SeaweedFS MUST return an S3 `AccessDenied` error for that request — the denial MUST originate from SeaweedFS identity/bucket scoping, not from any application-layer filter

#### Scenario: Tenant A's key cannot list Tenant B's bucket contents

- **WHEN** Tenant A's S3 identity is provisioned with `buckets: ["ten-a-ws-1"]` and Tenant A issues an S3 `ListObjectsV2` against `ten-b-ws-1`
- **THEN** SeaweedFS MUST return `AccessDenied` and MUST NOT return any object keys belonging to Tenant B's bucket

#### Scenario: Absent or empty bucket scoping is rejected at identity write time

- **WHEN** the SeaweedFS IAM client attempts to write a new S3 identity with an empty `buckets` list or a wildcard (`*`) bucket entry
- **THEN** the system MUST reject the identity write with a configuration error before issuing the `s3.configure` call, so that an improperly scoped identity is never created

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

