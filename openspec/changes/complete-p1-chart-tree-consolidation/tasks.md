## 1. Failing tests

- [ ] 1.1 [test] Add a CI smoke that asserts the repo contains exactly one
      `Chart.yaml` directory under `charts/`, namely
      `charts/in-falcone/Chart.yaml`; today the test fails because three or
      four chart trees exist.
- [ ] 1.2 [test] Add a smoke asserting `helm/`, `deploy/helm/`,
      `charts/realtime-gateway/`, and `charts/workspace-docs-service/` are
      absent from the repo after consolidation.
- [ ] 1.3 [test] Add a `helm template charts/in-falcone --set
      realtimeGateway.enabled=true --set workspaceDocsService.enabled=true
      --set backupStatus.enabled=true --set webhookEngine.enabled=true
      --set schedulingEngine.enabled=true` smoke and assert the rendered
      manifest contains the corresponding Deployments + Services.

## 2. Implementation

- [ ] 2.1 [migration] Add `realtimeGateway`, `workspaceDocsService`,
      `backupStatus`, `webhookEngine`, `schedulingEngine` components to
      `charts/in-falcone/Chart.yaml` and `charts/in-falcone/values.yaml`,
      modelled on the existing component-wrapper sub-deployments.
- [ ] 2.2 [migration] Move the deployable shapes from
      `charts/realtime-gateway/templates/`,
      `charts/workspace-docs-service/templates/`, and
      `helm/charts/backup-status/templates/` (rewritten per
      `fix-p1-backup-status-crd-and-adapters`) into the umbrella's
      `component-wrapper` rendering path.
- [ ] 2.3 [migration] Translate `deploy/helm/webhook-engine-values.yaml`
      and `deploy/helm/scheduling-engine-values.yaml` into the new
      `webhookEngine` and `schedulingEngine` component values blocks.
- [ ] 2.4 [migration] Delete `charts/realtime-gateway/`,
      `charts/workspace-docs-service/`, `helm/`, and `deploy/helm/` from
      the repo.
- [ ] 2.5 [docs] Update `charts/in-falcone/README.md` and the repo
      top-level `README.md` to point operators at the single
      `charts/in-falcone/` install command.

## 3. Validation

- [ ] 3.1 [docs] Document the new component layout, the per-component
      enablement defaults, and the migration steps for existing installs
      in `charts/in-falcone/README.md`.
- [ ] 3.2 [test] Run the three smokes plus `openspec validate
      complete-p1-chart-tree-consolidation --strict`; all green.
