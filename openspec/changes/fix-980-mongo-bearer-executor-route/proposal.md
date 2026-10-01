# Fix Mongo bearer routing to the executor

## Why

Bearer `/v1/mongo/*` requests currently reach a control plane without Mongo handlers, or fail gateway authentication for tenant realms. The executor has the Mongo handlers and already verifies JWT identity and workspace binding.

## What changes

- Route 2006 to the executor. Require `issuer-jwks-auth` before request validation and retain the rate limit, body cap, correlation headers, identity-header stripping, and Secret-backed `x-gateway-auth` injection. Strip `apikey` and `x-api-key` on the bearer route so the executor cannot prefer a smuggled key and bypass the per-key bucket. Leave route 2006-key unchanged.
- Trust every strictly named realm beneath the environment's configured Keycloak issuer base. Fetch keys only beneath the configured JWKS base. Enforce the configured audience for the platform realm; tenant realm tokens use their issuer as the trust boundary. Fail closed on malformed tokens, foreign issuers, and JWKS errors.
- Source `KEYCLOAK_ISSUER` and `KEYCLOAK_JWKS_URL` for the executor and the gateway verifier from staging and prod values. No dev issuer may appear in those renders.
- Make the staging `falcone-apisix-standalone` routes ConfigMap chart managed. Render the canonical routes in the release namespace with route 2006 updated and `llmwiki-s2-mongo-jwt` removed. Keep the explicit APISIX plugin list and deterministic Helm rendering.
- Mount the plugin and APISIX config overlay in the kind profile. Gate the change with gateway-policy, route parity, render, Lua, and kind bearer round-trip tests.
- Loading the verifier changes the default and prod APISIX pod configuration as well as staging: the chart adds an explicit plugin list, a config overlay, and a plugin mount. Review APISIX metrics and the rendered `prometheus.enable_export_server` setting during rollout.
- Configuring `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URL`, and `KEYCLOAK_AUDIENCE` enables bearer verification on every executor-served route, including events and functions. Tenant-realm JWKS requests from the executor use the public issuer host, so staging and prod executors need egress to their configured public Keycloak hosts.

## Rollout and rollback

Before the operator-gated staging sync, record the live ConfigMap SHA256 and diff its routes against the render. Verify bearer Mongo traffic and another executor-served data-plane family after the same synced revision removes the staging workaround. Check APISIX plugin loading and metrics, and confirm executor egress to the public Keycloak host. Reverting the ChangeSet restores the previous ConfigMap; route 2006-key remains independent. No source work deploys or syncs staging.

## Configuration decision

The operator decision of 2026-10-01 trusts any valid realm name on the environment's Keycloak, so newly provisioned tenant realms require no values update or APISIX restart. The issuer base and JWKS base are explicit configuration; no token field may choose a host. Operator addendum 10 confirms staging's public issuer base as `https://iam.baas.musematic.ai` with no `/auth` prefix and its in-cluster JWKS base as `http://falcone-keycloak:8080`. Prod retains documented placeholders until the operator supplies its hosts. The overlay init container must use the separately pinned BusyBox digest from addendum 8 in all four profiles, preserving APISIX numeric identities and OpenShift contracts. The preceding deployment ChangeSet head is `ac1e66a401acc62e09337920980c39233b5eaad6`; its airgap repair selects the same BusyBox digest under `registry.airgap.in-falcone.local`. Pin state: **pin pending deployment repair**. Both workflow pins stay at that head while the deployment maker mirrors the source bearer route's API-key header removal into standalone routes and Helm values. Once those repairs are final, a subsequent source attempt must pin both workflows to the new deployment head and pass route parity. Release review must still confirm the digest is present in the airgap mirror inventory.
