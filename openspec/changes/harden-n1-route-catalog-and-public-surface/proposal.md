## Why

The gateway has two parallel configuration systems for the same surface, an
HTTP-error path that conflates causes, a JS shim that pretends to test Lua
code, and a route catalogue with no versioning. From
`openspec/audit/cap-n1-apisix-gateway-configuration.md`:

- **B13** (`services/gateway-config/plugins/capability-enforcement.lua:141-143`) —
  capability resolution treats every non-200 (`404`, `401`, `500`) as a
  generic "resolution failure" returning `503
  GW_CAPABILITY_RESOLUTION_DEGRADED`. Operators cannot distinguish unreachable
  resolver from bad credentials from missing endpoint.
- **B15** (`services/gateway-config/tests/capability-enforcement.test.mjs`) —
  the file is a JS re-implementation of the Lua plugin's algorithm. The actual
  Lua code path is exercised only by `tests/plugins/*.lua`. Coverage is for
  the JS shim, not the runtime.
- **G1** (`base/public-api-routing.yaml` vs `routes/*.yaml`) — the family
  manifest declares 15 families with QoS, validation, and auth profiles, but
  the 8 route YAMLs declare their own scopes, rate limits, and upstreams
  without referencing those profiles. Two parallel configuration systems.
- **G-S6.1** (`public-route-catalog.json`) — 32 entries; covers
  `structural_admin` and `data_access` only. Doesn't cover the 16 metrics
  routes (per M4 audit), the 8 backup routes, the webhooks/realtime/sql_admin
  gates, or function-invoke routes.
- **G-S6.2** (`public-route-catalog.json`) — no `version` field, no rev hash,
  no `last_updated` timestamp; the catalog drifts silently.

## What Changes

- Map every non-200 from the capability-resolution call to a specific error
  code: `404 GW_CAPABILITY_RESOLVER_ENDPOINT_MISSING`, `401
  GW_CAPABILITY_RESOLVER_UNAUTHENTICATED`, `5xx
  GW_CAPABILITY_RESOLVER_UPSTREAM_ERROR`. The aggregate `503
  GW_CAPABILITY_RESOLUTION_DEGRADED` remains only for circuit-open or
  network-timeout.
- Replace `tests/capability-enforcement.test.mjs` with a Lua-runtime spec
  under `tests/plugins/` (busted or APISIX test harness), and delete the JS
  shim so coverage reflects the runtime.
- Reduce the two-systems problem incrementally: introduce a `family:` field on
  every route YAML and a CI check that asserts the route's declared scopes,
  rate limits, and upstreams are consistent with the named family profile.
  The route YAML stays the source of truth for now; the family manifest
  becomes the consistency baseline.
- Add `version`, `generated_at`, and `source_commit` fields to
  `public-route-catalog.json` and a CI check that re-derives the catalog from
  the route YAMLs and the umbrella chart, failing on drift.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: capability-resolution errors MUST be
  differentiated by HTTP status; Lua plugin tests MUST execute the Lua
  runtime; routes MUST declare a family and pass a family-consistency check;
  the public route catalog MUST carry version metadata and stay in sync with
  the route YAMLs.

## Impact

- Affected code: `services/gateway-config/plugins/capability-enforcement.lua`
  (`:141-143`); replace `tests/capability-enforcement.test.mjs` with one or
  more files under `tests/plugins/`; `services/gateway-config/routes/*.yaml`
  (add `family:` field); `services/gateway-config/public-route-catalog.json`
  (add version metadata); new CI checks under `services/gateway-config/tests/`.
- Cross-cutting: catalog completeness feeds into
  `complete-n1-plugin-classifier-stubs`, which depends on a useful catalog
  to classify routes.
- Breaking changes: operators parsing the generic 503 response from
  capability resolution will get more specific codes; update dashboards and
  alerts.
- Out of scope: implementing the missing routes themselves (covered by
  `fix-n1-capability-gating-mismatch`); the catalog content extension
  (handled incrementally by route owners).
