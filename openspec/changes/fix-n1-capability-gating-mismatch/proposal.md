## Why

The gateway declares capability gates against paths that do not exist as APISIX
routes, and the family validation profile declares a flag that no plugin
consumes. From `openspec/audit/cap-n1-apisix-gateway-configuration.md`:

- **B9** (`services/gateway-config/routes/capability-gated-routes.yaml:15-43`) —
  five gates declared (`webhooks`, `realtime`, `sql_admin_api`,
  `passthrough_admin`, `functions_public`). Per the F2 and H1 audits,
  `/v1/workspaces/*/realtime*` and `/v1/functions/*/invoke` paths are not in
  the umbrella chart's APISIX route table. Gates that match no route are dead
  policy; clients hitting those paths get 404 before reaching the gate.
- **B10** (`services/gateway-config/base/public-api-routing.yaml:88, :93, :99,
  ...`) — every request-validation profile declares
  `rejectSpoofedContextHeaders: true`. No plugin in
  `services/gateway-config/plugins/` reads this flag; it is profile metadata
  only. Reliance on a missing third plugin or APISIX core.
- **G5**, **G-S2.2** — gates declared against missing routes and family profile
  flags advisory only.

## What Changes

- Add APISIX routes for every path covered by `capability-gated-routes.yaml`
  (or remove the gate entries for paths that the platform has decided not to
  ship). The catalogue and the route table MUST be consistent: a gate without
  a route, or a route covered by a gate without a route entry, is a defect.
- Implement `rejectSpoofedContextHeaders` enforcement: either in a small new
  APISIX plugin under `services/gateway-config/plugins/` or by wiring the
  existing `scope-enforcement.lua` to strip `X-Tenant-Id`, `X-Workspace-Id`,
  `X-Plan-Id`, `X-Auth-Subject`, `X-Actor-Username`, `X-Auth-Scopes`,
  `X-Actor-Roles` from inbound requests before any downstream propagation.
- Add a CI check that asserts every gate key in `capability-gated-routes.yaml`
  resolves to at least one APISIX route declaration; conversely, every route
  with a gated-capability annotation MUST appear in the gates manifest.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: capability gates MUST have matching APISIX
  routes (no dead gates, no ungated routes that the manifest claims to gate);
  `rejectSpoofedContextHeaders` MUST be enforced in plugin code, not advertised
  as metadata only.

## Impact

- Affected code: new or updated route YAMLs under
  `services/gateway-config/routes/` covering webhooks, realtime, and
  function-invoke paths; either a new `plugins/context-header-stripper.lua`
  or an extension to `scope-enforcement.lua`; a new test under
  `services/gateway-config/tests/` for gate/route parity.
- Cross-cutting: depends on F2 (realtime route YAMLs) and H1 (function-invoke
  route YAMLs) for the actual route declarations to land; this proposal owns
  the parity contract and the header-stripping plugin.
- Breaking changes: clients that previously spoofed `X-Tenant-Id` to test
  cross-tenant behaviour against an unenforced flag will start receiving the
  scoped identity from the JWT; update load-tests.
- Out of scope: scope-literal coverage on the new routes (covered by
  `fix-n1-scope-literals-and-rate-limits`); JWT signature verification
  (covered by `harden-n1-jwt-and-claim-trust`).
