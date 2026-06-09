## 1. Baseline

- [ ] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] 1.2 Confirm `openspec validate add-data-residency-pinning --strict` passes

## 2. Black-box tests (write first)

- [ ] 2.1 Add test fixture exposing two virtual regions in the supported-regions catalog (e.g. "eu-west-1" and "us-east-1")
- [ ] 2.2 Write black-box test: tenant created with `dataResidency.region: "eu-west-1"` persists and GET returns the value
- [ ] 2.3 Write black-box test: tenant created with an unsupported region is rejected with a 400-class error
- [ ] 2.4 Write black-box test: Tenant A's region does not bleed into Tenant B's record (isolation)
- [ ] 2.5 Write black-box test: provisioning applier invocations carry the tenant's `regionRef` in their input
- [ ] 2.6 Write black-box test: cross-region request returns a 403-class response with residency-violation indication
- [ ] 2.7 Write black-box test: cross-region request emits a `residency_violation` audit event with correct `tenantId`, `pinnedRegion`, and `requestedRegion`
- [ ] 2.8 Write black-box test: `GET /v1/platform/topology/regions` returns the supported-regions catalog
- [ ] 2.9 Write black-box test: regions returned by the endpoint match `deployment-topology.json` distinct `region_ref` values
- [ ] 2.10 Confirm all new tests fail before implementation (red-green discipline)

## 3. Topology contract update

- [ ] 3.1 Add `supported_regions` array to `services/internal-contracts/src/deployment-topology.json` derived from all distinct `region_ref` values across environment profiles
- [ ] 3.2 Export a `getSupportedRegions()` helper from `deployment-topology.json` for use by the control plane

## 4. Database migration

- [ ] 4.1 Write migration `services/provisioning-orchestrator/src/migrations/091-tenant-data-residency.sql`
- [ ] 4.2 Add `data_residency_region TEXT` column to the tenants table (nullable to avoid breaking existing rows)
- [ ] 4.3 Document that region is effectively immutable post-provisioning in a DB comment

## 5. Tenant management API changes

- [ ] 5.1 Accept `dataResidency.region` on `POST /v1/admin/tenants` in `apps/control-plane/src/tenant-management.mjs`
- [ ] 5.2 Validate `dataResidency.region` against `getSupportedRegions()`; return 400 with descriptive error if invalid
- [ ] 5.3 Persist `data_residency_region` on the tenant record
- [ ] 5.4 Return `dataResidency.region` on `GET /v1/admin/tenants/{tenantId}`
- [ ] 5.5 Add `GET /v1/platform/topology/regions` endpoint returning `{ regions: string[] }`

## 6. Applier threading

- [ ] 6.1 Update `services/provisioning-orchestrator/src/appliers/iam-applier.mjs` to accept and use `regionRef`
- [ ] 6.2 Update `services/provisioning-orchestrator/src/appliers/kafka-applier.mjs` to accept and use `regionRef`
- [ ] 6.3 Update `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` to accept and use `regionRef`
- [ ] 6.4 Update `services/provisioning-orchestrator/src/appliers/mongo-applier.mjs` to accept and use `regionRef`
- [ ] 6.5 Update `services/provisioning-orchestrator/src/appliers/storage-applier.mjs` to accept and use `regionRef`
- [ ] 6.6 Update `services/provisioning-orchestrator/src/appliers/functions-applier.mjs` to accept and use `regionRef`
- [ ] 6.7 Update the provisioning saga orchestration layer to pass `tenant.dataResidency.region` as `regionRef` to each applier call

## 7. Residency enforcement

- [ ] 7.1 Add `residency_violation` audit event category to `services/internal-contracts/src/observability-audit-pipeline.json`
- [ ] 7.2 Implement enforcement middleware in the control-plane request handler that compares the request's target region with the tenant's `data_residency_region`
- [ ] 7.3 Middleware returns 403 with `code: "RESIDENCY_VIOLATION"` and emits a `residency_violation` audit event on boundary crossing
- [ ] 7.4 Enforcement is a no-op (pass-through) for tenants with `data_residency_region: null` to preserve backward compatibility

## 8. Integration validation

- [ ] 8.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [ ] 8.2 Run `openspec validate add-data-residency-pinning --strict`
