## Why

Two sidecar charts and the umbrella's `component-wrapper` are missing the
basic Kubernetes building blocks that make a workload reachable, gateable,
and bounded. Today the realtime-gateway pod is unreachable from inside the
cluster and the workspace-docs-service pulls a bare image from the default
registry. From `openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B2** (`charts/realtime-gateway/templates/`) — directory contains
  `deployment.yaml`, `configmap-apisix-plugin.yaml`, `secret-ref.yaml` — no
  `service.yaml`. The Deployment exposes `containerPort: 8080` but no
  Service routes traffic to it. F2 capability is unreachable.
- **B4** (`charts/workspace-docs-service/templates/deployment.yaml:1-39`) —
  no probes, no `resources`, no `securityContext`, no `serviceAccountName`,
  no Service template; image is bare `workspace-docs-service:latest`.
- **B16** (`charts/realtime-gateway/templates/deployment.yaml:14-69`) — no
  `resources:` block.
- **B17** (`charts/in-falcone/charts/component-wrapper/templates/workload.yaml
  :62-114`) — the wrapper that renders all 10 backing components has no
  `livenessProbe`/`readinessProbe`/`startupProbe`.
- **G6** restates B2 and B16; **G7** restates B4; **G8** restates B17.

## What Changes

- Add `charts/realtime-gateway/templates/service.yaml` (ClusterIP on port
  8080) and a `resources:` block in `deployment.yaml`.
- Bring `charts/workspace-docs-service/` to parity: add `service.yaml`,
  probes, resources, `securityContext`, `serviceAccountName`, a real image
  reference with configurable registry.
- Add `livenessProbe`/`readinessProbe`/`startupProbe` blocks to
  `charts/in-falcone/charts/component-wrapper/templates/workload.yaml`,
  populated from per-component values (`probes.liveness.path`,
  `probes.readiness.path`, etc.) with a default off when no path is set
  (so existing components that genuinely have no probe path still render).
- Add `validate.yaml` rules requiring the new fields for the realtime and
  workspace-docs charts; for component-wrapper, surface a warning when probes
  are unset on a known critical component (`apisix`, `keycloak`,
  `controlPlane`, `webConsole`).

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that every chart that ships a
  Deployment also ships a Service, probes, and resources; the
  component-wrapper SHALL render probes when configured.

## Impact

- **Affected code**: new `charts/realtime-gateway/templates/service.yaml`,
  modified `charts/realtime-gateway/templates/deployment.yaml` and
  `charts/realtime-gateway/values.yaml`; new
  `charts/workspace-docs-service/templates/service.yaml`, modified
  `charts/workspace-docs-service/templates/deployment.yaml` and
  `charts/workspace-docs-service/values.yaml`; modified
  `charts/in-falcone/charts/component-wrapper/templates/workload.yaml` and
  `charts/in-falcone/charts/component-wrapper/values.yaml`; modified
  `charts/in-falcone/templates/validate.yaml`.
- **Migration required**: per-component probe paths must be supplied in
  `charts/in-falcone/values.yaml` for each enabled component; the
  realtime-gateway and workspace-docs-service charts now create a Service
  that must reconcile with any existing one.
- **Breaking changes**: a Service collision in the realtime-gateway
  namespace requires reconciliation; intended.
- See `design.md` for the chart-scaffolding pattern.
