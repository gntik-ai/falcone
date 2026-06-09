CDC capture actions trust unverified JWT payload for tenant identity (cross-tenant write)

**Change ID:** fix-cdc-capture-verify-jwt-identity
**Capability:** change-data-capture
**Type:** bug
**Priority:** P0 (Critical)
**OpenSpec change:** openspec/changes/fix-cdc-capture-verify-jwt-identity/

---

## Why

All eight CDC capture actions (`pg-capture-enable`, `pg-capture-disable`, `pg-capture-list`, `pg-capture-tenant-summary`, and their `mongo-*` counterparts) derive `tenant_id` and `workspace_id` by base64url-decoding the raw Bearer token payload with no signature verification, no issuer/audience check, and no expiry check. An attacker can forge any `tenant_id` in an unsigned token and enable, disable, or enumerate CDC captures for any victim tenant.

## What Changes

- Replace `decodeAuth` (raw base64url decode of JWT payload) in all eight capture actions with identity sourced from trusted gateway-injected headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`), mirroring the pattern in `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`.
- Remove the `decodeAuth` helper from all eight files.
- Any request missing the expected gateway headers is rejected with `401 UNAUTHORIZED` — no behaviour change for requests that pass through the APISIX gateway.
- No API surface change; no new fields added or removed.

---

## Spec delta (EARS)

### Requirement: CDC action identity must derive from gateway-trusted headers only

The system SHALL reject any CDC capture action request whose `x-tenant-id` or `x-workspace-id` header is absent or empty, returning HTTP 401 UNAUTHORIZED, regardless of any Authorization Bearer token content.

#### Scenario: Missing gateway identity headers are rejected

- **WHEN** a caller invokes a CDC capture action (pg-capture-enable, pg-capture-disable, pg-capture-list, pg-capture-tenant-summary, or their mongo-* counterparts) without the gateway-injected `x-tenant-id` and `x-workspace-id` headers
- **THEN** the action returns HTTP 401 with body `{ "code": "UNAUTHORIZED" }` and performs no database read or write

### Requirement: Forged unsigned JWT payload MUST NOT grant cross-tenant capture access

The system SHALL derive tenant scope exclusively from gateway-injected headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`) and SHALL NOT parse or trust any fields from the Authorization Bearer token payload for identity or tenant scoping in CDC capture actions.

#### Scenario: Forged tenant identity in unsigned JWT is ignored (bbx-cdc-forged-tenant)

- **WHEN** a caller presents `Authorization: Bearer <base64url({"tenant_id":"ten_VICTIM","workspace_id":"wrk_VICTIM","sub":"attacker"})>` (an unsigned, unverified token) to `pg-capture-enable` along with valid `data_source_ref` and `table_name`, and the gateway headers carry the caller's own `x-tenant-id`
- **THEN** the action does NOT create a capture record under `ten_VICTIM`, does NOT return HTTP 201 scoped to the victim tenant, and the forged `tenant_id` value in the token payload is never used as the data-scoping identity

### Requirement: CDC capture actions MUST scope all data operations to the gateway-provided tenant

The system SHALL use the `x-tenant-id` and `x-workspace-id` header values — not any Authorization token field — as the `tenant_id` and `workspace_id` for all database creates, reads, and writes performed by CDC capture actions.

#### Scenario: Create is scoped to the gateway-provided tenant identity

- **WHEN** a caller with valid gateway headers (`x-tenant-id: ten_A`, `x-workspace-id: wrk_A`) successfully invokes `pg-capture-enable`
- **THEN** the created capture record has `tenant_id = ten_A` and `workspace_id = wrk_A`, and the response body reflects those values

---

## Tasks

### 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-cdc-forged-tenant` to `tests/blackbox/` that invokes `pg-capture-enable` with a forged unsigned JWT payload carrying `tenant_id: "ten_VICTIM"` and asserts the response is NOT a 201 scoped to the victim tenant
- [ ] 1.2 Confirm the test fails (red) against the current unpatched code before proceeding

### 2. Implement the Fix

- [ ] 2.1 Extract a shared `parseIdentity(params)` helper (or copy the scheduling-engine pattern) that reads `x-tenant-id`, `x-workspace-id`, `x-auth-subject` from `params.__ow_headers` and returns `null` when any required header is absent
- [ ] 2.2 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs`
- [ ] 2.3 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs`
- [ ] 2.4 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs`
- [ ] 2.5 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs`
- [ ] 2.6 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-enable.mjs`
- [ ] 2.7 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-disable.mjs`
- [ ] 2.8 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-list.mjs`
- [ ] 2.9 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-tenant-summary.mjs`
- [ ] 2.10 Delete or remove the `decodeAuth` local function from all eight files

### 3. Verify

- [ ] 3.1 Confirm `bbx-cdc-forged-tenant` test now passes (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

---

## Acceptance criteria

**bbx-cdc-forged-tenant**: a caller presenting a forged unsigned JWT with `tenant_id: "ten_VICTIM"` to `pg-capture-enable` (or any of the 7 sibling actions) receives a response that is NOT a 201 scoped to the victim tenant, and no capture record is created under that tenant.

---

## Code evidence

- `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs::decodeAuth` — lines 8-11: `JSON.parse(Buffer.from(header.slice(7), 'base64url').toString('utf8'))` with no signature or claim verification
- `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs` — lines 14-20: `tenantId = claims.tenant_id` derived from unverified payload used directly in `configRepo.create()`
- `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-enable.mjs::decodeAuth` — same pattern confirmed
- 6 additional sibling files (`pg/mongo-capture-disable.mjs`, `pg/mongo-capture-list.mjs`, `pg/mongo-capture-tenant-summary.mjs`) share the same `decodeAuth` pattern
- **Reference (correct pattern):** `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` — lines 21-41: reads `x-tenant-id`, `x-workspace-id`, `x-auth-subject` from trusted gateway headers, never touches the Authorization token payload
- **Gateway evidence:** `services/gateway-config/base/public-api-routing.yaml:211-218` — APISIX already injects `X-Tenant-Id`/`X-Workspace-Id` headers from the verified token

---

## Resolution (OpenSpec)

1. `/opsx:apply fix-cdc-capture-verify-jwt-identity` — implement the fix following tasks.md
2. `/opsx:verify fix-cdc-capture-verify-jwt-identity` — run the verify profile
3. `bash tests/blackbox/run.sh` — confirm green
4. `/opsx:archive fix-cdc-capture-verify-jwt-identity` — sync delta into openspec/specs/ and archive the change

Or use the wrapper: `/fix-bug fix-cdc-capture-verify-jwt-identity`

Optional real E2E: `/e2e-issue fix-cdc-capture-verify-jwt-identity`
