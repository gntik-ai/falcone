## Why

The OpenWhisk function-admin family carries a placeholder hostname and three
distinct hard-coded contract-version / timestamp fallbacks across four files.
From `openspec/audit/cap-h1-openwhisk-function-admin-invocation.md`:

- **B2** (`services/adapters/src/openwhisk-admin.mjs:1008`) — the default
  public URL is
  `https://api.in-falcone.example/functions/${normalizeLogicalName(...)}`.
  If the caller omits `payload.publicUrl`, customers see an unresolvable
  hostname; the CORS allow-origin at `:1012` likewise defaults to
  `'https://console.in-falcone.example'`.
- **B5** (multiple sites):
  - `apps/control-plane/src/functions-admin.mjs:179` falls back to
    `'2026-03-25'` for the contract version.
  - `apps/control-plane/src/functions-import-export.mjs:189` hard-codes
    `requestId: 'req_import_validation'` and `timestamp:
    '2026-03-27T00:00:00Z'` on every import-error response.
  - `apps/control-plane/src/functions-audit.mjs:145` hard-codes
    `generatedAt: params.generatedAt ?? '2026-03-27T00:00:00Z'` on every
    coverage report.
  - `apps/control-plane/src/console-backend-functions.mjs:96` hard-codes
    `X-API-Version: '2026-03-25'` as a literal header value.
  Three different dates across one capability.
- **G3** (`functions-admin.mjs:179`, `functions-import-export.mjs:189`,
  `functions-audit.mjs:145`, `console-backend-functions.mjs:96`).
- **G4** (`openwhisk-admin.mjs:1008, :1012`).

## What Changes

- Require an explicit `publicUrlBase` and `consoleOrigin` from the deployment
  config (env or runtime config); throw `PUBLIC_URL_BASE_MISSING` if absent
  rather than falling back to the example hostname.
- Centralise the contract version in a single
  `apps/control-plane/src/runtime/contract-versions.mjs` module that
  re-reads the canonical version from the internal-contracts package at
  startup; every fallback site reads from this module.
- Replace the frozen timestamp fallbacks with `(() => new Date().toISOString())`
  closures that callers can override with a test clock.
- Replace the hard-coded `requestId: 'req_import_validation'` with a
  caller-supplied or generated correlation id.

## Capabilities

### Modified Capabilities

- `functions-runtime`: requirement that public URL defaults are
  deployment-configured (not example hostnames), and that contract
  versions and timestamps come from a single canonical source.

## Impact

- **Affected code**: `services/adapters/src/openwhisk-admin.mjs:1008, :1012`,
  `apps/control-plane/src/functions-admin.mjs:179`,
  `apps/control-plane/src/functions-import-export.mjs:189`,
  `apps/control-plane/src/functions-audit.mjs:145`,
  `apps/control-plane/src/console-backend-functions.mjs:96`,
  new `apps/control-plane/src/runtime/contract-versions.mjs`.
- **Migration required**: deployments must provide `publicUrlBase` and
  `consoleOrigin` in the runtime config (or env). Document in the
  operator runbook.
- **Breaking changes**: deployments that today silently used
  `api.in-falcone.example` will start failing at startup until the config
  is populated. This is intended.
- **Out of scope**: audit publisher stubs (covered by
  `fix-h1-audit-emitter-stub`); secret-scope fail-open (covered by
  `fix-h1-secret-scope-fail-open`).
