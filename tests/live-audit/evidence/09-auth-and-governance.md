# Evidence — Auth-as-a-service, Keycloak/IAM, plans/quotas/audit (live)

## Keycloak / platform auth — WORKING
- Platform realm `in-falcone-platform`: superadmin ROPC via `in-falcone-console` (public, directGrant)
  yields a token whose `iss=http://falcone-keycloak:8080/realms/in-falcone-platform`; the control-plane
  accepts it (200 on `/v1/tenants`). Token carries realm role `superadmin`, **no** `tenant_id`/`workspace_id`.
- 9 tenants exist; 8 have dedicated `iam_realm` UUIDs (per-tenant realms provisioned). IAM realm user
  listing `GET /v1/iam/realms/{realm}/users` → 200.

## Auth-as-a-service (tenant-app end users) — BROKEN (register works, login fails)
- `GET /v1/auth/signups/policy` → 200 `{selfServiceEnabled:true, mode:"self_service", passwordPolicy:{minLength:8}}`.
- `POST /v1/auth/signups {tenantId,workspaceId,email,password,username}` → **201** `{registrationId,userId,state:"active","Account created. You can now sign in."}`.
- **AAS-1 (HIGH, functional): login fails after signup.**
  `POST /v1/auth/login-sessions {…same creds…}` → **401 `INVALID_CREDENTIALS "Account is not fully set up"`**.
  Direct Keycloak ROPC (`in-falcone-console`, platform realm) → `invalid_grant: "Account is not fully set up"`.
  The user is `enabled:true, emailVerified:true, requiredActions:[]`, and **has a `password` credential** —
  so the block is a realm/required-action/flow misconfig, not a missing password. Net: register→login→token
  is non-functional; tenant apps cannot authenticate their end users.
- **AAS-2 (HIGH, tenant-isolation): end users created in the SHARED platform realm.**
  The signup placed `enduser1` in `in-falcone-platform` (alongside `superadmin`), NOT in the tenant's
  realm `ffd33d99…` (which stayed empty). A prior `newuser-1781093633` is also in the platform realm.
  Per-tenant identity isolation is not applied to self-service end users — all tenants' app users would
  co-mingle in the platform realm with platform admins.
- **AAS-3 (MED): user carries no tenant context.** Created user `attributes:None` — no `tenant_id`, so
  even if login worked, the token couldn't scope the data-plane (executor derives tenant only from the
  `tenant_id` claim). Also: tenant realm `ffd33d99` has no app client with direct-grant (only `admin-cli`).
- **AAS-4 (LOW, completeness): `POST /v1/auth/access-checks` → NO_ROUTE 404** (advertised, unwired).
(Test user cleaned up / deleted.)

## Plans / quotas / governance — MOSTLY ACTIVE, consumption measurement BROKEN
- ACTIVE (200): `/v1/plans`, `/v1/capability-catalog`, `/v1/quota-dimensions`,
  `/v1/tenants/{t}/plan`, `/plan/effective-entitlements`, `/v1/tenants/{t}/effective-capabilities`,
  `/v1/tenants/{t}/quota/effective-limits`, `/quota/overrides`, `/quota/audit`,
  `/v1/tenants/{t}/workspaces/{ws}/consumption`, `/v1/workspaces/{ws}/effective-limits`.
- **QUOTA-1 (MED, functional): consumption/usage is not measured.**
  `GET /v1/tenants/{t}/plan/consumption` → 200 but every dimension is
  `currentUsage:null, usageStatus:"unknown"` with reasons **`NO_QUERY_MAPPING`** (max_api_keys,
  max_mongo_databases) and **`CONSUMPTION_QUERY_FAILED`** (max_functions, max_kafka_topics, max_pg_databases).
  Limits are defined but actual usage isn't computed → usage-based quota enforcement (noisy-neighbor) can't
  fire. Likely tied to the shared-`in_falcone` data-plane wiring (consumption queries target per-workspace
  resources that the runtime doesn't track).
- Completeness gaps: `/v1/tenants/{t}/dashboard` → 404 (advertised, unwired).

## Status summary
| Functionality | Status |
|---|---|
| Platform/superadmin OIDC (control-plane mgmt) | Active |
| Per-tenant realms provisioned | Active (8/9 tenants) |
| IAM realm user listing | Active |
| Auth-as-a-service signup | Active (201) |
| Auth-as-a-service login→token | **Broken** (AAS-1) |
| End-user per-tenant realm isolation | **Broken** (AAS-2) |
| Plans/entitlements/quota limits read | Active |
| Quota consumption measurement | **Broken** (QUOTA-1) |
| Quota audit trail | Active |
