## 1. Baseline

- [ ] T01 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] T02 Confirm `openspec validate add-app-api-keys --strict` passes

## 2. Black-box tests (write first — red before green)

- [ ] T03 Write fixture: two workspaces (W1, W2) under the same tenant; W1 has at least one RLS policy stub so ANON key issuance is not blocked by the RLS pre-check
- [ ] T04 Write black-box test: mint ANON key for W1 — response contains plain-text key; a second GET of the credential record does not contain the plain-text value
- [ ] T05 Write black-box test: mint SERVICE key for W1 — same one-time secret assertion
- [ ] T06 Write black-box test: valid ANON key on a data route resolves to `X-Actor-Roles: anon` and `X-Tenant-Id` / `X-Workspace-Id` matching W1
- [ ] T07 Write black-box test: valid SERVICE key resolves to `X-Actor-Roles: service_role`
- [ ] T08 Write black-box test: unknown key on a data route returns 401
- [ ] T09 Write black-box test: ANON key read returns only W1 rows; W2 rows are absent (cross-workspace isolation)
- [ ] T10 Write black-box test: ANON key call to a route requiring a scope absent from the ANON scope set returns 403
- [ ] T11 Write black-box test: SERVICE key with full scope set on the same route succeeds
- [ ] T12 Write black-box test: revoke the ANON key; subsequent request with that key returns 401
- [ ] T13 Write black-box test: rotate the SERVICE key — new plain-text key returned; old key returns 401; new key returns 200
- [ ] T14 Write black-box test: requests beyond the per-key `rateLimitBudget` within the window return 429; requests within budget succeed
- [ ] T15 Write black-box test: plain-text key value does not appear in any audit event emitted during mint or rotate
- [ ] T16 Confirm all new tests fail before implementation (red-green discipline)

## 3. Database migration

- [ ] T17 Write migration `services/provisioning-orchestrator/src/migrations/121-workspace-api-keys.sql` with table `workspace_api_keys` (id UUID PK, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_type TEXT NOT NULL CHECK (key_type IN ('anon', 'service')), scopes JSONB NOT NULL DEFAULT '[]', rate_limit_budget INTEGER NOT NULL DEFAULT 1000, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL)
- [ ] T18 Add index `idx_wak_hash` on `workspace_api_keys(key_hash)` WHERE `revoked_at IS NULL` for fast gateway lookup
- [ ] T19 Add index `idx_wak_workspace` on `workspace_api_keys(tenant_id, workspace_id)` for list/revoke-all operations

## 4. Control-plane key store

- [ ] T20 Implement `mintApiKey(workspaceId, tenantId, keyType, scopes, rateLimitBudget)` in a new `apps/control-plane/src/app-credentials.mjs` module: generate 32-byte random key with prefix (`anon_` or `svc_`), SHA-256 hash, persist hash to `workspace_api_keys`, return plain-text once
- [ ] T21 Implement `revokeApiKey(keyId, workspaceId, tenantId)`: set `revoked_at = NOW()`; call APISIX admin API to purge the consumer cache entry
- [ ] T22 Implement `rotateApiKey(keyId, workspaceId, tenantId)`: atomically revoke the old key and mint a new one in a single transaction; return the new plain-text key
- [ ] T23 Implement `lookupApiKey(keyHash)`: return key record if `revoked_at IS NULL`; null otherwise (used by the APISIX Lua lookup and by tests)
- [ ] T24 Add RLS pre-check in `mintApiKey`: if `keyType === 'anon'` and no RLS policy exists for the workspace, return error with `code: ANON_KEY_REQUIRES_RLS`

## 5. Workflow integration

- [ ] T25 Wire `apps/control-plane/src/workflows/wf-con-006-service-account.mjs` `create` action to call `mintApiKey` instead of `keycloakAdmin.createServiceAccount`
- [ ] T26 Wire `rotate` action to call `rotateApiKey`
- [ ] T27 Wire `deactivate`/`delete` actions to call `revokeApiKey`
- [ ] T28 Update credential-issuance, credential-rotations, credential-revocations request/response schemas in `apps/control-plane/openapi/families/workspaces.openapi.json` to include `keyType`, `rateLimitBudget`, and the one-time `secretKey` field (write-once, never returned again)

## 6. Gateway key-auth wiring

- [ ] T29 Add `key_auth` as a valid `authMode` alongside `bearer_oidc` on data routes (`/v1/db`, `/v1/storage`, `/v1/functions`, `/v1/events`) in `services/gateway-config/base/public-api-routing.yaml`
- [ ] T30 Add a Lua serverless-post-function plugin that, on key-auth success, queries `workspace_api_keys` by hash (via `lookupApiKey`), then sets `ngx.req.set_header` for `X-Tenant-Id`, `X-Workspace-Id`, `X-Auth-Scopes`, `X-Actor-Roles`
- [ ] T31 Enable `SCOPE_ENFORCEMENT_ENABLED` per-route for the data/event routes (route-level override, not global flag flip)
- [ ] T32 Add a `per_key` `qosProfile` entry in `services/gateway-config/base/public-api-routing.yaml` using `limitKey: apikey` and `limit-count` plugin; assign it to data/event routes when `authMode: key_auth`

## 7. Integration validation

- [ ] T33 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [ ] T34 Run `openspec validate add-app-api-keys --strict`
