## Context

This is a deploy-configuration change only. No service source code is modified. The action at `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity:15-25` already reads from `params.jwt` and returns `null` when claims are absent. The APISIX route at `deploy/apisix/routes/scheduling.yaml:11-14` validates the bearer token but currently has no directive to decode and forward the verified claims to the upstream action.

## Goals / Non-Goals

**Goals:**

- Add the APISIX `openid-connect` claim-forwarding configuration to `deploy/apisix/routes/scheduling.yaml` so that validated JWT claims are injected as `params.jwt` into every upstream OpenWhisk action invocation on the scheduling route.
- Restore end-to-end functionality for authenticated scheduling requests (HTTP 200/201) while preserving the fail-closed rejection (HTTP 401) for unauthenticated or invalid requests.

**Non-Goals:**

- Modifying `scheduling-management.mjs` — the action-side fix is complete and archived (change `derive-scheduling-identity-from-token`, issue #217).
- Aligning the `params.auth` contract used by `webhook-management.mjs` and `workspace-docs.mjs` — that is a separate audit item.
- Changing Keycloak realm or client configuration.

## Decisions

### Claim-forwarding mechanism

The APISIX `openid-connect` plugin supports injecting the decoded access-token payload into an upstream header via the `access_token_in_authorization_header` option (which passes the raw bearer token) or by enabling `set_userinfo_header` / `set_access_token_header`. For OpenWhisk-style actions that receive the HTTP request body as `params`, the standard approach is to configure the plugin to set the decoded token as a request header (e.g., `X-JWT-Claims`) and have the action proxy deserialize it into `params.jwt`. Alternatively, some APISIX deployments use a proxy-side transformation plugin (e.g., `serverless-pre-function` or `openfunction`) to map the decoded token into the action params body.

The concrete directive to add is the `set_access_token_header` option (or the equivalent for this deployment's APISIX version). The exact option name and value must be confirmed against the APISIX version pinned in the deployment (`deploy/apisix/` manifests). The implementation task is to add this directive under the `openid-connect` block in `deploy/apisix/routes/scheduling.yaml` so that the gateway writes the decoded, verified claims into the field the action reads as `params.jwt`.

### Upstream action contract

`parseIdentity` (`scheduling-management.mjs:15-25`) reads:

- `params.jwt.tenantId`
- `params.jwt.workspaceId`
- `params.jwt.sub` (falls back to `'system'` when absent)
- `params.jwt.roles` (falls back to `[]` when absent)

The token issued by Keycloak must carry `tenantId` and `workspaceId` as custom claims. The gateway forwards those claims verbatim. No transformation of claim names is required beyond what Keycloak already provides.

### End-to-end verification approach

1. Deploy the updated `scheduling.yaml` to a test environment with a live Keycloak and APISIX instance.
2. Obtain a valid access token for a test tenant (tenant A, workspace W1).
3. Issue `GET /v1/scheduling/jobs` with the token and assert HTTP 200 and an empty or populated job list scoped to A/W1.
4. Issue `POST /v1/scheduling/jobs` with the token and a valid body; assert HTTP 201 and that the created job has `tenant_id=A`, `workspace_id=W1` in the database.
5. Issue `GET /v1/scheduling/jobs` without a token; assert HTTP 401 from the gateway (no action invocation).
6. Issue a request with a tampered/expired token; assert HTTP 401 from the gateway.

## Risks / Trade-offs

- **Deploy-config scope**: This change is purely YAML — there is no unit-testable artifact in the service source. Verification requires a running APISIX + Keycloak stack (real-stack E2E or an integration environment).
- **APISIX version sensitivity**: The exact plugin option name for claim-forwarding varies across APISIX versions. The implementer must verify the correct option against the pinned version before committing the YAML.
- **Keycloak claim availability**: `tenantId` and `workspaceId` must already be present as custom claims in the Keycloak token. If they are not, the gateway change alone will not restore functionality — Keycloak mapper configuration would also be required (out of scope for this change).
