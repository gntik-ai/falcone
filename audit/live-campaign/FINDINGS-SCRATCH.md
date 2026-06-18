# Live campaign — running findings scratch (fresh HEAD build, campaign-20260617 / rebuilt)

> Cluster kind test-cluster-b, ns falcone. All app images rebuilt from HEAD; **forced
> fresh pull via imagePullPolicy=Always** after discovering same-tag+IfNotPresent ran stale
> 9h-old images. Fixtures: tenants acme(78848e21…) + globex(fe63fa39…), each owner+alice+bob
> +<slug>-ops (platform-realm, tenant_id, tenant_owner), workspaces app-staging+app-prod
> each with its own wsdb_* PG DB, topics, minted API keys, app end-users.

## CORRECTED — NOT bugs at HEAD (prior campaign's F1/F3/F4/D5 were PRE-FIX / stale-image)
- **F1 cross-tenant api-key issuance IDOR — FIXED.** acme-ops mint key in globex ws → **403
  CROSS_TENANT_VIOLATION** (server.mjs resolveWorkspaceTenant / #517/#534). Was 201 only on the
  stale image.
- **F3 GET /v1/plans — FIXED** → 200 {plans:[]}. plan tables now created by fresh CP schema boot.
- **F4 GET /v1/metrics/tenants/{id}/quotas — FIXED** → 200. quota tables created.
- **D5 CP schema migration no-retry — FIXED at HEAD.** Fresh CP logs `schema ready … (attempt 1)`
  (schema-retry from #535/#536). Stale image had no retry → required restart.
- A2 (console client missing roles scope) and A4 (platform user-profile drops tenant_id) — FIXED:
  bootstrap adds roles/basic/profile default scopes; user-profile declares tenant_id/workspace_id.

## REAL findings (fresh stack)
- **[ISO-1 / P1] Cross-tenant metrics authorization gap.** acme-ops (tenant_owner of acme) →
  GET /v1/metrics/tenants/{globex}/{quotas,overview,usage,series,audit-records} → **200** (expect
  403); also /v1/metrics/workspaces/{globex-ws}/quotas → 200. Tenant/plan routes correctly 403;
  metrics-handlers lack the same tenant-ownership guard. Data empty now (no leak observed) but
  authZ is broken. Evidence above.
- **[BUG-CAPCAT / P2] GET /v1/capability-catalog → 500.** `relation "boolean_capability_catalog"
  does not exist` (capability-catalog-list.mjs). Fresh CP creates plans/quota tables but NOT
  boolean_capability_catalog → schema gap.
- **[DEP-D2 / P2] Keycloak bootstrap Job fails on a cold fresh install.** Job
  falcone-in-falcone-bootstrap → Failed (backoffLimit:1, BackoffLimitExceeded). The bootstrap
  LOGIC works (re-running the pod manually → realm+roles+clients+superadmin provisioned, completes)
  — it fails only because KC isn't Ready on the single retry. Not robust to cold-start race.
- **[DEP-D7 / P2] Vault not a working secrets backend on kind.** vault.enabled=false (campaign);
  enabling it aborts the release (cert-manager absent → vault TLS Certificate CRD missing). No
  Falcone component reads from Vault (envFromSecrets/secretKeyRef only). Vault is the intended
  backend (pre-OpenBao) but is non-viable/unwired on kind.
- **[HARNESS] Image staleness.** Rebuilding with the SAME tag + IfNotPresent runs stale node-cached
  images. Campaign install.sh/executor-demo.yaml must use unique tags or imagePullPolicy=Always.
  (make-secrets.sh also pre-created in-falcone-gateway-shared-secret which the chart now self-manages
  → helm ownership conflict; fixed by letting the chart own it.)
- **[MINOR] Mongo DB provisioning** POST /v1/workspaces/{w}/databases {engine:mongodb} → 400
  "database name is required" (needs databaseName in body; PG engine auto-names). Request-shape.

## Stack-under-test (deploy level)
- FerretDB + DocumentDB pods present; **no MongoDB server** ✓
- SeaweedFS master/volume/filer/s3 present; **no MinIO** ✓
- Knative Serving cluster-wide (functions on-demand); **no OpenWhisk** ✓
- Vault: absent (see DEP-D7) — expected backend, not deployed on kind.
</content>
