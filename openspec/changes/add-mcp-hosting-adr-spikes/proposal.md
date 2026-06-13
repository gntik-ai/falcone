## Why

Falcone exposes data, auth, storage, events, functions and Temporal-based Flows, but none of it is natively reachable by AI agents. MCP (Model Context Protocol) is the vendor-neutral standard (Linux Foundation Agentic AI Foundation; stable spec **2025-11-25**, with **2026-07-28** in release-candidate) for exactly this. The MCP server hosting epic (#386) is large and several child issues hinge on four foundational decisions that must be **evidence-backed, not assumed**: the runtime, the inbound gateway, the OAuth approach, and the Instant-MCP generation/curation strategy — plus validating the stateless + scale-to-zero model. This change records those decisions as an ADR and de-risks them with throwaway spikes, mirroring the `add-flows-adr-temporal-spikes` precedent. It resolves issue **#387** and gates #388, #389, #390, #392, #399, #401.

## What Changes

- Add a new **`mcp`** capability whose initial spec captures the **decision-level requirements** for MCP server hosting (runtime model, gateway/transport, OAuth 2.1 Authorization Server, generation+curation, statelessness, internal-only isolation). Implementation of each lands in later changes.
- Record a new **ADR** in `docs-site/architecture/adrs.md` documenting: runtime choice, gateway choice, OAuth approach, generation/curation strategy, and the stateless model — each with code-grounded rationale.
- Add **throwaway de-risking spikes** under `spikes/add-mcp-hosting-adr-spikes/` (not production code), covering:
  - **(a) Runtime + gateway:** ToolHive K8s Operator vs. **reuse the existing Knative per-tenant functions runtime** (each MCP server = a ksvc; scale-to-zero already enabled in `deploy/kind/knative`; namespace-per-tenant proven by `services/provisioning-orchestrator/src/appliers/functions-applier.mjs`) vs. a bespoke controller; gateway **agentgateway** vs. reuse **APISIX** (ADR-3). Prototype proves tenant isolation (cross-namespace probe fails).
  - **(b) OAuth 2.1 AS on Keycloak:** dynamic client registration, consent (precedent `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs`), per-tool scopes, token lifecycle on the realm-per-tenant Keycloak (`services/adapters/src/keycloak-admin.mjs`).
  - **(c) Instant-MCP generation + mandatory curation:** resources→tools generation with a measured LLM tool-call quality delta (raw vs. pruned + rewritten descriptions).
  - **(d) Statelessness & scale-to-zero:** stateless request path + cold-start behavior.
- Design for the **stateless core** from day one; remote transport is **Streamable HTTP** (stdio is local-dev only); runtime and gateway are **internal-only platform components, never tenant-exposed**.
- Treat **2026-07-28** as an *announced RC*: verify wording against the official spec before any child change locks a server contract to it.

## Capabilities

### New Capabilities
- `mcp`: Tenant-facing MCP server hosting — hosting and exposing MCP servers (official first-party, Instant-MCP-generated, and custom BYO) for tenants, including the runtime model, inbound Streamable-HTTP gateway, OAuth 2.1 authorization, tool curation, supply-chain controls, and per-tenant isolation. This change establishes the foundational decision-level requirements; behavior is implemented in later changes.

### Modified Capabilities
<!-- None. Downstream changes (gateway routing, IAM/OAuth, tenant-isolation) will modify those specs when they implement against this ADR. -->

## Impact

- **Docs:** new ADR in `docs-site/architecture/adrs.md` (decision record only).
- **Spikes:** new throwaway code under `spikes/add-mcp-hosting-adr-spikes/` (ephemeral, not shipped — like `spikes/add-flows-adr-temporal-spikes/`).
- **Specs:** new `openspec/specs/mcp/` capability (created on archive).
- **No production runtime, API, or chart changes** in this change — those are #388–#403. No public HTTP contract change.
- **External references evaluated** (decision inputs, not dependencies): ToolHive Operator (Apache-2.0), agentgateway (Apache-2.0), MCP Inspector; existing internals: Knative functions runtime, APISIX gateway, Keycloak IdP, Temporal Flows.
