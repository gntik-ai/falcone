## Context

P1 today ships **two qualitatively different capabilities** under one name:
the well-engineered umbrella at `charts/in-falcone/` (60 files, 5 452 LOC,
30 validators, 10 wrapper components, layered values profiles); and
"everything else" — three parallel chart trees, a values-only stub, and
two loose values files for charts that don't exist:

| Tree | Path | Status |
|---|---|---|
| Umbrella | `charts/in-falcone/` | Canonical |
| Sidecar realtime-gateway | `charts/realtime-gateway/` | Missing Service, probes, resources |
| Sidecar workspace-docs | `charts/workspace-docs-service/` | Missing Service, probes, resources, registry |
| OpenWhisk-style | `helm/charts/backup-status/` | Fictional CRD apiGroup |
| Values-only orphan | `helm/provisioning-orchestrator/` | No Chart.yaml |
| Loose values | `deploy/helm/webhook-engine-values.yaml`, `deploy/helm/scheduling-engine-values.yaml` | No matching chart |

An operator installing Falcone today must know which trees to install and
in which order — and even then, three of the five trees have structural
defects (no Service, fictional CRD, orphan values) that prevent them from
working as advertised.

This is a `complete-*` change because the consolidated install path
literally does not exist — there is no broken canonical layout to fix,
only an absent canonical layout.

## Goals

- One canonical install path: `helm install charts/in-falcone -f
  <profile>` brings up every Falcone capability operator wants enabled.
- One canonical pattern for sub-deployments: the umbrella's
  `component-wrapper` subchart renders every Deployment + Service +
  ConfigMap + (optional) PVC consistently.
- Zero orphan values files; zero chart trees outside `charts/in-falcone/`.

## Non-goals

- Rewriting the umbrella's own internals (validate.yaml, public-surface
  rendering, bootstrap script); they're already canonical.
- Fixing the specific defects in each sidecar chart's deployment
  (`fix-p1-placeholder-hostnames-and-images`, `complete-p1-missing-chart-pieces`,
  `fix-p1-secret-clobbering-and-keys`, `fix-p1-backup-status-crd-and-adapters`).
  This change subsumes them only by moving the corrected templates into
  the umbrella; the corrections themselves are sibling proposals.
- Adopting a Kubernetes operator pattern in place of Helm; the umbrella
  pattern works.

## Decisions

### Decision 1: New components in the umbrella

Five new components join the umbrella's `Chart.yaml` dependency list:

| Component | Source today | Target location |
|---|---|---|
| `realtimeGateway` | `charts/realtime-gateway/` | wrapper-rendered |
| `workspaceDocsService` | `charts/workspace-docs-service/` | wrapper-rendered |
| `backupStatus` | `helm/charts/backup-status/` (rewritten as ConfigMaps) | wrapper-rendered + bootstrap-script provisioning |
| `webhookEngine` | `deploy/helm/webhook-engine-values.yaml` keys | wrapper-rendered + bootstrap-script provisioning |
| `schedulingEngine` | `deploy/helm/scheduling-engine-values.yaml` keys | wrapper-rendered + bootstrap-script provisioning |

Each component is gated on `.enabled` (default off for the three
OpenWhisk-resident ones; default on for `realtimeGateway` and
`workspaceDocsService` because they're standalone Deployments).

### Decision 2: Component-wrapper extensions

The wrapper today renders Deployment/Service/ConfigMap/PVC/ServiceAccount.
The OpenWhisk-resident components (`backupStatus`, `webhookEngine`,
`schedulingEngine`) need only the ConfigMap (action source) and bootstrap
script provisioning. The wrapper grows a `wrapper.workload.kind = none`
case that renders only the ConfigMap, paired with a values block
documenting that the bootstrap script handles registration via `wsk action
create`.

### Decision 3: Values consolidation

The five new components' values flatten into top-level keys of
`charts/in-falcone/values.yaml` matching the existing component layout
(`apisix`, `keycloak`, `postgresql`, etc.). Profile overlays
(`prod.yaml`, `dev.yaml`, `airgap.yaml`, `ha.yaml`, `customer-reference.yaml`)
take on per-component overrides for the new five.

### Decision 4: Migration ordering

Sibling proposals depend on the consolidated tree to land:

1. `fix-p1-secret-clobbering-and-keys` — remove Secret-creating templates.
2. `complete-p1-missing-chart-pieces` — add Service, probes, resources to
   the two sidecar charts.
3. `fix-p1-backup-status-crd-and-adapters` — rewrite OpenWhisk CRs as
   ConfigMaps.
4. `fix-p1-bootstrap-script-gaps` — extend the bootstrap to register
   OpenWhisk actions.
5. **This change** (`complete-p1-chart-tree-consolidation`) — move the
   corrected templates into the umbrella.

Land in that order. If this change lands first, the move surfaces every
defect at once.

## Risks / Trade-offs

- Operators with existing `helm install charts/realtime-gateway` must
  reinstall under the umbrella, accepting a brief downtime.
- The umbrella `values.yaml` grows from ~3 000 LOC by ~500 LOC. The
  validator must keep up.
- Removing `helm/` and `deploy/helm/` is irreversible without a revert;
  document the rationale in the PR description.

## Migration plan

1. Land tasks 2.1–2.3 (umbrella additions + sidecar template moves +
   loose-values translation).
2. Run the three smokes in CI to confirm the umbrella renders the new
   components correctly.
3. Land task 2.4 (delete the now-empty trees) in a follow-up PR so
   operators have one cycle to update their install commands.
4. Update top-level README and per-customer install runbooks.
