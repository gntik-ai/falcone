## Why

ADR-12 decided to host each tenant's MCP server as a **Knative ksvc in the tenant's namespace**, reusing the existing functions runtime rather than installing a new operator. This change makes that decision deployable the Falcone way — a chart component plus the control-plane RBAC, internal-only networking, and provisioning-saga wiring needed to stand up and tear down a tenant's MCP runtime footprint. It resolves issue **#388** (epic #386) and unblocks #389 (gateway), #394 (custom hosting), #399 (isolation/quotas). No new runtime is installed: MCP servers ride the Knative serving already present (`deploy/kind/knative`, proven in the #387 spike).

## What Changes

- Add an **`mcp` component to the `charts/in-falcone` umbrella** via the existing `component-wrapper` pattern (alongside `temporal`), gated by `mcp.enabled`:
  - **RBAC** granting the control-plane service account `serving.knative.dev` create/get/list/delete on `services` (ksvc) scoped to tenant namespaces, plus the minimal core access to manage the per-server `Service`/secret.
  - **NetworkPolicy** templates that make MCP-server pods **internal-only**: ingress only from the platform gateway (Kourier/APISIX), controlled egress; mirrors `charts/in-falcone/templates/temporal/networkpolicy.yaml`.
  - `values` toggles and a `values-openshift` overlay (non-root, restricted SCC, numeric UID).
- Add an **MCP domain to the provisioning saga**: an `mcp-applier` (+ collector) in `services/provisioning-orchestrator` that stands up / tears down a tenant's MCP runtime footprint (namespace labels, RBAC, NetworkPolicy) per tenant, **mirroring `functions-applier.mjs`** (namespace = `tenantId`), idempotent with rollback on failure.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add requirements for **runtime deployment/teardown** (per-tenant footprint, internal-only networking, SCC/non-root). Builds on the foundational `mcp` capability introduced by `add-mcp-hosting-adr-spikes` (#387).
- `tenant-provisioning`: add a requirement that the provisioning saga includes an **MCP domain** applier with rollback, consistent with the existing per-domain appliers (IAM, Kafka, Postgres, Mongo, storage, functions).

## Impact

- **Charts:** new `charts/in-falcone` MCP component (RBAC + NetworkPolicy + values + OpenShift overlay).
- **Services:** `services/provisioning-orchestrator` gains an MCP applier/collector domain.
- **Runtime:** reuses Knative serving (no new operator/runtime installed).
- **No public HTTP API change.** Inbound routing/auth is #389; quotas/rate-limits/isolation enforcement is #399.
- **Deployment caveat:** NetworkPolicy is only enforced under a policy CNI (Calico/Cilium); kind's kindnet does not enforce it (ADR-12), so isolation tests run where a policy CNI is present.
