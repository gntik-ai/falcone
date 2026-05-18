## Why

The repo carries three or four parallel chart trees with no shared structure
and three values files that target charts that don't exist. There is no
single "install Falcone" path. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **G1** — four chart trees: `charts/in-falcone/` (umbrella),
  `charts/realtime-gateway/` + `charts/workspace-docs-service/` (sidecar
  flat), `helm/charts/backup-status/` (OpenWhisk-style), and
  `helm/provisioning-orchestrator/` (values-only stub). Plus `deploy/helm/`
  with values files for absent charts. No top-level "umbrella of umbrellas"
  ties them together; an operator must know which to install in which
  order.
- **G3** (`helm/provisioning-orchestrator/values.yaml`) — orphan values
  file; no chart consumes its 13 lines.
- **G4** (`deploy/helm/{webhook-engine-values, scheduling-engine-values}
  .yaml`) — both declare `actions[]` for out-of-repo chart shapes. Neither
  values file's keys map to any chart in this repo.

This is a `complete-*` change because the consolidation infrastructure
literally does not exist — there is no broken layout to fix, only an
absent canonical layout.

## What Changes

- Move `charts/realtime-gateway/` and `charts/workspace-docs-service/` into
  the umbrella's `component-wrapper` pattern as two new components
  (`realtimeGateway`, `workspaceDocsService`), gated on `.enabled`.
- Move `helm/charts/backup-status/` into the umbrella as a new component
  (`backupStatus`) and connect its bootstrap to the `run_one_shot_openwhisk`
  step landed by `fix-p1-bootstrap-script-gaps`.
- Delete `helm/provisioning-orchestrator/values.yaml` (orphan, no chart;
  also covered by `fix-p1-placeholder-hostnames-and-images`).
- Delete `deploy/helm/webhook-engine-values.yaml` and
  `deploy/helm/scheduling-engine-values.yaml` (target absent charts); add
  the values they declared into the umbrella as `webhookEngine` and
  `schedulingEngine` components.
- After consolidation, every Falcone deployment artefact lives under
  `charts/in-falcone/`; `helm/`, `deploy/helm/`, and the two sidecar
  charts are removed.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that the umbrella chart is the
  single canonical install path; no parallel chart trees, no values files
  without a chart.

## Impact

- **Affected code**: extensive move from `charts/realtime-gateway/`,
  `charts/workspace-docs-service/`, `helm/charts/backup-status/`,
  `helm/provisioning-orchestrator/`, `deploy/helm/*-values.yaml` into
  `charts/in-falcone/charts/component-wrapper/` and
  `charts/in-falcone/values.yaml`.
- **Migration required**: operators with existing `helm install
  charts/realtime-gateway` (or the others) must reinstall via the umbrella
  with the corresponding component enabled.
- **Breaking changes**: the standalone chart trees are removed; intended.
- See `design.md` for the canonical layout and migration plan.
