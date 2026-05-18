## Why

The storage adapter has a cluster of correctness and safety smells around
credential redaction, provider catalog integrity, error-code stability, and
schema drift. Individually each is a smell; together they undermine the
adapter's auditability and operational hygiene. From
`openspec/audit/cap-g1-object-storage-adapter.md`:

- **B5** (`storage-provider-verification.mjs:241-260`) — verification fixtures
  use deterministic tenant ids `ten_verification_${providerType}`; same
  provider always generates the same tenantId, so multi-tenant verification
  runs collide.
- **B9** (`storage-error-taxonomy.mjs:196-199`) — credential redaction regex
  `(access|secret|password)[-_ ]?key\s*[:=]\s*\S+` misses `accesskey:sk_1234`
  (no word boundary), base64-encoded secrets, and JSON-embedded secrets.
- **B10** (`storage-error-taxonomy.mjs:202-215`) — `buildInternalDiagnostics`
  sanitises `providerMessage` but copies `providerHttpStatus` raw; rare
  status codes can carry information.
- **B11** (`provider-catalog.mjs` selectionKeys) — selectionKeys are not
  validated for collisions at runtime; a future alias clash silently
  overrides.
- **B13** (`storage-programmatic-credentials.mjs:86-114, :273`) — rotation
  copies scopes without re-validating; if `workspaceId === null` on both
  sides, the scope binding can be lost.
- **B14** (`storage-import-export.mjs:108, :265`) — catch blocks re-throw as
  `INVALID_OBJECT_KEY`, swallowing the original error context.
- **B16** (`storage-error-taxonomy.mjs:167-173`) — provider-error
  normalisation strips non-alphanumerics; `NO_SUCH_KEY` and `NOSUCHKEY`
  collapse, but unintended new codes could too.
- **B17** (`storage-tenant-context.mjs:207-227`) — `capabilityDetails`
  copied 1:1 from provider profile to tenant context with no version guard.
- **G5** (`storage-provider-verification.mjs:241-260`), **G8** (regex
  incompleteness), **G9** (HTTP status leak), **G13** (selectionKeys
  collision risk), **G34** (rotation scope validation).

## What Changes

- Stamp verification fixture tenant ids with a per-run nonce
  (`ten_verification_${providerType}_${runId}`) so multi-tenant verification
  runs don't collide.
- Replace the redaction regex with a token-driven sanitiser that handles
  word-boundary-free patterns, base64 secrets (length+entropy heuristic),
  and JSON-embedded values for known sensitive keys.
- Mask `providerHttpStatus` outside the documented set
  `{200, 400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504}`,
  reducing it to a coarse bucket.
- Add startup validation in `provider-catalog.mjs` that asserts no two
  provider definitions share a selectionKey; throw on collision.
- Re-validate scope on rotation in `storage-programmatic-credentials.mjs`;
  refuse to rotate when `workspaceId` collapses to null on either side.
- Preserve original error context in `storage-import-export.mjs` catch blocks
  via `cause` chaining; do not re-throw as `INVALID_OBJECT_KEY` when the
  cause was a different validation.
- Add an allowlist for provider-error code normalisation so only the known
  alias set collapses; new codes pass through verbatim.
- Add a `capabilityDetailsSchemaVersion` field on the tenant context record
  and reject upstream provider profiles whose schema version differs.

## Capabilities

### Modified Capabilities

- `data-services`: requirements covering credential redaction completeness,
  HTTP-status masking, provider-catalog integrity, programmatic-credential
  rotation safety, import/export error context, error-code normalisation
  stability, and capability-details schema versioning.

## Impact

- **Affected code**: `services/adapters/src/storage-provider-verification.mjs`
  (`:241-260`, `:156-159`), `services/adapters/src/storage-error-taxonomy.mjs`
  (`:167-215`), `services/adapters/src/provider-catalog.mjs` (selectionKeys),
  `services/adapters/src/storage-programmatic-credentials.mjs` (`:86-114, :273`),
  `services/adapters/src/storage-import-export.mjs` (`:108, :265`),
  `services/adapters/src/storage-tenant-context.mjs` (`:207-227`).
- **Migration required**: none in storage; the new
  `capabilityDetailsSchemaVersion` is additive on the tenant-context record.
- **Breaking changes**: rotations that previously copied null-scope
  credentials will now fail; operators must explicitly re-issue. Provider
  profiles with mismatched `capabilityDetailsSchemaVersion` will be rejected.
- **Out of scope**: presigned URL signing (covered by
  `fix-g1-presigned-url-signature`); access-policy multi-source evaluation
  (covered by `fix-g1-access-policy-fallthrough`); audit-emission wiring
  (covered by `fix-g1-audit-emission-wiring`).
