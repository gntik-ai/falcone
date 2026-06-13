## 1. Chart component (charts/in-falcone)

- [x] 1.1 Add an `mcp` `component-wrapper` alias in `charts/in-falcone/Chart.yaml` + `values.yaml` (`mcp.enabled`, image/egress config), defaulting disabled
- [x] 1.2 RBAC template: namespace-scoped `Role` + `RoleBinding` granting the control-plane SA `serving.knative.dev/services` (create/get/list/delete) + minimal core objects in tenant namespaces
- [x] 1.3 NetworkPolicy template: default-deny ingress to MCP-server pods except from the gateway namespace; constrained egress (mirror `templates/temporal/networkpolicy.yaml`)
- [ ] 1.4 `values-openshift` overlay: non-root, restricted SCC, numeric UID
- [x] 1.5 `helm template`/lint renders cleanly with `mcp.enabled=true`; `pnpm validate:deployment-chart` + topology validators pass

## 2. Provisioning MCP domain (teardown cascade)

- [x] 2.1 Add `mcp-applier.mjs` (`teardown`) mirroring `workflows-applier.mjs` — delete the tenant's MCP-server ksvcs + MCP metadata rows; dependency-injected, idempotent, dryRun, `42P01`→skipped
- [x] 2.2 No reprovision collector needed — MCP is teardown-only, like the workflows domain (servers are created via the MCP API, not reprovisioned config)
- [x] 2.3 Wire the MCP teardown into `tenant-purge-sweep.mjs` (`TEARDOWN_PLAN` entry + `resolveDependencies`)
- [x] 2.4 Unit tests (`mcp-applier.test.mjs`): delete, idempotent, dryRun, table-absent skip, error→partial-failure, sweep wiring

## 3. Verify on cluster

- [ ] 3.1 Deploy the chart with `mcp.enabled=true` to `test-cluster-b`; confirm RBAC + NetworkPolicy created and Knative ksvc creation works under the bound RBAC
- [ ] 3.2 Provision a test tenant footprint and tear it down via the applier; confirm idempotent teardown leaves no MCP resources
- [ ] 3.3 Internal-only check: confirm gateway-only ingress (note: requires a policy-enforcing CNI; record kindnet caveat if absent)
- [ ] 3.4 OpenShift-safe check: pods run non-root under restricted profile

## 4. Finalize

- [x] 4.1 `openspec validate add-mcp-runtime-deployment --strict`
- [x] 4.2 Confirm `mcp.enabled` defaults off and the change is additive (no behavior change until enabled)
