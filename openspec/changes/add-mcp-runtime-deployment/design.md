## Context

ADR-12 selected "reuse the existing Knative per-tenant runtime" for MCP hosting: each MCP server is a ksvc in the tenant namespace, scale-to-zero for free. The platform already provisions tenants across domains via a saga of per-domain appliers (`services/provisioning-orchestrator/src/appliers/*`, e.g. `functions-applier.mjs` with namespace = `tenantId`) and ships umbrella components via the `component-wrapper` chart pattern (`charts/in-falcone`, e.g. `temporal/`). This change adds the MCP runtime footprint to both, without installing a new runtime.

## Goals / Non-Goals

**Goals:**
- A chart-toggled MCP component that grants the control-plane the least RBAC needed to manage per-tenant MCP-server ksvcs, with internal-only NetworkPolicies and OpenShift-safe defaults.
- A provisioning MCP domain (applier + collector) that creates/tears down the per-tenant footprint idempotently with rollback.

**Non-Goals:**
- Inbound routing/OAuth enforcement (#389), tool generation (#392), quotas/rate-limits (#399), the servers' contents (#391/#394). Installing a new runtime/operator (ADR-12: reuse Knative).

## Decisions

- **Component-wrapper, not a new subchart.** Add `mcp` as a `component-wrapper` alias in `charts/in-falcone` (like `temporal`), so enable/disable and values overlays follow the established pattern. *Alternative:* a standalone chart — rejected to stay consistent with the umbrella.
- **RBAC = least privilege, namespace-scoped.** Grant the control-plane SA a `Role`/`RoleBinding` per tenant namespace for `serving.knative.dev/services` (create/get/list/delete) and the minimal core objects, rather than a cluster-wide ClusterRole. Rationale: blast-radius containment; a compromised control-plane path cannot reach arbitrary namespaces beyond what the saga binds.
- **Internal-only via NetworkPolicy.** Default-deny ingress to MCP-server pods except from the gateway namespace; constrain egress. Mirrors `temporal/networkpolicy.yaml`. *Caveat:* enforced only under a policy CNI (Calico/Cilium) — kindnet does not enforce (ADR-12); recorded as a deployment requirement.
- **Provisioning MCP domain mirrors functions.** The `mcp-applier`/`mcp-collector` follow `functions-applier.mjs`/`functions-collector.mjs` (namespace = `tenantId`, idempotent apply, symmetric teardown, rollback), so the saga gains MCP with no new orchestration pattern.

## Risks / Trade-offs

- *NetworkPolicy not enforced on kindnet* → isolation verified where a policy CNI exists; CI/prod must run Calico/Cilium (owned by #399).
- *RBAC scope creep* → keep namespace-scoped Roles bound by the saga; no cluster-wide write to ksvcs.
- *Knative coupling* → if ADR-12 is revisited (ToolHive), the applier's footprint changes but the saga/chart seams remain.

## Migration Plan

Additive: `mcp.enabled` defaults off until #389/#399 land. Enabling the component adds RBAC/NetworkPolicy only. Rollback = disable the component and run the saga teardown (idempotent). No data migration.

## Open Questions

- Exact egress allow-list for MCP-server pods (which platform services tools may reach) — refined alongside the Server SDK (#401) and isolation work (#399).
