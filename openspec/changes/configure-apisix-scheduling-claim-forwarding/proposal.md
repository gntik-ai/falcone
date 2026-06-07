## Why

The archived change `derive-scheduling-identity-from-token` (issue #217) made `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity:15-25` fail-closed: it returns `null` — and `main:60-62` converts that to `HTTP 401 / UNAUTHENTICATED` — whenever `params.jwt` is absent or missing `tenantId`/`workspaceId` claims.

The APISIX route at `deploy/apisix/routes/scheduling.yaml:11-14` configures `openid-connect` with `bearer_only: true`, which validates the bearer token signature and expiry. However, it has **no claim-forwarding directive**: there is no `set_access_token_header`, `access_token_in_authorization_header`, `set_userinfo_header`, or equivalent option that decodes the verified token and injects its claims into the upstream OpenWhisk action's `params.jwt` field.

Consequence: with the #217 fix deployed but without gateway claim-injection, `params.jwt` is `undefined` on every scheduling invocation. `parseIdentity` returns `null` for every request, and `main` returns `HTTP 401` before executing any scheduling operation. The scheduling API is entirely non-functional for all authenticated callers (issue #241, P1, bug/security/tenant-isolation).

Grep across `deploy/apisix/routes/` confirms no route performs claim-forwarding; the scheduling route is the only one using `openid-connect`, and it has only the three directives listed above.

This change configures the APISIX `openid-connect` plugin on the scheduling route to forward verified JWT claims into `params.jwt`, completing the fix that #217 began. The action-side fail-closed guard is correct and remains; the gateway config is the missing half.

### Related (out of scope)

`services/webhook-engine/actions/webhook-management.mjs:39-40` and `services/workspace-docs-service/actions/workspace-docs.mjs:57-63` read identity from `params.auth` (a different field, not `params.jwt`). `deploy/apisix/routes/webhooks.yaml:7-9` uses `keycloak-openid: bearer_only: true` with no claim-forwarding either, so the gateway-to-action identity-injection contract is inconsistent and unverified across routes. Auditing and aligning the webhook and workspace-docs routes is a separate effort and is not in scope here.

## What Changes

`deploy/apisix/routes/scheduling.yaml` — the `openid-connect` plugin block (lines 11-14) is extended with the APISIX `openid-connect` claim-forwarding option that decodes the validated bearer token and injects the verified claims (`tenantId`, `workspaceId`, `sub`, `roles`) into the upstream action's `params.jwt` object.

No service source code changes. The action at `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity:15-25` already consumes exactly `params.jwt.tenantId`, `params.jwt.workspaceId`, `params.jwt.sub`, and `params.jwt.roles`. Only the deploy-side YAML route config is missing.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `scheduling`: Gateway claim-forwarding requirement — the API gateway MUST inject verified JWT claims as `params.jwt` into the upstream scheduling action so that `parseIdentity` can derive a scoped identity and all scheduling operations can proceed.

## Impact

- `deploy/apisix/routes/scheduling.yaml:11-14` — MODIFIED (add claim-forwarding directive to `openid-connect` plugin)
- Authenticated scheduling requests that currently return `HTTP 401` will return `HTTP 200` / `201` after this change
- Unauthenticated requests remain rejected at the gateway (`HTTP 401`) before reaching the action
- Predecessor: issue #217 / change `derive-scheduling-identity-from-token` (action-side fail-closed guard)
- This change: issue #241 (gateway-side claim injection — the missing half)
