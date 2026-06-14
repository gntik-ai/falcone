## Context

Five storage routes are wired in `deploy/kind/control-plane/routes.mjs:118-123` and mapped to real SeaweedFS-backed handlers via the `add-seaweedfs-storage-provider` change. The E2E harness (`tests/e2e/stack.sh`, `run.sh`, `run-issue.sh`) is already operational for flows and MCP suites. A/B tenant fixtures (`tests/e2e/helpers/flows/tenant-fixtures.ts`, `tests/e2e/helpers/mcp/tenant-fixtures.ts`) with canonical fixed UUIDs are shared across suites. Cross-tenant isolation patterns are established in `tests/e2e/specs/mcp/mcp-cross-tenant.spec.ts` and `tests/e2e/specs/flows/flows-cross-tenant.spec.ts`. No runnable storage Playwright specs exist today.

## Goals / Non-Goals

**Goals:**
- Author Playwright specs covering the five wired storage routes for Tenant A (list-buckets, provision-bucket, workspace-usage, list-objects, object-metadata).
- Author a cross-tenant isolation probe (Tenant B denied on Tenant A's buckets/objects).
- Wire SeaweedFS Helm deploy into `stack.sh up` (conditional, additive; existing path unchanged).
- Provide per-issue runner path (`run-issue.sh add-seaweedfs-storage-e2e`).
- All specs assert only routes the platform actually exposes.

**Non-Goals:**
- Implementing upload/download/presign routes not yet wired (separate work).
- Modifying any source code outside `tests/e2e/`.
- Non-storage E2E suites.
- Changing any existing E2E spec.

## Decisions

**D1 — Spec placement follows `run-issue.sh` convention.**
`run-issue.sh <change-id>` resolves to `specs/issues/<change-id>.spec.ts`. The storage E2E entry point is therefore `tests/e2e/specs/issues/add-seaweedfs-storage-e2e.spec.ts`. Shared helpers and per-operation spec blocks live in `tests/e2e/specs/storage/`. The issue spec imports and re-exports those blocks so both the full suite (`run.sh`) and the per-issue runner (`run-issue.sh`) exercise the same tests.

**D2 — Reuse canonical A/B tenant fixtures without duplication.**
A new `tests/e2e/helpers/storage/tenant-fixtures.ts` is created that re-exports `TENANT_A`/`TENANT_B` from the flows fixture file. This avoids UUID drift and keeps the identity contract in one place, matching the MCP fixture approach.

**D3 — SeaweedFS stack wiring is conditional and additive.**
`stack.sh up` is extended with an `if [ "${E2E_STORAGE_BACKEND:-}" = "seaweedfs" ]` block that installs a SeaweedFS Helm release into the ephemeral namespace before the `healthy()` gate. The existing `healthy()` function already iterates all Deployments and StatefulSets in the namespace, so SeaweedFS readiness is automatically enforced by the existing gate — no new readiness logic is needed. The teardown trap (`bash stack.sh down` → `kubectl delete namespace "$NS"`) is unchanged and covers all resources in the namespace including SeaweedFS.

**D4 — Specs skip gracefully when the storage API is not yet wired.**
Each `test.describe` block includes a `beforeAll` probe (`GET /v1/storage/buckets`) and calls `test.skip` with a descriptive reason if the probe returns 404 or 501. This mirrors the live-gate pattern in `mcp-cross-tenant.spec.ts:34`.

**D5 — Assert only routes present in `routes.mjs:118-123`.**
Presigned-URL and lifecycle routes are not wired; specs do not assert them. If a future change wires those routes, a separate spec file is added.

## Risks / Trade-offs

- [Risk: SeaweedFS image not in kind node cache] → Mitigation: `stack.sh` pre-pulls the image with `docker pull` + `kind load docker-image` before helm install; documented in tasks.
- [Risk: per-tenant isolation depends on `add-seaweedfs-tenant-identities`] → Mitigation: the cross-tenant probe uses workspace-scoped identity headers (same pattern as MCP/flows) and skips with a clear reason if per-tenant credentials are not yet provisioned.
- [Risk: object-metadata scenario requires an object to exist] → Mitigation: the `beforeAll` provisions a bucket and uploads a minimal test object via a direct S3/SigV4 call to SeaweedFS (internal cluster address), bypassing the not-yet-wired upload route; the object is cleaned up in `afterAll`.

## Open Questions

- Will `add-seaweedfs-tenant-identities` land before this spec runs in CI? If not, the cross-tenant probe uses workspace-ID header scoping only (no per-tenant S3 credential differentiation) and the isolation assertion relies on the control-plane enforcing `tenant_id` on list/get queries.
