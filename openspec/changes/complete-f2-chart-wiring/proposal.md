## Why

The standalone `charts/realtime-gateway/` chart is unreachable from the
umbrella chart and ships with empty secret material. From
`openspec/audit/cap-f2-realtime-subscriptions-transport.md`:

- **B2** (`charts/realtime-gateway/templates/` listing) — no `Service`
  template exists; `values.yaml:8-9` declares `service.port: 8080` but
  nothing materialises a Kubernetes Service. Cluster-internal traffic
  cannot reach the Deployment by DNS.
- **B3** (`charts/in-falcone/values.yaml`) — no `realtimeGateway`
  component is declared as an upstream. Routes 1003 (`/realtime/*`)
  and 2011 (`/v1/websockets/*`) both target `component: controlPlane`.
  The standalone Deployment is provisioned but unrouted.
- **B4** (`charts/realtime-gateway/templates/secret-ref.yaml:6-9`) —
  the `realtime-gateway-secrets` Secret ships with literal `""` values
  for `DATABASE_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`,
  `KAFKA_BROKERS`. The B2 library throws on empty values, so a fresh
  install crash-loops.
- **B9** (`charts/realtime-gateway/templates/configmap-apisix-plugin.yaml`)
  — the `realtime-gateway-apisix-plugin` ConfigMap is never referenced
  by `charts/in-falcone/` or `services/gateway-config/`.
- **G2** (no Service), **G3** (no umbrella component), **G8** (empty
  secret) — same items, cross-listed.

## What Changes

- Add `charts/realtime-gateway/templates/service.yaml` materialising a
  ClusterIP Service named `realtime-gateway` on port 8080.
- Add `realtimeGateway` to `charts/in-falcone/values.yaml` as an
  upstream component (host = service DNS, port 8080).
- Re-point routes 1003 (`/realtime/*`) and 2011 (`/v1/websockets/*`)
  from `component: controlPlane` to `component: realtimeGateway`.
- Replace `templates/secret-ref.yaml` literal `""` values with an
  `ExternalSecret` (External Secrets Operator) that pulls the three
  keys from the platform's secret store; document the required vault
  paths in the chart README.
- Reference `realtime-gateway-apisix-plugin` from the umbrella's APISIX
  bootstrap so the JWT-auth plugin config is consumed.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: the chart becomes self-contained and reachable
  from inside the cluster; APISIX routes target the realtime upstream
  rather than the control-plane.

## Impact

- **Affected code**: new
  `charts/realtime-gateway/templates/service.yaml`, edits to
  `charts/realtime-gateway/templates/secret-ref.yaml` (ESO), edits to
  `charts/in-falcone/values.yaml` (component + route retargeting),
  edits to `charts/in-falcone/templates/apisix-config.yaml` (plugin
  consumption).
- **Migration**: ops must populate the vault paths the ESO references
  before applying the chart; document in PR.
- **Breaking changes**: routes 1003/2011 will no longer hit
  `controlPlane`. Until `complete-f2-transport-binary-and-handler`
  ships the binary, the realtime upstream resolves to an unreachable
  endpoint — schedule the two changes together.
- **Out of scope**: image build (the partner change owns that), URL
  prefix corrections for routes 2014/2015 (`fix-f2-route-misalignment`),
  resilience tuning (`harden-f2-pod-resilience`).
