## Why

The two M3 metadata YAMLs ship four schema defects that make them either
under-restrictive (anything validates) or impossible to satisfy (no real
response can validate). From `openspec/audit/cap-m3-secret-metadata-api-contracts.md`:

- **B3** (`secret-metadata-v1.yaml:25-40`) — the 200 response object has no
  `required` array. The empty object `{}` validates as a secret metadata
  payload. Every field including `name`, `domain`, `path` is optional.
- **B4** (`secret-metadata-v1.yaml:34`) — `lastAccessedAt` is declared
  `string, format: date-time` with no `nullable: true`. A never-accessed
  secret has `lastAccessedAt = null`, which fails strict OAS 3.0.3
  validators; a spec-compliant response cannot be produced.
- **B5** (`secret-metadata-v1.yaml:15-19`) — path parameter `path` is a single
  non-greedy string. Vault paths like `platform/postgresql/app-password`
  contain slashes; the route `/v1/secrets/{domain}/{path}` parses
  `domain=platform, path=postgresql` and 404s on `/app-password`. The
  declared URL shape cannot match real secret paths.
- **B6** (`secret-metadata-v1.yaml:25-40` vs `secret-inventory-v1.yaml:56-59`) —
  the inventory enforces `not.anyOf: [{required:[value]},{required:[data]}]`;
  the detail contract does not. Two adjacent contracts disagree on the
  forbidden-field policy for secret material.
- **G-S2.1/G-S2.2/G-S2.3/G-S2.8** — schema-design gaps that converge on
  the same fixes (path syntax, `required`, `nullable`, `not.anyOf`).

## What Changes

- Replace the detail route shape with `GET /v1/secrets/{domain}` accepting a
  required `path` query parameter (string, no slash restriction). This works
  for Vault paths of any depth without leaving standard OAS 3.0.3 / 3.1.0.
- Add a `required` array to the detail 200 response covering `name, domain,
  path, createdAt, updatedAt, status, secretType, vaultMount, accessPolicies`.
- Mark `lastAccessedAt` as `nullable: true` (3.0.3) and migrate to
  `type: [string, 'null'], format: date-time` in the 3.1.0 fragment introduced
  by `complete-m3-endpoint-implementation`.
- Add the same `not.anyOf: [{required:[value]},{required:[data]}]` clause to
  the detail-response schema that the inventory already carries, so both
  contracts forbid leaking secret material identically.

## Capabilities

### Modified Capabilities

- `secret-management`: requirement on the detail route's path-or-query shape,
  on response `required` fields, on null-safety for `lastAccessedAt`, and on
  the unified forbidden-field clause across both YAMLs.

## Impact

- **Affected code**: `services/internal-contracts/secrets/secret-metadata-v1.yaml`,
  `services/internal-contracts/secrets/secret-inventory-v1.yaml`, and the new
  `apps/control-plane/openapi/families/secrets.openapi.json` introduced by
  `complete-m3-endpoint-implementation` (this change updates it to reflect the
  corrected schemas).
- **Migration required**: none for runtime data; consumers that hard-coded the
  old `{domain}/{path}` route shape must move to `{domain}?path=...`.
- **Breaking changes**: the detail route URL changes; the unified spec emits
  a new operation; the audit metadata-read event payload now includes the full
  query path. Document in the change PR.
- **Cross-cutting**: depends on `complete-m3-endpoint-implementation` for the
  fragment file; if implemented before that lands, this change only edits the
  two source YAMLs.
