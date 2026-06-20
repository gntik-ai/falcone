## ADDED Requirements

### Requirement: Audit records SHALL carry the true action outcome derived at write time

The system SHALL persist an `outcome` field on every `plan_audit_events` row at INSERT time, derived from the HTTP status code of the audited action: `succeeded` when `status < 400`, `denied` when `status === 403`, `failed` when `status >= 400 && status < 500 && status !== 403`, and `error` when `status >= 500`. The system SHALL read `outcome` from the stored column and SHALL NOT hardcode any outcome value at read time. A row written before this change (NULL `outcome`) SHALL be returned with `outcome = 'unknown'`.

#### Scenario: A denied (403) mutating action is recorded with outcome=denied (bbx-audit-outcome-denied)

- **WHEN** an authenticated actor performs a mutating action that the control plane rejects with HTTP 403
- **THEN** a `plan_audit_events` row is written for that action with `outcome = 'denied'`, the row is returned by `GET /v1/metrics/tenants/{id}/audit-records` scoped to the correct tenant, and the `outcome` field in the response is `"denied"` (not `"succeeded"`)

#### Scenario: A failed (4xx) mutating action is recorded with outcome=failed (bbx-audit-outcome-failed)

- **WHEN** an authenticated actor performs a mutating action that the control plane rejects with a 4xx status other than 403
- **THEN** a `plan_audit_events` row is written with `outcome = 'failed'` and the row appears in the tenant's audit records

#### Scenario: A server-error (5xx) mutating action is recorded with outcome=error (bbx-audit-outcome-error)

- **WHEN** an auditable action results in an HTTP 5xx response
- **THEN** a `plan_audit_events` row is written with `outcome = 'error'` and the row appears in the tenant's audit records

#### Scenario: A successful mutating action is recorded with outcome=succeeded from the DB (bbx-audit-outcome-succeeded)

- **WHEN** an authenticated actor performs a mutating action that succeeds (2xx)
- **THEN** a `plan_audit_events` row is written with `outcome = 'succeeded'` read from the stored column, and the value is NOT a compile-time constant injected by `auditRowToRecord`

### Requirement: The audit log SHALL record failed and denied auditable actions

The system SHALL NOT discard audit events for auditable mutating actions that result in HTTP status >= 400. The `auditEventForRoute` function SHALL produce an audit descriptor for any auditable route regardless of response status code. The `scope_enforcement_denials` write path is a separate concern and SHALL remain unchanged.

#### Scenario: The short-circuit for status >= 400 is removed from auditEventForRoute (bbx-audit-no-shortcircuit)

- **WHEN** `auditEventForRoute` is called with an auditable route descriptor and a result whose `statusCode` is 403
- **THEN** it returns a non-null audit event descriptor (with the derived outcome), rather than returning `null`

### Requirement: Secret-access operations SHALL be audited as tenant-scoped audit records

The system SHALL include `secretSet`, `secretGet`, `secretList`, and `secretDelete` in `AUDITABLE_LOCAL_HANDLERS` so that every invocation of those handlers (authenticated, with `ctx.identity` and `ctx.params.workspaceId` available) produces a `plan_audit_events` row scoped to the actor's tenant.

#### Scenario: Writing a workspace secret produces an audit record (bbx-audit-secret-set)

- **WHEN** an authenticated actor calls the `secretSet` handler to write a workspace secret
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-set operation, `tenant_id` equal to the actor's tenant, and the row is returned by `GET /v1/metrics/tenants/{id}/audit-records`

#### Scenario: Reading a workspace secret produces an audit record (bbx-audit-secret-get)

- **WHEN** an authenticated actor calls the `secretGet` handler to read a workspace secret
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-get operation scoped to the actor's tenant

#### Scenario: Listing workspace secrets produces an audit record (bbx-audit-secret-list)

- **WHEN** an authenticated actor calls the `secretList` handler
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-list operation scoped to the actor's tenant

#### Scenario: Deleting a workspace secret produces an audit record (bbx-audit-secret-delete)

- **WHEN** an authenticated actor calls the `secretDelete` handler
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-delete operation scoped to the actor's tenant

### Requirement: The audit log SHALL be tamper-evident via a per-tenant append-only hash chain

The system SHALL add `prev_hash` (TEXT, nullable) and `row_hash` (TEXT, NOT NULL) columns to `plan_audit_events`. For each INSERT the system SHALL, within a single database transaction holding `pg_advisory_xact_lock(hashtext('audit:' || tenantId))`: SELECT the latest `row_hash` for the tenant as `prev_hash` (empty string `''` when no prior row exists), generate `id` and `created_at` in application code before the INSERT so they are included in the hash, compute `row_hash = SHA-256( auditCanonical(id, action_type, actor_id, tenant_id, outcome, created_at, new_state) || prev_hash )` in hex, and INSERT all columns atomically. The system SHALL expose `rowHash` and `prevHash` in the `GET /v1/metrics/tenants/{id}/audit-records` response shape. The system SHALL export from `audit-hash.mjs` the pure functions `auditCanonical(fields)`, `computeRowHash(canonical, prevHash)`, and `verifyAuditChain(rowsAscending) -> { valid, brokenAt }` that operate without side effects and are independently unit-testable.

#### Scenario: Each new audit record links to the previous via prev_hash/row_hash (bbx-audit-hash-chain-link)

- **WHEN** two or more auditable actions are recorded sequentially for the same tenant
- **THEN** each record after the first has `prevHash` equal to the `rowHash` of the immediately preceding record for that tenant, and the first record has `prevHash` equal to `''`

#### Scenario: verifyAuditChain returns valid for an untampered sequence (bbx-audit-hash-verify-valid)

- **WHEN** `verifyAuditChain` is called with an array of audit rows in ascending order that have not been altered
- **THEN** it returns `{ valid: true, brokenAt: null }`

#### Scenario: verifyAuditChain detects a content tamper (bbx-audit-hash-verify-tamper-content)

- **WHEN** `verifyAuditChain` is called with a sequence of rows where one row's `action_type` (or any canonical field) has been modified after the hash was computed
- **THEN** it returns `{ valid: false, brokenAt: <index of the altered row> }`

#### Scenario: verifyAuditChain detects a broken chain link (bbx-audit-hash-verify-tamper-link)

- **WHEN** `verifyAuditChain` is called with a sequence of rows where one row's `prevHash` does not match the preceding row's `rowHash`
- **THEN** it returns `{ valid: false, brokenAt: <index of the row with the broken link> }`

#### Scenario: The hash chain is per-tenant and does not cross tenant boundaries (bbx-audit-hash-per-tenant)

- **WHEN** audit records from two different tenants are interleaved in `plan_audit_events`
- **THEN** `verifyAuditChain` called with only tenant A's rows (ascending) returns `{ valid: true, brokenAt: null }`, confirming the chain is not broken by tenant B's rows

#### Scenario: Genesis record has prevHash of empty string (bbx-audit-hash-genesis)

- **WHEN** the first audit record is written for a tenant
- **THEN** the `prev_hash` column value is `''` and `verifyAuditChain([singleRow])` returns `{ valid: true, brokenAt: null }`
