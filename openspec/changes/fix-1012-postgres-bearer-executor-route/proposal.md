# Route Postgres bearer data requests to the executor

## Why

Workspace Postgres data operations declare bearer authentication but route 2005 sends bearer requests to the control plane, which does not serve those operations. Callers receive `404 NO_ROUTE` instead of reaching the executor and its authentication checks.

## What changes

- Add route `2005-data` with URI `/v1/postgres/*`, priority 285, and an anchored URI-variable regex limited to workspace table rows, primary-key operations, both bulk-insert forms, search, and embedding mapping. Forward these paths to the executor even when a bearer token is absent or invalid, so authentication fails at the verifier or executor.
- Copy route 2006's complete verifier and gateway policy: explicit issuer/JWKS bases, tenant audience enforcement, rate limit with rejection code 429, body cap, request validation, correlation headers, and header rewriting. Reject client identity headers with `maxLength: 0`, remove identity and API-key headers, and inject `x-gateway-auth` through the existing `${{GATEWAY_SHARED_SECRET}}` interpolation.
- Preserve route 2005 for database introspection and workspace exports/imports. Preserve higher-priority route `2005-key` and its per-key limit policy for `apikey: flc_...` requests. Structural-write role gates and executor handlers remain unchanged.
- Mirror the standalone route table in the separate deployment repository. Hermes updates both workflow chart pins to the final deployment commit. Source tests check route selection, plugin parity with Mongo, header policy, excluded paths, API-key precedence, and byte parity whenever the deployment chart is available.

## Limits and verification

The bootstrap payload's broad Postgres `dataPlane` setting and contract operations served by neither component remain follow-up work. This change does not reconcile those surfaces or modify unrelated routes.

Run scoped Postgres, Mongo, structural-write, and LLM route regression tests. After the deployment maker and Hermes finish, verify byte-identical standalone files and both workflow pins against that deployment revision. The live bearer/no-token round trip requires the integration environment after #1051; source route-selection tests do not claim live HTTP evidence.

## Rollout and rollback

No source action deploys or syncs the gateway. Before an operator-gated sync, record the live standalone routes ConfigMap SHA256 and compare it with the deterministic render. Preserve ExternalSecrets/OpenBao sourcing and the existing audience reconciliation gates, including staging's enforcement setting. Roll back by reverting this ChangeSet to remove `2005-data`; no data migration is required.
