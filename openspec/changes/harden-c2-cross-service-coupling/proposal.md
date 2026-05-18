## Why

The workspace capability catalog reaches across service-package boundaries
with relative imports, trusts the entire request `params` blob without
allow-listing fields used in customer-facing snippets, and ships placeholder
`.example.internal` hostnames as defaults that leak to clients when the
calling layer omits real values. From
`openspec/audit/cap-c2-workspace-capability-catalog.md`:

- **B5** (`services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:1`) —
  the handler imports `buildCatalog` from
  `../../../workspace-docs-service/src/capability-catalog-builder.mjs`,
  bypassing any package-level export boundary. A rename in
  `workspace-docs-service` silently breaks the catalog endpoint.
- **B9** (`workspace-capability-catalog.mjs:37-46`) — workspace-context
  defaults are literal placeholders such as
  `${workspaceId}.example.internal`, `wss://realtime.example.internal`,
  `https://functions.example.internal/api/v1/web/...`. If the OpenWhisk
  wrapper omits `params.host` / `params.endpoints`, customers see
  `.example.internal` hostnames in the example snippets.
- **B13** (`workspace-capability-catalog.mjs:24`) —
  `fetchCapabilities?.()` is invoked with the entire `params` blob
  (including `params.auth`, `params.headers`); any debug logging by a
  real implementation would leak claims/secrets.
- **B14** (`workspace-capability-catalog.mjs:42`,
  `capability-catalog-builder.mjs:28`) — `params.resourceNames.extraB`
  is trusted as a URL with no validation; a malicious caller supplying
  `extraB = "javascript:alert(0)"` lands that string inside example
  snippets returned to clients.
- **G3** — same root cause as B5: cross-service relative imports for both
  `buildCatalog` and `snippet-catalog-data.json`; neither is exposed
  through `services/internal-contracts/src/index.mjs`.

## What Changes

- Move `capability-catalog-builder.mjs` and `snippet-catalog-data.json`
  to `services/internal-contracts/` (or a new shared package) and export
  them via the package index. Replace the cross-service relative imports
  at `workspace-capability-catalog.mjs:1` and
  `capability-catalog-builder.mjs:1` with package imports.
- Refuse to fall back to `.example.internal` placeholders: when
  `params.host` / `params.port` / `params.resourceNames` /
  `params.endpoints` are missing, return HTTP 500
  `WORKSPACE_CONTEXT_MISSING` rather than silently leaking placeholders.
- Restrict the argument passed to `fetchCapabilities` to an allow-listed
  shape `{ workspaceId, capabilityId, tenantId, claims }`; do not pass
  the raw `params`. Claims MUST be redacted of token material before
  hand-off.
- Validate `params.resourceNames.extraA` and `extraB` against an
  allow-list of safe URL schemes (`https:`, `wss:`) and host-pattern
  rules; reject otherwise.

## Capabilities

### Modified Capabilities

- `workspace-management`: package-boundary cleanliness for the catalog
  builder, refusal of placeholder defaults, restricted `fetchCapabilities`
  argument shape, and validation of caller-supplied resource URLs.

## Impact

- Affected code:
  `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs`,
  `services/workspace-docs-service/src/capability-catalog-builder.mjs`
  (likely moved), `services/internal-contracts/src/snippet-catalog-data.json`
  (kept here, re-exported), `services/internal-contracts/src/index.mjs`
  (new exports).
- Migrations: none.
- Breaking changes: any caller relying on the `.example.internal`
  fallbacks will receive 500s; the OpenWhisk wrapper MUST supply real
  `host` / `endpoints` values. Callers of `fetchCapabilities` MUST adapt
  to the narrowed argument shape.
- Out of scope: action completion (`complete-c2-action-implementation`);
  schema conformance (`fix-c2-schema-conformance`); correlation/audit
  semantics (`harden-c2-correlation-and-audit`).
