## Why

Three gateway routes ship scope literals or empty scope lists that misrepresent
authorization, and the largest unthrottled surface in the gateway sits in front
of the heaviest service in the repo. From
`openspec/audit/cap-n1-apisix-gateway-configuration.md`:

- **B1** (`services/gateway-config/routes/platform-admin-routes.yaml:8, :10, :30, :32`) —
  the scope literals `platform:admin:backup:read` and `tenant:backup:read` are
  required by `/v1/admin/backup/scope` and `/v1/tenants/*/backup/scope` but appear
  in no `services/keycloak-config/scopes/*.yaml` manifest. No principal can ever
  hold these scopes; every call returns 403.
- **B3** (`services/gateway-config/routes/plan-management-routes.yaml:1-368`) —
  27 routes covering plan CRUD, plan assignment, quota updates, and tenant-plan
  history hit `provisioning-orchestrator` with **zero** `limit-req`/`limit-count`/
  `rate` declarations. The largest service in the repo has no gateway throttle.
- **B4** (`services/gateway-config/routes/backup-operations-routes.yaml:51-54`) —
  `GET /v1/backup/operations/*` declares `required_scopes: []`. Any authenticated
  caller can query any backup operation status.
- **G-S5.1**, **G-S5.2**, **G-S5.3** — same three findings restated as critical gaps.

## What Changes

- Add `platform:admin:backup:read` and `tenant:backup:read` to the canonical
  Keycloak scope manifests under `services/keycloak-config/scopes/` so the
  literals declared in `platform-admin-routes.yaml` resolve to real Keycloak
  scopes that principals can be granted.
- Replace `required_scopes: []` on `backup-operation-get` with the canonical
  `backup-status:read:own` (or `:global` for cross-tenant callers) and add a
  parity scenario for `backup-snapshots-get`.
- Add per-route `limit-req`/`limit-count` declarations to all 27 plan-management
  routes, calibrated against the provisioning-orchestrator capacity profile
  documented under the `control_plane` QoS family in
  `services/gateway-config/base/public-api-routing.yaml`.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: scope literals declared on platform-admin and
  backup-admin routes MUST resolve to Keycloak scope manifests; plan-management
  routes MUST carry rate limits matching the `control_plane` QoS family;
  authenticated reads of backup operations MUST require an explicit scope.

## Impact

- Affected code: `services/gateway-config/routes/platform-admin-routes.yaml`,
  `services/gateway-config/routes/backup-operations-routes.yaml`,
  `services/gateway-config/routes/plan-management-routes.yaml`,
  `services/keycloak-config/scopes/*.yaml`.
- Migration: Keycloak scope manifests get two new entries; operator-driven
  Keycloak setup MUST re-sync after merge so principals can be granted the new
  scopes before the gateway tightens enforcement.
- Breaking changes: callers that today rely on `backup-operation-get`'s open
  access will require a scope grant; today's 403 on platform-admin backup scope
  will start returning 200 for principals who hold the now-declared scope.
- Cross-cutting: complements the B1 Keycloak audit (which found the scope
  manifests are not auto-provisioned today) — operator runbook MUST be updated
  alongside the manifest change.
