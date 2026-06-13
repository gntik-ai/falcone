## Context

The MCP server hosting epic (#386) introduces a new tenant-facing capability with significant cross-cutting concerns: a per-tenant server runtime on Kubernetes/OpenShift, an authenticated inbound transport, an OAuth 2.1 Authorization Server, automatic tool generation, and supply-chain controls. Falcone already provides strong primitives that the design must reuse rather than reinvent:

- **Compute isolation:** namespace-per-tenant, proven by the functions runtime (`services/provisioning-orchestrator/src/appliers/functions-applier.mjs`, namespace = `tenantId`).
- **Serverless runtime with scale-to-zero:** Knative (`deploy/kind/knative`, `enable-scale-to-zero: "true"`, 30s grace) — each function is already a ksvc invoked over HTTP.
- **Gateway:** APISIX with two privilege domains and a scope-enforcement plugin (ADR-3, `services/gateway-config`).
- **IdP:** Keycloak realm-per-tenant (`services/adapters/src/keycloak-admin.mjs`, `apps/control-plane/src/external-application-iam.mjs`) with a consent/approval precedent (`wf-con-001-user-approval.mjs`).
- **Data isolation:** shared DB + RLS (ADR-1); credential-derived tenant, fail-closed (ADR-2).

MCP itself: stable spec **2025-11-25** (async Tasks, OAuth 2.1, structured outputs, elicitation); **2026-07-28** in RC (stateless core, MCP Apps, Tasks extension, OAuth/OIDC alignment). Remote transport is **Streamable HTTP**; stdio is local-dev only.

This change is **decision + evidence only** (ADR + throwaway spikes), not production implementation.

## Goals / Non-Goals

**Goals:**
- Pick the **runtime**, **gateway**, **OAuth approach**, and **generation/curation strategy**, each backed by a spike, and record them as a new ADR.
- Prove **tenant isolation** for a hosted MCP server (cross-namespace probe must fail).
- Validate the **stateless + scale-to-zero** model.
- Establish foundational `mcp` capability requirements that downstream changes (#388–#403) implement.

**Non-Goals:**
- Production runtime/gateway/OAuth/console implementation (later changes).
- Locking any server contract to the 2026-07-28 RC.
- Tenant-authored operator/controller code; a public server marketplace.

## Decisions

Each decision states the recommended direction and the spike that must confirm it before the dependent change proceeds.

- **D1 — Runtime (spike a).** *Recommended:* reuse Falcone's existing **Knative per-tenant runtime** (each MCP server = a ksvc in the tenant namespace). Rationale: scale-to-zero, namespace isolation, and HTTP invocation already exist and are operated today, minimizing new surface. *Alternatives:* **ToolHive K8s Operator** (MCP-native `MCPServer` CRD, OTel/Prometheus built in — cleaner model but a new operator to run and OpenShift-SCC to validate) and a **bespoke controller** (max control, max cost). *Confirm by:* spike (a) deploys a server both ways in a tenant namespace and runs a cross-namespace probe that must fail; decision recorded in the ADR.
- **D2 — Gateway/transport (spike a).** *Recommended:* reuse **APISIX** (ADR-3) with an MCP-aware route terminating **Streamable HTTP**, validating OAuth tokens and enforcing per-tool scopes via the scope plugin. *Alternative:* **agentgateway** (native MCP/A2A, per-tool RBAC, OTel) if APISIX per-tool RBAC granularity proves insufficient. *Confirm by:* spike proves token validation + per-tool scope enforcement + tenant routing.
- **D3 — OAuth 2.1 AS (spike b).** *Decision:* **extend Keycloak**, not greenfield. Per-tool scopes = Keycloak client scopes; **dynamic client registration curated through the control-plane** (no raw Keycloak DCR exposure); consent via the approval-flow precedent; full token lifecycle. *Confirm by:* spike issues a per-tool-scoped token via the code flow with DCR + consent.
- **D4 — Generation + mandatory curation (spike c).** *Decision:* Instant-MCP generation **always** emits a draft manifest routed through a **mandatory curation gate** (prune + LLM-optimized descriptions); raw tools are never published. *Confirm by:* spike measures tool-call quality raw vs. curated to justify the gate.
- **D5 — Statelessness & cost (spike d).** *Decision:* build against the **stateless core**; idle servers **scale to zero** (free if D1 = Knative; otherwise KEDA). *Confirm by:* spike shows a stateless request path and cold-start behavior.

## Risks / Trade-offs

- **ToolHive operator maturity / OpenShift SCC fit** → spike (a) validates non-root/restricted-SCC before adoption; Knative reuse is the lower-risk fallback.
- **APISIX per-tool RBAC granularity may be coarse** → spike (a) tests it; agentgateway is the fallback recorded in the ADR.
- **Raw Keycloak DCR is a security footgun** → mitigate by curating client registration through the control-plane (Falcone-issued, tenant-scoped); never expose Keycloak admin to tenants.
- **2026-07-28 is an RC and may churn** → pin contracts to the **2025-11-25** stable spec; gate any RC-only feature (e.g., Tasks extension wording) behind explicit verification, flagged in #395.
- **Auto-generated tools degrade LLM performance** → the mandatory curation gate (D4) is the mitigation, validated by spike (c).

## Migration Plan

No production change to migrate. Spikes live under `spikes/add-mcp-hosting-adr-spikes/` and are throwaway (like `spikes/add-flows-adr-temporal-spikes/`). The ADR is appended to `docs-site/architecture/adrs.md`. On archive, the `mcp` capability spec is created in `openspec/specs/mcp/`. Rollback = revert the docs/spec edits; nothing is deployed.

## Open Questions

- Final **runtime** pick (Knative-reuse vs. ToolHive) — resolved by spike (a) evidence on isolation + operational/SCC fit.
- Whether **agentgateway** is required, or APISIX suffices for per-tool RBAC.
- Stability of the **Tasks extension** wording for workflows-as-tools (#395) — verify against the official spec before locking.
