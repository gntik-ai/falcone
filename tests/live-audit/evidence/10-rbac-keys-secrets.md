# Evidence — API keys, RBAC/teams, secrets/config (live)

## API key lifecycle — ACTIVE & enforced

- Issue: `POST /v1/workspaces/{ws}/api-keys` (trust-header admin) → 201 `flc_<type>_…` (anon/service).
- List: `GET /v1/workspaces/{ws}/api-keys` → 200 (key_hash never returned; prefix + scopes + status).
- Revoke: `DELETE /v1/workspaces/{ws}/api-keys/{id}` → 200; **revoked key is then REJECTED** on a data
  call → **401** (verified: key 200 before revoke → 401 after). Enforcement works.
- Guard: an API key trying to manage keys (`POST .../api-keys` with `Authorization: ApiKey`) →
  **403 FORBIDDEN "API keys cannot manage API keys"** (server.mjs gate). Works.
- ⚠ Caveat (see 15-gateway): key issuance itself requires no real auth via the trust-header/gateway
  path — anyone reaching the gateway can mint keys for any tenant (GW-1).

## RBAC / team management — MOSTLY NOT WIRED

- `POST /v1/tenants/{t}/memberships` → **404 NO_ROUTE**; `GET .../memberships/{id}` → 404.
- `POST /v1/tenants/{t}/invitations` → **404 NO_ROUTE**.
- `GET /v1/tenants/{t}/roles` (tenant custom roles) → **404 NO_ROUTE**.
- `GET /api/workspaces/{ws}/privilege-domains` → 400 (wired; needs valid params); `/audit` → 403.
- WIRED: `GET /v1/tenants/{t}/effective-capabilities` → 200; `GET /v1/iam/realms/{realm}/roles` → 200;
  `GET /v1/iam/realms/{realm}/users` → 200 (Keycloak-backed identity mgmt works).
- Net: platform-level **team management (invite users, assign tenant roles, custom RBAC) is not
  deployed** in the live runtime; only Keycloak realm role/user listing is available. Role-based
  access ENFORCEMENT could not be exercised (no way to create a scoped membership via API).

## Secrets / config — NOT DEPLOYED

- Function secrets routes `GET/PUT /v1/functions/workspaces/{ws}/secrets[/{name}]` → **404 NO_ROUTE**.
- **No OpenBao/Vault** pods in the cluster — the secrets/config capability (OpenBao) is not deployed.
- Classify: secrets-as-a-service = not-deployed/in-flight (not a bug).

## Quotas / audit

- Covered in `09-auth-and-governance.md`: plans/quota-limits/quota-audit ACTIVE; **consumption
  measurement BROKEN** (QUOTA-1, `CONSUMPTION_QUERY_FAILED`).

## Status summary

| Functionality | Status |
|---|---|
| API key issue/list/rotate/revoke + guard | Active & enforced |
| API key issuance requires real auth | **Broken** (GW-1, unauth issuance via gateway) |
| Tenant memberships / invitations / custom roles | Not deployed (404) |
| Keycloak realm roles/users | Active |
| Quota limits / audit read | Active |
| Quota consumption measurement | Broken (QUOTA-1) |
| Secrets/config (OpenBao) | Not deployed |
