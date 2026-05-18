## Why

The SDK builder and the spec-regenerate trigger ship without tenant-ownership
checks, allowing cross-tenant reads of specs and SDK download URLs and
permitting arbitrary URLs to be baked into the published OpenAPI document.
From `openspec/audit/cap-j1-openapi-sdk-builder.md`:

- **B2** (`services/openapi-sdk-service/actions/sdk-generate.mjs:68`) —
  `getCurrentSpec(pool, workspaceId)` filters by `workspace_id` only. A
  caller carrying `x-auth-tenant-id: T_A` but a `workspaceId` belonging to
  `T_B` reads `T_B`'s spec and generates an SDK; the resulting
  `workspace_sdk_packages` row stores `T_A`'s tenant id, misattributing
  ownership.
- **B4** (`sdk-generate.mjs:35`) — same defect on the status endpoint; any
  caller can read another tenant's SDK download URL.
- **B9** (`actions/openapi-spec-regenerate.mjs:10-15`) — no authentication
  at all; `params.workspaceBaseUrl` is passed verbatim into `assembleSpec`
  and baked into `spec.servers[0].url` without `normalizeServiceBaseUrl`,
  allowing an attacker to inject any URL (including private network) into
  the published spec.
- **B12** (`sdk-generate.mjs:12-14` + `openapi-spec-serve.mjs:10-13`) —
  `extractWorkspaceId` regex does not URL-decode the path; URL-encoded ids
  silently fail to match.
- **B13** (`sdk-generate.mjs:58`) — the `x-auth-tenant-id` vs `x-tenant-id`
  header fallback is asymmetric; gateway drift between the two values is
  invisible.
- **G4, G18, G19** — same surfaces flagged as gaps.

## What Changes

- Add an explicit `assertWorkspaceOwnedByTenant(pool, workspaceId,
  tenantId)` check at the top of every handler in
  `actions/sdk-generate.mjs` and `actions/openapi-spec-regenerate.mjs`;
  failure MUST return `403 FORBIDDEN`, matching the pattern at
  `openapi-spec-serve.mjs:53-55`.
- Add a signed-context check to `openapi-spec-regenerate.main`: require a
  service-account JWT carrying `internal:openapi-regenerate`; reject
  anonymous invocations with `401 UNAUTHENTICATED`.
- Pipe `params.workspaceBaseUrl` through
  `normalizeServiceBaseUrl(..., { allowBareInternalHttp: false })` before
  passing it to `assembleSpec`; reject invalid URLs with `400 INVALID_URL`.
- Require the gateway to set exactly one of `x-auth-tenant-id` or
  `x-tenant-id`; reject requests carrying both with different values as
  `400 HEADER_CONFLICT`.
- URL-decode the path segment in `extractWorkspaceId` before applying the
  regex.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: SDK generation and regeneration enforce
  tenant-ownership at the action layer; the regenerate trigger validates
  caller authority and the URL baked into the published spec.

## Impact

- Affected code: `services/openapi-sdk-service/actions/sdk-generate.mjs`,
  `services/openapi-sdk-service/actions/openapi-spec-regenerate.mjs`,
  `services/openapi-sdk-service/actions/openapi-spec-serve.mjs`,
  `services/openapi-sdk-service/src/network.mjs`.
- Migrations: none.
- Breaking changes: cross-tenant calls that previously succeeded now
  receive `403`; anonymous regenerate invocations now receive `401`;
  callers passing both legacy and current tenant headers with different
  values now receive `400`.
- Coordination: confirm the internal trigger pipeline (manifest update →
  spec regenerate) attaches a service-account JWT before merging.
