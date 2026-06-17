# Tasks — fix-platform-client-default-scopes

## Implementation
- [x] The client payloads are rendered by `toPrettyJson` of `.Values.bootstrap.oneShot.keycloak.clients`
  in `templates/bootstrap-payload-configmap.yaml` (not `services/keycloak-config/`, which only holds
  scope YAML) — so the fix is in `values.yaml`.
- [x] Added `roles`, `basic`, `profile` to the `in-falcone-console` client's `defaultClientScopes`
  (ahead of the custom context scopes). The realm does not pin a `clientScopes` list, so Keycloak
  auto-creates the built-in scopes — verified live they exist (see Verification).
- [x] Applied the same to the `in-falcone-gateway` client.
- [x] Added an idempotent `ensure_client_default_scopes` step to the bootstrap script, invoked for
  each provisioned client (`bootstrap.oneShot.keycloak.clients`) with `roles basic profile`. It
  resolves the client + scope UUIDs and PUTs the `default-client-scopes` sub-resource (PUT is a
  no-op when already assigned). Required because `ensure_keycloak_client` is create-only and never
  updates an existing client, so an upgrade of a deployment that lacked the scopes needs the back-fill.

## Verification
- [x] Live kind cluster (cred-free): the platform realm's OIDC discovery `scopes_supported`
  advertises `roles`, `basic`, and `profile` (plus the custom scopes) — so referencing them in the
  client payloads / patch step is valid (Keycloak will not reject a client for an unknown scope, and
  the back-fill's UUID lookup resolves them).
- [x] Rendered both client payloads include `[roles, basic, profile, tenant-context, …]`; the
  bootstrap script defines + invokes `ensure_client_default_scopes` for both clients; `bash -n` OK.
- [x] `bash tests/blackbox/run.sh` → 651/651. New regression:
  `tests/blackbox/platform-client-default-scopes.test.mjs` (3 cases).
- [ ] (Deferred) superadmin-token-contains-roles / `POST /v1/tenants` → 201: needs Keycloak admin
  credentials to mint a token; the auto-mode classifier blocks harvesting them from the shared
  cluster. Campaign already empirically confirmed this (token had only `openid`; adding `roles` →
  superadmin appeared → 403 became 201). Pairs with D2's superadmin-login scenario.

## Archive
- [ ] `/opsx:archive fix-platform-client-default-scopes`
