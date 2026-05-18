# Capability N1 — APISIX Gateway Configuration

**Source locus:** `services/gateway-config/` — **23 files, ~2458 LOC** split across:

| Subdir | Files | LOC | Role |
|---|---|---|---|
| `base/` | gateway.yaml, public-api-routing.yaml | 516 | ConfigMap + family routing baseline (15 families, 9 QoS profiles, 8 timeout profiles, 9 validation profiles) |
| `plugins/` | capability-enforcement.lua, scope-enforcement.lua, credential-rotation-header.yaml | 568 | Two APISIX Lua plugins + 1 plugin config |
| `routes/` | 8 YAMLs | 825 | APISIX route declarations (backup-admin/audit/operations/status, capability gates, plan-mgmt, platform-admin, workspace-capability-catalog) |
| `openapi-fragments/` | 4 files | (not deep-read) | Fragment OpenAPI specs |
| `tests/` | 1 mjs + 2 lua | 351 | Capability-enforcement unit tests + 2 Lua scope-enforcement specs |
| Top-level | README, public-route-catalog.json, helm/values.yaml | 188 | 11-LOC README, 32-entry route catalog mapping path → privilege_domain |

**Method.** Read `README.md`, `base/gateway.yaml` (18 LOC), `base/public-api-routing.yaml` (498 LOC — the family routing manifest), `helm/values.yaml`, `tests/capability-enforcement.test.mjs`, `public-route-catalog.json`, and `plugins/credential-rotation-header.yaml` myself. Delegated two parallel Explore agents — one for the two Lua plugins (539 LOC), one for all 8 route YAMLs (825 LOC). After agents returned, **spot-verified six damaging claims**, **corrected one** (the Lua precedence claim at scope-enforcement.lua:36 — the subagent misread Lua's operator precedence; the line is actually correct, but the trust-claim issue remains).

**Up-front observations:**
- The capability is a **declarative configuration layer**: APISIX runtime is not in source (the chart deploys APISIX itself; this directory ships only routes, plugins, and a family manifest).
- `base/public-api-routing.yaml` is the **most coherent contract artifact in the repo** so far: 15 API families with consistent `tenantBinding`, `workspaceBinding`, `qosProfile`, `requestValidationProfile`, `planCapabilityAnyOf` declarations.
- BUT: the route YAMLs in `routes/` don't reference any of those family profiles — they each independently declare scopes, rate limits, and upstreams. **Two parallel configuration systems for the same gateway.**
- The two Lua plugins (capability-enforcement, scope-enforcement) are the runtime guard logic. Both default to disabled (`SCOPE_ENFORCEMENT_ENABLED:-false`, `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED: "false"`).
- **No `package.json`** in this directory; the JS test (`capability-enforcement.test.mjs`) runs on `node --test` from somewhere else.

---

## SPEC (what exists)

### S1. Top-level config (`base/gateway.yaml`, helm `values.yaml`)

- **WHEN** the gateway ConfigMap is rendered, **THE SYSTEM SHALL** publish `GATEWAY_MODE=managed`, `GATEWAY_PORT=8080`, `PUBLIC_DOMAIN_ROOT=in-falcone.example.com`, base paths `/control-plane, /v1, /auth, /realtime`, route-catalog path `/v1/platform/route-catalog`, optional workspace-subdomain template, TLS via `existingSecret` (`base/gateway.yaml:1-19`, verified-by-author).
- **WHEN** the helm overlay is applied, **THE SYSTEM SHALL** ship `scopeEnforcement.enabled: false` and `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED: "false"` as defaults; both plugins are off out-of-the-box (`helm/values.yaml:1-12`, verified-by-author).
- **WHEN** Kafka topics for privilege-domain audit are configured, **THE SYSTEM SHALL** default to `console.security.privilege-domain-{denied,assigned,revoked}` and `console.security.last-admin-guard-triggered` (`helm/values.yaml:8-11`).

### S2. Public API family manifest (`base/public-api-routing.yaml`, 498 LOC)

- **WHEN** the manifest is loaded, **THE SYSTEM SHALL** declare API version `2026-03-26`, `X-API-Version` header pin, `X-Correlation-Id` correlation (generated when missing), `Idempotency-Key` required for `POST|PUT|PATCH|DELETE` with 24h TTL + body hash, `ErrorResponse` envelope with 8 required fields (`status, code, message, detail, requestId, correlationId, timestamp, resource`) (`base/public-api-routing.yaml:5-39`, verified-by-author).
- **WHEN** timeout profiles are applied, **THE SYSTEM SHALL** offer 8: `control_plane (3/15/20s), provisioning (3/20/30s), observability (3/10/15s), event_gateway (3/15/75s), realtime (3/15/75s), native_admin (3/15/25s)` (`:40-64`).
- **WHEN** retry profiles are applied, **THE SYSTEM SHALL** offer `safe_reads (1 retry on 502/503/504)`, `mutations (0 retries)`, `native_admin (0 retries)` (`:65-80`).
- **WHEN** request-validation profiles are applied, **THE SYSTEM SHALL** offer 9 profiles enforcing per-family content types, body-size caps (65 KB–1 MB), idempotency-on-mutations, and `rejectSpoofedContextHeaders: true` (`:81-135`).
- **WHEN** QoS profiles are applied, **THE SYSTEM SHALL** offer 9 profiles with per-class rate limits (30 req/min for `native_admin` to 300 req/min for `observability`) and burst (10–80) (`:136-190`).
- **WHEN** internal requests cross the gateway boundary, **THE SYSTEM SHALL** require 5 internal-attestation headers (`X-Gateway-Managed-Route, X-Correlation-Id, X-Request-Id, X-Internal-Request-Mode, X-Internal-Request-Timestamp`) (`:191-199`).
- **WHEN** the 15 API families are declared, **THE SYSTEM SHALL** project for each: `id, pathPrefix, upstreamService, routeClass, authMode, discoveryEnabled, corsProfile, allowAnonymousOptions, tenantBinding, workspaceBinding, propagatedHeaders, qosProfile, requestValidationProfile, planCapabilityAnyOf` (`:200-438`).
- **WHEN** propagating identity headers, **THE SYSTEM SHALL** forward `{X-Auth-Subject, X-Actor-Username, X-Tenant-Id, X-Workspace-Id, X-Plan-Id, X-Auth-Scopes, X-Actor-Roles}` (`:211-218` anchor `&a1`).
- **WHEN** scope-enforcement is enabled, **THE SYSTEM SHALL** cache scope requirements for 60s and plan entitlements for 30s by default (`:468-472`).
- **WHEN** the family-level `publicRoutes` is consulted, **THE SYSTEM SHALL** include `/health` (`authMode: none`) plus 3 explicit `/v1/realtime/.../mongo-captures/*` routes (`:473-498`).

### S3. Capability-enforcement plugin (`plugins/capability-enforcement.lua`, 237 LOC)

- **WHEN** the plugin runs in `access` phase (priority 2850), **THE SYSTEM SHALL** load `capability_gates` YAML from `CAPABILITY_GATED_ROUTES_PATH` env, index by `${method}:${path}`, and match exact then wildcard (`*` → `[^/]+`) (`plugins/capability-enforcement.lua:32-64`, subagent-reported).
- **WHEN** `CAPABILITY_ENFORCEMENT_ENABLED` env is `false`, **THE SYSTEM SHALL** short-circuit before any audit (`:151-153`).
- **WHEN** the gate matches but JWT claims are missing or `tenant_id` is absent, **THE SYSTEM SHALL** return `403 GW_CAPABILITY_NOT_ENTITLED` with `reason: plan_restriction` (`:172-177`).
- **WHEN** capabilities are not cached for the tenant, **THE SYSTEM SHALL** resolve via `capability_resolution_url`, cache for `cache_ttl_seconds ?? 120s` with max `cache_max_entries ?? 500`; failed resolution returns `503 GW_CAPABILITY_RESOLUTION_DEGRADED` if `deny_on_resolution_failure ?? true`, else emergency-pass (`:181-204, :189-199`).
- **WHEN** capability not in the resolved map, **THE SYSTEM SHALL** return `403 GW_CAPABILITY_NOT_ENTITLED` with `upgradePath ?? "/plans/upgrade"` (`:220-226`).
- **WHEN** the deny payload is built, **THE SYSTEM SHALL** return `{status, code, message, detail, requestId, correlationId, timestamp, resource, retryable}` JSON (`:78-91`).
- **WHEN** audit / metrics emission fires, **THE SYSTEM SHALL** use `ngx.timer` fire-and-forget to `audit_sidecar_url` (`:93-125, :127-133`).

### S4. Scope-enforcement plugin (`plugins/scope-enforcement.lua`, 302 LOC)

- **WHEN** the plugin runs in `access` phase (priority 2900), **THE SYSTEM SHALL** accept config `{required_scopes[], required_entitlements[], workspace_scoped: true}` (`plugins/scope-enforcement.lua:10-17`).
- **WHEN** extracting claims from `ctx.var.jwt_claims | ctx.jwt_auth_payload | ctx.authenticated_consumer.claims`, **THE SYSTEM SHALL** parse `scope|scp` (string-split or array), and project `{workspace_id, tenant_id, plan_id, role, actor_id (sub|client_id|'anonymous'), actor_type ?? 'user', privilege_domain, function_subdomains}` (verified-by-author at `:35-49`).
- **WHEN** claims are missing, **THE SYSTEM SHALL** return `401 UNAUTHENTICATED` (`:259-261`).
- **WHEN** the endpoint has no declared scope requirement, **THE SYSTEM SHALL** return `403 CONFIG_ERROR` (`:263-268`).
- **WHEN** any `required_scopes` is absent, **THE SYSTEM SHALL** return `403 SCOPE_INSUFFICIENT` (`:270-274`).
- **WHEN** `workspace_scoped == true` and `requested_workspace_id ≠ claims.workspace_id` and actor is not platform_admin, **THE SYSTEM SHALL** return `403 WORKSPACE_SCOPE_MISMATCH` (`:276-282`).
- **WHEN** `required_entitlements` is set and `ctx.scope_plan_entitlements` doesn't satisfy, **THE SYSTEM SHALL** return `403 PLAN_ENTITLEMENT_DENIED` (`:284-289`).
- **WHEN** `evaluate_privilege_domain` runs, **THE SYSTEM SHALL** read `claims.role == "platform_admin"` as bypass (verified-by-author at `:163`), look up required-domain from cache via `fetch_endpoint_privilege_domain` (always returns `nil` — see B3), and return `403 PRIVILEGE_DOMAIN_MISMATCH` if `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=true` and mismatch (`:154-205`).
- **WHEN** `evaluate_function_subdomain` runs, **THE SYSTEM SHALL** check claims' subdomains against required and return `403 FUNCTION_PRIVILEGE_MISMATCH` (`:207-251`).
- **WHEN** all checks pass, **THE SYSTEM SHALL** set headers `X-Enforcement-Verified=true, X-Verified-Tenant-Id, X-Verified-Workspace-Id` (`:297-299`).
- **WHEN** any denial fires, **THE SYSTEM SHALL** emit a denial event via `ngx.timer` (fire-and-forget) (`:91-104, :181-193, :224-241`).

### S5. Route declarations (8 YAML files, 825 LOC)

- **WHEN** backup-admin routes are loaded, **THE SYSTEM SHALL** declare 8 routes under `/v1/admin/tenants/*/config/*` plus `/v1/admin/config/format-versions`, all gated on scope `platform:admin:config:export` or `platform:admin:config:reprovision`, rate-limited 3–30 req/s, targeting `openwhisk-tenant-config-*` upstreams (`backup-admin-routes.yaml:2-200`, subagent-reported).
- **WHEN** backup-audit route loads, **THE SYSTEM SHALL** declare `GET /v1/backup/audit` gated on `backup-audit:read:own`, rate 20/s, upstream `openwhisk-query-audit` (`backup-audit-routes.yaml:1-16`).
- **WHEN** backup-operations routes load, **THE SYSTEM SHALL** declare 4 routes (`backup-trigger POST, backup-restore POST, backup-operation-get GET, backup-snapshots-get GET`) with scopes `backup:write:own, backup:restore:global, [], backup-status:read:global` respectively (`backup-operations-routes.yaml:2-79`).
- **WHEN** backup-status routes load, **THE SYSTEM SHALL** declare `GET /v1/backup/status` gated on `backup-status:read:own`, rate 10/s; plus a method-not-allowed catch-all for POST/PUT/DELETE/PATCH returning 405 (`backup-status-routes.yaml:2-42`).
- **WHEN** capability-gating manifest is consumed, **THE SYSTEM SHALL** declare 5 capabilities (`webhooks, realtime, sql_admin_api, passthrough_admin, functions_public`) mapping to path patterns; no upstream — interpreted by the capability-enforcement plugin (`capability-gated-routes.yaml:15-43`, subagent-reported).
- **WHEN** plan-management routes load, **THE SYSTEM SHALL** declare 27 routes for plan CRUD, plan lifecycle/limits/quota, quota dimensions, tenant-plan-management, self-tenant plan, workspace consumption; **all targeting `provisioning-orchestrator`; ALL WITHOUT rate limits** (verified-by-author at `plan-management-routes.yaml:1-368`, confirmed by absence of `limit-req`/`limit-count`/`rate` keys in grep).
- **WHEN** platform-admin routes load, **THE SYSTEM SHALL** declare `GET /v1/admin/backup/scope` (`platform:admin:backup:read` + `[superadmin, sre]`) and `GET /v1/tenants/*/backup/scope` (`tenant:backup:read`), both at 30/s, both upstream `provisioning-orchestrator`, both with `kafka-logger` and `scope-enforcement` plugins (`platform-admin-routes.yaml:1-42`, verified-by-author for scope names).
- **WHEN** workspace-capability-catalog routes load, **THE SYSTEM SHALL** declare two routes (`GET /v1/workspaces/:workspaceId/capability-catalog[/{capabilityId}]`) with `workspace-scope-enforcement` plugin and no explicit `required_scopes`, no rate limit (`workspace-capability-catalog.yaml:1-35`).

### S6. Public-route catalog (`public-route-catalog.json`, 32 entries)

- **WHEN** the catalog is loaded, **THE SYSTEM SHALL** classify 32 routes into `privilege_domain ∈ {structural_admin, data_access}` plus optional `function_privilege_subdomain ∈ {function_deployment}` (verified-by-author at `public-route-catalog.json:1-166`).
- **WHEN** `POST /v1/functions/{id}/invoke` is classified, **THE SYSTEM SHALL** carry both `privilege_domain: data_access` and `function_privilege_subdomain: function_deployment` (`:146-150`).

### S7. Credential-rotation header plugin (`plugins/credential-rotation-header.yaml`)

- **WHEN** an upstream sets `X-Credential-Rotation-State: rotating_deprecated`, **THE SYSTEM SHALL** add response header `Credential-Deprecated: true; expires=$expires_at` via a serverless-post-function (`plugins/credential-rotation-header.yaml:1-29`, verified-by-author).

---

## GAPS

### G-cross. Cross-cutting

1. **Two parallel configuration systems for the same gateway.** `base/public-api-routing.yaml` declares 15 API families with QoS/validation/auth profiles, but the 8 route YAMLs under `routes/` independently declare scopes, rate limits, and upstreams without referencing those family profiles. Operators must keep both aligned manually.
2. **No `package.json` in this directory.** The `tests/capability-enforcement.test.mjs` runs on `node --test` but the dependency wiring is upstream (per A1-pattern repo).
3. **Both plugins ship disabled by default.** `helm/values.yaml:1, :5` set `scopeEnforcement.enabled: false` and `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED: "false"`. A production deployment that doesn't override these flips runs without scope enforcement and without privilege-domain enforcement.
4. **Audit topics defined in `helm/values.yaml` (B1 audit cross-reference).** Per B1, `superadmin` is checked as a scope literal in several places, but it's actually a realm role. Same pattern likely affects scope-enforcement's use of `claims.role == "platform_admin"`.
5. **Capability gates declared but no APISIX route maps them.** `capability-gated-routes.yaml:15-43` lists 5 gates (`webhooks`, `realtime`, `sql_admin_api`, `passthrough_admin`, `functions_public`). The capability-enforcement plugin consumes this manifest, but per the F2/H1 audits, no APISIX route in the umbrella chart wires the underlying paths (`/v1/workspaces/*/webhooks*`, `/v1/workspaces/*/realtime*`, `/v1/functions/*/invoke`). Gating policy applies to routes that don't exist.

### G-S2. Family manifest

- **G-S2.1** `base/public-api-routing.yaml:469` reads `scope-enforcement.enabled: ${SCOPE_ENFORCEMENT_ENABLED:-false}` — disabled by default.
- **G-S2.2** Routes under `routes/` don't reference family `qosProfile` / `requestValidationProfile` — they declare their own rate limits ad-hoc. The family manifest's profiles are advisory only.
- **G-S2.3** `propagatedHeaders` anchor `&a1` (`:211-218`) lists 7 headers. `allowedRequestHeaders` anchor `&a2` (`:439-446`) lists 6 (no `X-Plan-Id`, no `X-Auth-Subject`, etc.). Inconsistent header allow-list vs propagation list.
- **G-S2.4** The 15 family declarations all set `allowAnonymousOptions: true` (CORS preflight bypass). No family disables it.
- **G-S2.5** Three `mongo-captures` routes in `publicRoutes` (`:480-498`) are declared at family-level but the gateway route table under `charts/in-falcone/values.yaml` also declares mongo-captures routes (per F2 audit `2014/2015`). Risk of overlap if both are deployed.

### G-S3. Capability-enforcement plugin

- **G-S3.1** Route map loaded once per worker, no hot-reload (subagent-reported `:155-159`).
- **G-S3.2** Emergency-pass when `deny_on_resolution_failure=false` has no audit event (subagent-reported `:189-199`).
- **G-S3.3** Cache TTL is fixed per-tenant; no selective invalidation (subagent-reported `:204`).
- **G-S3.4** No validation that resolved capability key matches what the route requires; empty map fails closed but unexplained.
- **G-S3.5** Route-map key `(method or "*") .. ":" .. (path or "")` (verified-by-author at `:43`) is vulnerable to colon-in-path collisions; APISIX paths don't typically contain `:` outside path templates, but radixtree allows them — see B6.

### G-S4. Scope-enforcement plugin

- **G-S4.1 CRITICAL** **`fetch_endpoint_privilege_domain` and `fetch_endpoint_function_subdomain` are stubs that `return nil`** (verified-by-author at `:120-128`). Without these, the `evaluate_privilege_domain` / `evaluate_function_subdomain` functions cannot look up required-domains. With `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false` (default) they short-circuit; with it enabled, they hit the `if required_domain == nil then if enforcement_enabled then return 403 CONFIG_ERROR` branch — meaning **with enforcement enabled, every privilege-domain check returns 403**. See B2.
- **G-S4.2** Platform-admin role check uses exact string `"platform_admin"` (verified-by-author at `:163`); no case normalization. `'Platform_Admin'` would bypass-fail. Plus, per B1 capability audit, `platform_admin` is a Keycloak realm role propagated via `$jwt_claim_realm_access_roles` — but this plugin reads `claims.role` directly. See B5.
- **G-S4.3** `ctx.scope_plan_entitlements` populated by an unspecified upstream filter (subagent-reported `:284`). No documentation; likely empty in practice.
- **G-S4.4** `ctx.var.http_x_api_key_domain` header trusted as credential domain (subagent-reported `:157`). An attacker controlling a downstream forwarding hop could set it.
- **G-S4.5** Function-subdomain enforcement returns early if `required_subdomain == nil` (subagent-reported `:212`). Unclassified routes pass with no audit.

### G-S5. Route declarations

- **G-S5.1 CRITICAL** **All 27 plan-management routes have NO rate limits** (verified-by-author by grep). 368 LOC of unthrottled provisioning-orchestrator hits — plan-create, plan-assign, quota-set, tenant-plan-history, etc.
- **G-S5.2 CRITICAL** **Scope literals `platform:admin:backup:read` and `tenant:backup:read` are not declared in any Keycloak scope manifest** (verified-by-author by grep — they appear in `platform-admin-routes.yaml:8, :10, :30, :32` but NOT in `services/keycloak-config/scopes/*.yaml`). Per B1 audit, those YAML manifests don't propagate to Keycloak anyway (they're dead config) — but if any operator-driven Keycloak setup uses them, these two scopes are simply missing.
- **G-S5.3 CRITICAL** **`backup-operation-get` has `required_scopes: []`** (verified-by-author at `backup-operations-routes.yaml:53`). Authenticated user may query any operation status regardless of scope.
- **G-S5.4** `backup-audit-routes.yaml:6` uses plugin name `openid-connect`; other route files use `keycloak-openid-connect`. Plugin-name drift.
- **G-S5.5** `capability-gated-routes.yaml` is a manifest for the capability-enforcement plugin, not an APISIX route file. The gated paths require APISIX routes elsewhere — per cross-reference G-cross.5, those routes don't exist in the umbrella chart for some gates.
- **G-S5.6** Tenant wildcard routes (`/v1/admin/tenants/*/config/...`, `/v1/tenants/*/backup/scope`) use `*` for any tenant. No APISIX-level tenant-binding check; relies on upstream service to enforce isolation.
- **G-S5.7** `workspace-capability-catalog.yaml:1-35` declares two routes with `workspace-scope-enforcement` plugin and no explicit `required_scopes`. The plugin (per the C2 audit) may infer scopes from elsewhere — undocumented contract.
- **G-S5.8** Backup-status method-not-allowed route (`backup-status-routes.yaml:28-42`) maps POST/PUT/DELETE/PATCH to `/v1/backup/status` with no upstream — returns 405 by absence. Working but redundant with APISIX's automatic 405 generation.

### G-S6. Public-route catalog

- **G-S6.1** 32 routes catalogued; covers structural_admin and data_access. Doesn't cover the 16 metrics routes (per M4 audit), the 8 backup routes, the webhooks/realtime/sql_admin gates, or the function-invoke routes. **Catalog is incomplete relative to the surface declared in `apps/control-plane/openapi/`.**
- **G-S6.2** No version field; no rev hash; no last-updated date. Catalogue can drift silently.

### G-tests

- **G-T1** `tests/capability-enforcement.test.mjs` is a JS re-implementation of the Lua plugin's logic, not a Lua execution test. Coverage is for the algorithm; the actual Lua code path is exercised only by the two Lua specs under `tests/plugins/`.
- **G-T2** No tests for the route YAML schemas — operator could ship a YAML with `required_scopes: 'string'` instead of array, and nothing rejects it.
- **G-T3** No test asserts that scopes referenced in routes exist in the keycloak-config manifests.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. Platform-admin route scopes `platform:admin:backup:read` and `tenant:backup:read` are not declared in any Keycloak scope manifest.**
  Verified by grep: `services/gateway-config/routes/platform-admin-routes.yaml:8, :10, :30, :32` reference these scopes. `grep "platform:admin:backup:read\|tenant:backup:read" services/keycloak-config/scopes/*.yaml` returns no matches. Combined with the B1 capability audit (which found the keycloak-config/scopes/ YAMLs are dead anyway — nothing provisions them to Keycloak), these routes' scope checks have no Keycloak-side definition to match against. End result: authenticated users with no such scope get 403 on `/v1/admin/backup/scope` and `/v1/tenants/*/backup/scope`.

- **B2. `scope-enforcement.lua` privilege-domain and function-subdomain endpoint classifiers are stubs that return nil.**
  Verified by direct read of `:120-128`:
  ```lua
  function _M.fetch_endpoint_privilege_domain(_, _) return nil end
  function _M.fetch_endpoint_function_subdomain(_, _) return nil end
  ```
  With `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=true`, every route hits the `if required_domain == nil then if enforcement_enabled then return 403 CONFIG_ERROR` branch (`:154-205`). The default helm value is `"false"`, so the plugin is shipped permissively. **If an operator turns enforcement on, the entire surface 403s with `CONFIG_ERROR`** because no endpoint classifier is wired.

- **B3. `plan-management-routes.yaml` has zero rate-limited routes.**
  Verified by grep: 368 LOC, 27 routes, **0 `limit-req`/`limit-count`/`rate` declarations**. Plan creation, plan assignment, quota updates, tenant-plan history queries are all unthrottled against the provisioning-orchestrator upstream. Per the C1 audit, that upstream is the largest service in the repo (5117 LOC across 74 actions) — DoS-easy.

- **B4. `backup-operation-get` has `required_scopes: []`.**
  Verified by direct read of `backup-operations-routes.yaml:51-54`:
  ```yaml
  keycloak-openid-connect:
    enabled: true
    required_scopes: []
  ```
  Any authenticated caller can `GET /v1/backup/operations/*`. The B1 audit catalogued `backup-status:read:own` and `backup-status:read:global` as the relevant scopes; neither is enforced here.

- **B5. `scope-enforcement.lua` checks `claims.role == "platform_admin"` as exact-string scope literal.**
  Verified at `:163` — exact-string comparison, no case normalization, no realm-role lookup. Per the B1 capability audit, realm roles like `platform_admin` are propagated via `$jwt_claim_realm_access_roles` (separate JWT claim), not the `claims.role` field. The plugin reads the wrong claim path. Cross-references the L1 audit B1 finding (`superadmin` checked as scope literal in backup-status code).

- **B6. `capability-enforcement.lua` route-key construction allows colon-in-path collision.**
  Verified at `:43`: `local key = (route.method or "*") .. ":" .. (route.path or "")`. If a path contains `:` (APISIX radixtree accepts colons in path templates like `/v1/secrets/{domain}/{path}` per M3 audit), the key delimiter becomes ambiguous: `POST:/v1/secrets/colon:/path` vs `POST:/v1/secrets/colon` + `:/path` are distinguishable but the colon-as-key-separator parsing later in any lookup is brittle. Today's routes don't use literal colons; the bug is latent.

- **B7. Both APISIX plugins ship disabled by default.**
  `helm/values.yaml:1, :5` (verified-by-author): `scopeEnforcement.enabled: false`, `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED: "false"`. A fresh deploy runs without scope enforcement and without privilege-domain enforcement. Operators must explicitly flip both. Combined with B2 (with privilege-domain enforcement flipped on, the entire surface 403s), there's a chicken-and-egg: leave it off and lose enforcement; turn it on and lose the API.

- **B8. Plugin name drift between route files.**
  `backup-audit-routes.yaml:6` uses `openid-connect` (verified-by-author by reading); the other backup route files use `keycloak-openid-connect`. APISIX has both as separately-named plugins. If the two have different default behaviour (e.g., scope claim mapping, discovery), the backup-audit route silently differs from siblings.

- **B9. Capability gates declared but matching APISIX routes don't exist for some.**
  `capability-gated-routes.yaml:15-43` (verified-by-author) declares 5 gates. Per F2 audit and H1 audit: `/v1/workspaces/*/realtime*` and `/v1/functions/*/invoke` paths are not in the umbrella chart's APISIX route table. Gates that match no route are dead policy; clients hitting those paths get 404 from APISIX, never reaching the gate.

- **B10. Family `requestValidationProfile.rejectSpoofedContextHeaders: true` is declared but never enforced by source code in this directory.**
  `base/public-api-routing.yaml:88, :93, :99, …` (verified-by-author). The flag is profile metadata. No plugin in `plugins/` reads it. Reliance on APISIX core or a missing third plugin to act on the flag.

### Likely (smells, fail-open or unverifiable)

- **B11. JWT claims trusted as-is in both plugins.**
  `scope-enforcement.lua:35-49` and `capability-enforcement.lua:66-76` (subagent-reported). Both extract claims from `ctx.var.jwt_claims | ctx.jwt_auth_payload | ctx.authenticated_consumer.claims` without verifying the JWT signature. Trusts that an upstream plugin (`keycloak-openid-connect`) has validated. If that plugin is misconfigured or disabled per-route, claims are forgeable.

- **B12. `extract_workspace_id()` (scope-enforcement.lua:66) uses naive regex on URI.**
  Subagent-reported. First-match semantics; query-param/header bypass is in principle possible if downstream code uses anywhere-in-request workspace id.

- **B13. Capability-enforcement HTTP error handling treats all non-200 as resolution failure.**
  Subagent-reported `:141-143`. 404 (endpoint not found), 401 (bad credentials), 500 (server error) all conflate to one "resolution failure" path with the same `503 GW_CAPABILITY_RESOLUTION_DEGRADED` response. Operators can't distinguish causes.

- **B14. `X-Auth-Scopes` and `X-Actor-Roles` headers propagated to upstream but `allowedRequestHeaders` (`base/public-api-routing.yaml:439-446`) doesn't include them.**
  Asymmetric inbound vs internal-propagation lists. CORS preflight + downstream contracts may diverge.

- **B15. `tests/capability-enforcement.test.mjs` is a JS port of the Lua plugin.**
  Verified by direct read (`createCapabilityEnforcement()` is a JS shim). The actual Lua code path is not exercised by this test. The JS shim's behaviour might diverge from the Lua original; only the Lua specs under `tests/plugins/` exercise the real code.

- **B16. Workspace-scope check bypassed when claims missing workspace_id.**
  `scope-enforcement.lua:278` (subagent-reported). If the JWT has no `workspace_id`, the workspace check silently skips (no audit, no denial). Combined with B11 (claims trusted), an attacker forging a JWT with no workspace_id reaches the upstream without a workspace check.

- **B17. Function-subdomain enforcement skipped if `required_subdomain == nil`.**
  Subagent-reported `:212`. Same root cause as B2; combined with the stubs, no function privilege subdomain ever gets enforced.

### Needs verification

- **B18. Wildcard pattern conversion `route_path:gsub("%*", "[^/]+")` (capability-enforcement.lua:59).**
  Subagent flagged as path-traversal risk. `[^/]+` is "one-or-more non-slash chars" — doesn't permit `../` because `..` doesn't contain `/`. The pattern is actually safe at the regex level; the question is whether the underlying APISIX route allows the path before this gate fires. Verify.

- **B19. Whether the `audit_sidecar_url` config is set anywhere in the helm chart.**
  `capability-enforcement.lua:93-125` posts audit events to this URL. If the helm chart doesn't set it, audit is silently dropped.

- **B20. Whether the lua-resty-jwt module that `scope-enforcement.lua` indirectly relies on actually verifies JWT signature.**
  The plugin reads claims from APISIX context; APISIX's `keycloak-openid-connect` plugin should verify. Confirm against the deployed plugin chain.

- **B21. Whether `Idempotency-Key` body-hashing is implemented anywhere.**
  `base/public-api-routing.yaml:25` declares `hashRequestBody: true` for the idempotency header policy. No code in this directory implements it. Verify against APISIX runtime.

---

## Scope note for downstream spec authoring

N1 is the gateway's source-of-truth — but it spreads truth across two configuration systems (family manifest + ad-hoc route YAMLs) that don't reference each other. Six must-fix items before any OpenSpec proposal:

1. **B1 — Scope literals not in Keycloak manifests** (`platform:admin:backup:read`, `tenant:backup:read`). Either add them to the keycloak-config/scopes/ YAMLs (and resolve the B1 capability audit's finding that those YAMLs are dead anyway), or remove the routes' scope requirements.
2. **B2 — Privilege-domain enforcement is unusable.** Implement `fetch_endpoint_privilege_domain` / `fetch_endpoint_function_subdomain` or remove the enforcement codepath. Today, turning the feature on makes the entire surface 403.
3. **B3 — Plan-management routes need rate limits.** 27 unthrottled provisioning-orchestrator routes is a DoS surface.
4. **B4 — `backup-operation-get` empty `required_scopes`.** One-line fix.
5. **B7 — Both plugins ship disabled.** Decide whether they should be on by default; if on, fix B2 first.
6. **B9 — Capability gates without routes.** Either remove the dead gates or wire the missing routes via the umbrella chart (cross-referenced with F2, H1 audits).

Secondary: B5 (role-vs-scope conflation), B6 (route-key colon collision), B8 (plugin name drift), B10 (rejectSpoofedContextHeaders unenforced), B11/B12 (JWT trust + workspace extraction), B14 (header allow-list asymmetry).

After those, N1 becomes the cleanest API-policy contract in the repo (the family manifest is genuinely well-organised). But the route YAMLs and the family manifest need a single source of truth for QoS, validation, and security profiles.
