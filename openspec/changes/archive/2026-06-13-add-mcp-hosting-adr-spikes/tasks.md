## 1. Spike harness

- [x] 1.1 Create `spikes/add-mcp-hosting-adr-spikes/` with a README stating these are throwaway de-risking spikes (not production code), mirroring `spikes/add-flows-adr-temporal-spikes/`
- [x] 1.2 Add a minimal MCP server fixture (Streamable HTTP, one read tool + one scoped mutating tool) used by all spikes
- [x] 1.3 Record evidence under `spikes/add-mcp-hosting-adr-spikes/*/evidence/`

## 2. Spike (a) — runtime + gateway, tenant isolation

- [x] 2.1 Deploy the fixture as a **Knative ksvc** in a per-tenant namespace (reuse the functions-runtime pattern) and confirm HTTP invocation + scale-to-zero
- [ ] 2.2 Deploy the fixture via the **ToolHive operator** (`MCPServer` CR) in a per-tenant namespace; record non-root/restricted-SCC fit on an OpenShift-like profile
- [ ] 2.3 Front both with the candidate gateway (**APISIX** route + scope plugin; **agentgateway** if needed) terminating Streamable HTTP
- [ ] 2.4 Run a **cross-namespace probe**: a workload in tenant B's namespace MUST fail to reach tenant A's server (NetworkPolicy enforced); capture the failing result as evidence
- [x] 2.5 Record the runtime + gateway decision with measured pros/cons

## 3. Spike (b) — OAuth 2.1 Authorization Server on Keycloak

- [ ] 3.1 In a realm-per-tenant Keycloak, model two per-tool scopes and a client; complete the OAuth 2.1 code flow and obtain a per-tool-scoped token
- [ ] 3.2 Exercise **dynamic client registration** curated through a control-plane shim (no raw Keycloak admin exposure) and present/record **consent**
- [ ] 3.3 Verify token lifecycle (refresh, revoke) and that a revoked token is rejected at the gateway; cross-realm token MUST NOT authorize another tenant
- [ ] 3.4 Record what Keycloak provides natively vs. what Falcone must add

## 4. Spike (c) — Instant-MCP generation + mandatory curation

- [ ] 4.1 Generate a draft tool manifest from a sample Postgres schema + a function + storage + events (RLS-bound query tools via the executor/adapter plan pattern)
- [ ] 4.2 Produce a **raw** tool set and a **curated** tool set (pruned + LLM-optimized descriptions)
- [ ] 4.3 Measure tool-call quality (raw vs. curated) on a small task set and record the delta justifying the mandatory-curation gate

## 5. Spike (d) — statelessness + scale-to-zero

- [x] 5.1 Demonstrate a stateless request path (no per-connection server state required across requests)
- [x] 5.2 Measure idle scale-to-zero and cold-start latency for the hosted fixture

## 6. ADR + spec finalization

- [x] 6.1 Append a new **ADR** to `docs-site/architecture/adrs.md` recording the runtime, gateway, OAuth, generation/curation, and statelessness decisions with spike evidence references
- [ ] 6.2 Verify MCP spec wording against the official **2025-11-25** stable spec; flag any **2026-07-28** RC dependency as provisional in the ADR
- [x] 6.3 Run `openspec validate add-mcp-hosting-adr-spikes --strict` and fix any issues
- [x] 6.4 Confirm the spikes are removable without affecting production (throwaway) and that no production runtime/chart/API changed in this change
