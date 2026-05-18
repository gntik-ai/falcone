## Why

Four likely bugs in the reprovision applier path of `services/provisioning-orchestrator/` weaken safety guarantees that the transactionality work (`fix-c1-reprovision-transactionality`) assumes. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B4.4** (`identifier-map.mjs:216-250`) — length-descending sort prevents some substring collisions but does not guarantee idempotency under adversarial input and has no cycle detection. A map entry like `{"abc"->"abcd"}` causes recursive replacement until the buffer explodes.
- **B4.5** (`iam-applier.mjs:40-65`) — admin token is fetched on every `kcApi()` call, with no cache. Each reprovision hits the Keycloak token endpoint dozens of times, hammering audit, and every fetch is one more credential-leak surface.
- **B4.6** (`safe-url.mjs:41-44` + `iam-applier.mjs:40-51`) — `safe-url.mjs` permits bare internal HTTP when the caller sets `allowBareInternalHttp=true`; IAM applier sets it for the admin-token request. If the reprovision artifact's `keycloakUrl` is attacker-controlled, the admin-token request leaks to an unauthorised host.
- **B4.7** (`postgres-applier.mjs:156-159`) — `_ident()` correctly handles quote escaping but allows embedded control characters (`\n`, `\0`). Identifier strings with embedded newlines can confuse downstream tooling that reads `pg_catalog` and breaks log scrapers.

## What Changes

- Add cycle detection (max 1 pass; reject if any output contains an unmapped key prefix) and per-call output-length cap to `identifier-map.mjs:applyMapping`.
- Cache the admin token in `iam-applier.mjs` keyed on `(keycloakUrl, realm, clientId)` with a TTL of `expires_in - 30s`; first cache miss fetches, subsequent calls reuse until TTL.
- Tighten `safe-url.mjs:allowBareInternalHttp` so the host must match an explicit allow-list (configured via env, default empty); `iam-applier` MUST resolve `keycloakUrl` against that list rather than blindly trusting artifact input.
- Reject identifier strings in `postgres-applier.mjs:_ident` that contain control characters (`/[\x00-\x1f]/`); add a unit-test for `\n`, `\0`, `\r`.

## Capabilities

### Modified Capabilities

- `tenant-lifecycle`: tightens applier safety around identifier rewriting, admin-token caching, internal HTTP host validation, and PostgreSQL identifier sanitisation.

## Impact

- Affected code: `services/provisioning-orchestrator/src/lib/identifier-map.mjs`, `services/provisioning-orchestrator/src/appliers/iam-applier.mjs`, `services/provisioning-orchestrator/src/http/safe-url.mjs`, `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`.
- Migrations: no schema change.
- Breaking changes: callers that depended on bare internal HTTP without an allow-list will need to set the new env var.
- Out of scope: cross-applier transactionality (B4.1 — `fix-c1-reprovision-transactionality`), lock-release error handling (B4.2 — `fix-c1-reprovision-transactionality`).
