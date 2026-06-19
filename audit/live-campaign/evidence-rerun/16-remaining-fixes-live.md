# Live verification — remaining-backlog fixes (2026-06-19)

Cluster: kind `test-cluster-b`, ns `falcone`, fresh from-scratch Helm install. Images:
control-plane + cp-executor rebuilt from working tree (the 3 fixes) under tag `head-20260618`;
fn-runtime/web-console/workflow-worker reused unchanged. Method: actual HTTP calls via the APISIX
gateway (`http://localhost:9080`) with real superadmin / tenant_owner (acme-ops) JWTs.

## #595 fix-backup-scope-schema (P1) — PASS
- superadmin `GET /v1/admin/backup/scope` → **200** with the backup-scope matrix
  (`activeProfile:standard`, entries[]). Was **500 `{code:42P01}`** before (table missing).
- acme-ops `GET /v1/tenants/{globex}/backup/scope` → **403** (cross-tenant isolation holds).
- Root cause fixed: added migration 114 to the kind governance bootstrap `GOVERNANCE_MIGRATIONS`.

## #611 add-gateway-realtime-config-identity (P1) — PASS (premise corrected + 2nd bug fixed)
- superadmin `GET /v1/admin/config/format-versions` → **200** (`current_version:1.0.0`, versions[]).
  Was **401 'missing identity headers'** (parseConfigIdentity rejected a superadmin with no tenant).
- no-auth `GET /v1/admin/config/format-versions` → **401** (anti-spoofing invariant preserved).
- acme-ops (tenant_owner) `GET /v1/realtime/workspaces/{OWN ws}/pg-captures` → **200** `{items:[],total:0}`.
  Was **401** (pg-capture-list keyed workspace off a JWT claim the tenant_owner lacks); now keyed off
  the URL path. Then briefly **500 `42P01`** (pg_capture_configs not bootstrapped) — see below.
- acme-ops `GET /v1/realtime/workspaces/{GLOBEX ws}/pg-captures` → **200 `{items:[],total:0}`**
  (tenant-scoped read returns nothing for another tenant's workspace — no cross-tenant leak).
- no-auth pg-captures → **401**.
- 2nd bug found & fixed live: `applyGovernanceSchema` ran the WHOLE migration file including the
  `-- down` rollback, so 080 created then immediately DROPPED pg_capture_configs (boot still
  "succeeded"). Fixed with a forward-only applier (`forwardMigration`, splits at `-- down`) + added
  migration 080 to the governance set. After redeploy: `to_regclass('public.pg_capture_configs')` → `t`.

## #607 add-platform-mcp-http-route (P2) — PASS
- acme-ops `POST /v1/mcp/rpc {initialize}` → **200**:
  `{protocolVersion:"2025-11-25", serverInfo:{name:"falcone-official-mcp",...}}`.
- acme-ops `POST /v1/mcp/rpc {tools/list}` → **200** with the official tool catalog (list_workspaces, …).
- superadmin (no tenant_id claim) → **401 'Missing tenant identity'** — expected: the platform MCP is
  tenant-scoped; a platform operator has no tenant. no-auth → **401**.
- Routed via the gateway (apisix route `2018-mcp` `/v1/mcp/*` → executor); no APISIX change needed.

## Spot-checks of the SUPERSEDED items (confirmed already-resolved on clean HEAD)
- #609 (→ #560): acme-ops `GET /v1/flows/workspaces/{ws}/task-types` → **200**;
  `GET /v1/mcp/workspaces/{ws}/servers` → **200** (both via gateway, not 404).
- #599 (→ #568): acme-ops `GET /v1/tenants/{own}/auth-config` → **200**
  (`registrationAllowed`, `loginWithEmailAllowed`, `identityProviders:[]`); cross-tenant → **403**.
- #610 event→flow (→ #564 + #592): consumer wired + trigger schema present; covered by existing
  black-box + tests/env trigger tests (not re-probed E2E here).

## Not changed (recorded as deferred / by-design)
- #602 pgvector: vector is dedicated-DB-only by design; shared bitnami instance correctly lacks it.
- #608 MCP JSON-RPC protocol, #612 Vault secret consumption: large net-new features, deferred.
