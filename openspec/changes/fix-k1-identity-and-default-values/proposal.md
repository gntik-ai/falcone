## Why

The workspace-docs service treats identity and configuration as
"soft" inputs — defaulting tenantId to literals, accepting requests with
no API-version pin, and starting up cleanly with missing required env
vars. From `openspec/audit/cap-k1-workspace-docs-service.md`:

- **B3** (`actions/workspace-docs.mjs:69`) — `correlationId` falls back to
  the literal `'corr-missing'`; every request without the header shares
  the same id in audit.
- **B4** (`src/doc-audit.mjs:1`) — `recordAccess(... tenantId='unknown')`;
  if any caller forgets the tenantId, audit records `'unknown'`.
- **B9** (`actions/workspace-docs.mjs:34-40`) — `X-API-Version` is optional;
  only an explicit mismatch is rejected. Inconsistent with C2/J1.
- **B12** (`src/config.mjs:11-12`) — `WORKSPACE_DOCS_DB_URL` and
  `KAFKA_BROKERS` default to empty string/array. Production startup
  succeeds; first DB/Kafka call fails.
- **G1** (cross-cutting) — identity is trusted from `params.auth` with no
  signed-context check; same upstream-trust pattern as F3/H1/I1/J1.
- **G2** (`config.mjs:11-12`) — empty-string fallbacks for required env
  vars; same anti-pattern as J1 B14.
- **G6** (`G-S2.2`) — correlation-id default literal pollutes audit (same
  symptom as B3, broader requirement).
- **G7** (`G-S7.2`) — `recordAccess` default `tenantId: 'unknown'`
  (same as B4, raised to requirement).

## What Changes

- Generate a fresh UUIDv4 correlation id at the action edge when the
  header is absent; never use a literal placeholder.
- Remove the `tenantId='unknown'` default from `recordAccess`; make
  `tenantId` a required parameter that throws if missing.
- Require `X-API-Version: 2026-03-01` on every request; reject missing
  header with `400 UNSUPPORTED_API_VERSION` (aligned with C2/J1).
- Fail-fast at module load if `WORKSPACE_DOCS_DB_URL` or `KAFKA_BROKERS`
  is empty when `NODE_ENV === 'production'`.
- Enforce the signed-context check on `params.auth` so identity is not
  trusted from a raw payload.

## Capabilities

### Modified Capabilities

- `workspace-management`: requirements on correlation-id provenance,
  tenantId provenance, API-version enforcement, and required-env-var
  startup checks.

## Impact

- **Affected code**: `services/workspace-docs-service/actions/workspace-docs.mjs`,
  `services/workspace-docs-service/src/doc-audit.mjs`,
  `services/workspace-docs-service/src/config.mjs`.
- **Migration required**: none.
- **Breaking changes**: clients that omit `X-API-Version` now get 400;
  deployments missing required env vars now fail at boot instead of
  first-call.
- **Cross-cutting**: audit consumers that filtered on `corr-missing` /
  `tenantId='unknown'` to find broken callers will see those keys
  disappear.
