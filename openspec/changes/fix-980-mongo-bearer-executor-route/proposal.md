# Fix Mongo bearer routing to the executor

## Why

Bearer `/v1/mongo/*` requests currently reach a control plane without Mongo handlers, or fail gateway authentication for tenant realms. The executor has the Mongo handlers and already verifies JWT identity and workspace binding.

## What changes

- Route 2006 to the executor. Require `issuer-jwks-auth` before request validation and retain the rate limit, body cap, correlation headers, identity-header stripping, and Secret-backed `x-gateway-auth` injection. Strip `apikey` and `x-api-key` on the bearer route so the executor cannot prefer a smuggled key and bypass the per-key bucket. Leave route 2006-key unchanged.
- Trust every strictly named realm beneath the environment's configured Keycloak issuer base. Fetch keys only beneath the configured JWKS base. Preserve the platform audience rule. With tenant enforcement enabled, require the dedicated tenant data-API audience in `aud` as an exact string or array member; never substitute `azp`. Reject empty or absent audience configuration. Fail closed on malformed tokens, foreign issuers, and JWKS errors.
- Add the `falcone-data-api-audience` OIDC audience mapper to tenant-app clients in both provisioning paths, listing mappers before any POST. Add a dry-run-first reconciliation for existing tenant realms using the same idempotent helper and Secret-backed admin environment.
- Source `KEYCLOAK_ISSUER` and `KEYCLOAK_JWKS_URL` for the executor and the gateway verifier from staging and prod values. No dev issuer may appear in those renders.
- Make the staging `falcone-apisix-standalone` routes ConfigMap chart managed. Render the canonical routes in the release namespace with route 2006 updated and `llmwiki-s2-mongo-jwt` removed. Keep the explicit APISIX plugin list and deterministic Helm rendering.
- Mount the plugin and APISIX config overlay in the kind profile. Gate the change with gateway-policy, route parity, render, Lua, and kind bearer round-trip tests.
- Loading the verifier changes the default and prod APISIX pod configuration as well as staging: the chart adds an explicit plugin list, a config overlay, and a plugin mount. Review APISIX metrics and the rendered `prometheus.enable_export_server` setting during rollout.
- Configuring `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URL`, and `KEYCLOAK_AUDIENCE` enables bearer verification on every executor-served route, including events and functions. Tenant-realm JWKS requests from the executor use the public issuer host, so staging and prod executors need egress to their configured public Keycloak hosts.

## Rollout and rollback

Before the operator-gated staging sync, record the live ConfigMap SHA256 and diff its routes against the render. Staging must retain `gateway.mongoBearer.enforceTenantAudience: false` until reconciliation succeeds. Run `node scripts/backfill-tenant-realm-audience.mjs` for a dry run, then `--apply`, then `--apply` again to prove zero repairs; retain the redacted reports. Only then enable staging enforcement in a values revision and sync it. Prod also requires reconciliation and operator-supplied real hosts before rollout because it inherits default enforcement. Default and kind enforcement are true.

`gateway.mongoBearer.tenantAudience` defaults to `falcone-data-api`. Deployment must set that same value in route 2006 as `tenant_audience` and in the executor ConfigMap as `KEYCLOAK_TENANT_AUDIENCE`, with `KEYCLOAK_ENFORCE_TENANT_AUDIENCE` carrying the enforcement flag. Pass the audience to both provisioning runtimes and reconciliation as well. Provisioning defaults to `falcone-data-api` only when its audience environment variable is absent; an explicitly empty value is rejected. The executor requires an explicitly configured nonempty audience whenever enforcement is true; its absent flag preserves the migration state. Invalid flag values reject startup.

The existing shared executor verifier applies enforcement to all tenant-token executor routes, including events and functions. Only tenant-app clients receive the mapper automatically; console and service-account clients need operator review before using these routes. Do not enable enforcement until all required callers carry the audience. The CI Mongo service-account fixture receives its mapper explicitly.

Verify bearer Mongo traffic and another executor-served data-plane family after the same synced revision removes the staging workaround. Check APISIX plugin loading and metrics, and confirm executor egress to the public Keycloak host. Roll back with `enforceTenantAudience: false` or revert the ChangeSet; the audience mappers may remain. No source work deploys or syncs staging.

## Configuration decision

The operator decision of 2026-10-01 trusts any valid realm name on the environment's Keycloak, so newly provisioned tenant realms require no values update or APISIX restart. The issuer base and JWKS base are explicit configuration; no token field may choose a host. Operator addendum 10 confirms staging's public issuer base as `https://iam.baas.musematic.ai` with no `/auth` prefix and its in-cluster JWKS base as `http://falcone-keycloak:8080`. Prod retains documented placeholders as a release gate until the operator supplies its hosts. The overlay init container must use the separately pinned BusyBox digest from addendum 8 in all profiles, preserving APISIX numeric identities and OpenShift contracts.

Addendum 12 resolves the tenant audience finding in scope. The paired deployment worktree is still at `ef5a926bcfadf3a2e6d9136dd44bda1db221eca6` and needs the Lua schema/verifier, values, ConfigMap, standalone parity and render repairs. Pin state: **pin pending deployment repair**. Both workflow pins remain at that prior head; the next source attempt must set them to the final repaired deployment head. Source canonical routes now include the audience fields; byte parity must be rechecked after the matching chart repair. Release review must also confirm the BusyBox digest exists in the airgap mirror inventory.
