## 1. Custom-server deployment-spec builder

- [x] 1.1 `buildCustomServerDeployment({ tenantId, serverId, image, namespace, port, env, planLimits, allowedRegistries })` → `{ manifest, violations }` — a Knative ksvc for the tenant's image
- [x] 1.2 ksvc carries `in-falcone.io/component: mcp-server` (#388 NetworkPolicy → internal-only) + tenant/server labels; `min-scale 0` (scale-to-zero); OpenShift-safe securityContext (non-root, no privesc, drop ALL, RuntimeDefault); readiness probe
- [x] 1.3 Supply-chain validation: reject disallowed registry; reject unpinned / `latest` image; resource within plan limits

## 2. Verify

- [x] 2.1 Unit tests: valid image → ksvc with the label / min-scale 0 / non-root securityContext; disallowed registry → violation; `latest`/unpinned → violation; over-limit → violation
- [x] 2.2 Live on `test-cluster-b`: deploy a representative custom-server image as a ksvc, invoke MCP, confirm it serves + scales to zero + carries the `mcp-server` label; tear it down
- [x] 2.3 `pnpm lint` + `openspec validate --strict` pass

## 3. Finalize

- [x] 3.1 Confirm internal-only (label present), tenant-scoped (tenant from context, namespace), and that git/CLI ingest reduces to "build an image, then deploy via this builder" (#400)
