## Why

The control-plane contract surface advertises a different API version depending
on which file is read, and the IAM façade silently falls back to a stale pin
when its contract is missing. From `openspec/audit/cap-a1-unified-public-api-contract.md`:

- **B7** (`apps/control-plane/src/iam-admin.mjs:39`) — the IAM compatibility
  summary returns `iamAdminRequestContract?.version ?? '2026-03-24'`. The
  unified spec pins `X-API-Version` to `'2026-03-26'`
  (`apps/control-plane/openapi/control-plane.openapi.json:55125`). If the
  contract is missing at runtime, the surface silently advertises a version two
  days older than the platform pin with no warning.
- **B8** — the unified OpenAPI spec carries three different
  `X-API-Version`-style pins for different fields: `pattern: "^2026-03-26$"`
  (`control-plane.openapi.json:55125`), `pattern: "^2026-03-24$"` (`:64600`),
  and `const: "2026-03-25"` (`:66423`, `:67701`). Version drift across the spec
  is not detectable; nothing fails CI when one drifts.
- **G6** — same hard-coded `'2026-03-24'` fallback as B7
  (`iam-admin.mjs:39`) flagged as a gap because it bypasses the platform's
  version-discipline contract.

## What Changes

- Remove the hard-coded `'2026-03-24'` fallback in `iam-admin.mjs:39`; raise
  `MissingContractError` when `iamAdminRequestContract` is absent at runtime.
- Promote the platform `X-API-Version` to a single source-of-truth constant
  (`PLATFORM_API_VERSION`) exposed from `services/internal-contracts/`; every
  per-family contract MUST derive from it.
- Add a `scripts/validate-openapi-version-pins.mjs` script that walks every
  `X-API-Version`-shaped pin in the unified spec and the per-family specs and
  fails CI on any mismatch.
- Add an integration test that asserts every façade reports the same
  `contractVersion` value at runtime.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: contract version sourcing, fail-fast on missing
  contracts, and CI-level drift detection across OpenAPI documents.

## Impact

- Affected code: `apps/control-plane/src/iam-admin.mjs`,
  `services/internal-contracts/src/index.mjs`,
  `apps/control-plane/openapi/control-plane.openapi.json`,
  `apps/control-plane/openapi/families/*.openapi.json`,
  `scripts/validate-openapi-version-pins.mjs` (new).
- Migrations: none.
- Breaking changes: any deployment that depends on the silent
  `'2026-03-24'` fallback to advertise an older version will now fail loud
  with `MissingContractError` — intended behaviour.
- Out of scope: bumping the version itself; this proposal only enforces
  uniformity at whatever the platform value is.
