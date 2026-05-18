## Why

The internal-contracts registry hosts 55 JSON files with two structurally
distinct conventions, five drifting version dates, one non-uniform `version`
shape, and an `INTERNAL_CONTRACT_VERSION` constant that speaks for the whole
package but only reflects one of 22 registries. Today no validator catches
any of it. From `openspec/audit/cap-o2-internal-contracts.md`:

- **B6** (`services/internal-contracts/src/public-route-catalog.json:1-7`) —
  this file has no top-level `version`; its semver is nested under
  `release.header_version`. The registry has no `PUBLIC_ROUTE_CATALOG_VERSION`
  export — silent miss for route consumers.
- **B7** (registry directory) — 33 of 55 JSON files have no top-level `version`
  (schema payloads); 22 do (versioned registries). The module's
  `readXxx().version` assumes the second pattern. A schema renamed into the
  versioned set crashes at import.
- **B10** (`services/internal-contracts/src/index.mjs:236`) —
  `INTERNAL_CONTRACT_VERSION` is the version of `internal-service-map.json`
  only (currently `'2026-03-25'`), but its name suggests the whole package.
  Consumers asserting compatibility against it pass even when authorization
  is at `2026-03-24` and observability is at `2026-03-28`.
- **G3**, **G4**, **G5**, **G16**, **G19**, **G20** restate the
  mixed-convention directory, the version drift across registries, the
  non-uniform `release.header_version` on the route catalog, the four
  divergent relative-path depths, the two-shape effective-capability
  accessors, and the misleading constant name respectively.

## What Changes

- Split `services/internal-contracts/src/` into `src/registries/` (22
  versioned registries) and `src/schemas/` (33 JSON-Schema payloads); update
  module re-exports.
- Replace `INTERNAL_CONTRACT_VERSION` with a `REGISTRY_VERSIONS` Map keyed on
  registry filename → version string; deprecate the misleading singular
  constant with a warning re-export until removed in a follow-up.
- Compute `PUBLIC_ROUTE_CATALOG_VERSION` from
  `public-route-catalog.json.release.header_version`; expose alongside the
  other `XXX_VERSION` constants for shape parity.
- Add a load-time validator: every file in `src/registries/` MUST have a
  top-level `version`; every file in `src/schemas/` MUST NOT.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on registry-vs-schema shape
  separation, per-registry version exposure, and load-time validation of the
  directory layout.

## Impact

- **Affected code**: `services/internal-contracts/src/` reorganisation;
  `index.mjs:236-255` constants block; every importer of
  `INTERNAL_CONTRACT_VERSION` (audit work pending).
- **Migration required**: directory move surfaces are tracked via the
  `@in-falcone/internal-contracts/json/*` subpath export from
  `complete-o2-package-alias-and-tests`.
- **Breaking changes**: importers that read `INTERNAL_CONTRACT_VERSION` and
  meant "the platform version" need to switch to per-family `REGISTRY_VERSIONS
  .get('authorization-model.json')` lookups. The deprecation shim keeps the
  old constant valid for one release.
