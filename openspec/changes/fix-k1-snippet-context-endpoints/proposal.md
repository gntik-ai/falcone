## Why

The workspace-docs snippet-context builder hard-codes URL paths,
defaults the realtime endpoint to the API hostname, and ships an example
domain (`api.example.test`) into customer-facing docs. From
`openspec/audit/cap-k1-workspace-docs-service.md`:

- **B10** (`src/snippet-context-builder.mjs:40-44`) — `webhooks` is
  hard-coded to `${baseUrl}/v1/webhooks` and `scheduling` to
  `${baseUrl}/v1/schedules`. F3 publishes `/v1/webhooks/subscriptions`;
  the snippet's bare path is wrong.
- **B11** (`src/snippet-context-builder.mjs:29`) — `realtimeEndpoint`
  defaults to `baseUrl.replace(/^http/, 'ws')`; per the F2 audit, the
  realtime surface lives on a separate hostname
  (`realtime.dev.in-falcone.example.com`).
- **B23** (`src/rotation-procedure-section.mjs:2`) — `baseUrl ??
  'https://api.example.test'` ships an example domain to customers in
  the stale branch.
- **G12** (`G-S5.2`) — webhooks/scheduling endpoints hardcoded (same as
  B10, raised to requirement).

## What Changes

- Replace the hard-coded `/v1/webhooks` and `/v1/schedules` paths with
  the canonical route names sourced from the API surface payload (with
  defaults of `/v1/webhooks/subscriptions` and `/v1/schedules`,
  matching the published OpenAPI families).
- Remove the `baseUrl.replace(/^http/, 'ws')` default; require an
  explicit `realtimeEndpoint` on each capability or fall back to
  `WORKSPACE_DOCS_REALTIME_BASE_URL` from config.
- Remove the `'https://api.example.test'` fallback in
  `rotation-procedure-section.mjs:2`; require `baseUrl` to be present
  and throw `MISSING_BASE_URL` otherwise.

## Capabilities

### Modified Capabilities

- `workspace-management`: requirements on snippet endpoint construction,
  realtime endpoint provenance, and absence of example domains in
  customer docs.

## Impact

- **Affected code**:
  `services/workspace-docs-service/src/snippet-context-builder.mjs`,
  `services/workspace-docs-service/src/rotation-procedure-section.mjs`,
  `services/workspace-docs-service/src/config.mjs` (new env var).
- **Migration required**: none.
- **Breaking changes**: any deployment whose snippets currently rely on
  the silently-substituted realtime host will need to set
  `WORKSPACE_DOCS_REALTIME_BASE_URL` or supply per-capability
  `realtimeEndpoint`. Stale-branch responses now fail-fast if `baseUrl`
  is unknown instead of silently using `api.example.test`.
- **Cross-cutting**: docs that previously displayed
  `https://api.example.test/...` to customers stop doing so.
