## Why

The `apps/control-plane/` package fails several baseline hardening expectations:
its build/test pipeline is placeholders, its claimed HTTP surface has no
bootstrap, its façades reverse the intended layering, and every façade does
eager work at module-load. From `openspec/audit/cap-a1-unified-public-api-contract.md`:

- **G4** (`apps/control-plane/package.json:6-10`) — `test`, `lint`, and
  `typecheck` scripts are all `node -e "console.log('... placeholder')"`. The
  saga engine, idempotency store, and workflow handlers (~1.4k LOC of
  side-effecting code) have zero in-package coverage.
- **G5** (`apps/control-plane/src/README.md:5-13`) — README claims responsibility
  for "public control-plane APIs and versioning" and "internal health and
  readiness endpoints", but no server, no route registration, no entry point.
  `discoveryRoute: "/v1/platform/route-catalog"` advertised in every catalogue
  entry (`public-route-catalog.json:30`) has no implementation.
- **G7** (`tenant-management.mjs:12`) — the façade imports from
  `services/adapters/src/storage-tenant-context.mjs`; all other façades depend
  only on `services/internal-contracts/`. This makes the contract layer
  transitively depend on an infra adapter, reversing the intended direction.
- **G10** — `internal-service-map.mjs:9-12`, `console-auth.mjs:7-8`,
  `iam-admin.mjs:14-17`, `tenant-management.mjs:14-16`,
  `workspace-management.mjs:11-13`, and other façades resolve filters and call
  getters at module-load. A single missing contract id throws an unhelpful
  error during `import` rather than at first call.

## What Changes

- Replace placeholder `test`/`lint`/`typecheck` scripts in
  `apps/control-plane/package.json` with real `node --test`, `eslint`, and
  `tsc --noEmit` (or `tsd`) invocations targeting `src/`.
- Add a minimal HTTP bootstrap (`src/server.mjs`) that mounts
  `/v1/platform/route-catalog`, `/healthz`, `/readyz`; expose an `entry` script
  in `package.json`.
- Move `storage-tenant-context` usage out of `tenant-management.mjs`: either
  re-host the helper inside `services/internal-contracts/` or invert the
  dependency so the façade exposes a hook the adapter populates.
- Convert eager top-level filter/getter calls in every façade to lazy
  memoised accessors so import-time failures become first-call failures with
  actionable error messages.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: control-plane package build pipeline, HTTP
  bootstrap, façade dependency direction, and import-time discipline.

## Impact

- Affected code: `apps/control-plane/package.json`,
  `apps/control-plane/src/server.mjs` (new),
  `apps/control-plane/src/tenant-management.mjs`,
  `apps/control-plane/src/internal-service-map.mjs`,
  `apps/control-plane/src/console-auth.mjs`,
  `apps/control-plane/src/iam-admin.mjs`,
  `apps/control-plane/src/workspace-management.mjs`,
  plus other façades enumerated in `cap-a1`.
- Migrations: none.
- Breaking changes: any consumer relying on side-effects-at-import (eager
  filter resolution) MUST switch to the new lazy accessor calls.
- Out of scope: the saga state-store bugs (covered by `fix-a1-saga-state-store`)
  and the version-fallback issues (covered by
  `harden-a1-contract-version-fallbacks`).
