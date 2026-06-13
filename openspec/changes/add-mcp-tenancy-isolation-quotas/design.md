## Context

MCP isolation spans layers already built: the internal-only NetworkPolicy (#388), gateway-only endpoint (#389), realm-per-tenant OAuth (#390), tenant-scoped registry (#396), tenant-scoped audit/logs (#398). What is missing for the cardinal-risk P0 is (a) the per-tenant quota + rate-limit enforcement (noisy-neighbor) and (b) tying isolation into one explicit contract. Quotas wire to the existing plans/quotas capability and the observability quota contracts.

## Goals / Non-Goals

**Goals:** pure, deterministic quota/rate-limit enforcement (server count, tools/server, tool-calls/min per server and per OAuth client) with enforcement modes and audited breaches; tenant-scoped rate-limit keys (isolation); MCP as a first-class quota dimension; the isolation contract stated as requirements.

**Non-Goals:** the runtime counter store (Redis/APISIX limit-count — the module decides, the gateway counts/acts); a new CNI (enforcement is gated on Calico/Cilium); billing; re-implementing #388's NetworkPolicy (reused as-is).

## Decisions

- **Enforcement is a pure decision; counting is the runtime's job.** `evaluate*` take the resolved plan limit + the observed count and return an allow/deny decision (`QUOTA_EXCEEDED`/`RATE_LIMITED`, HTTP 429, `retryAfterSeconds`). The gateway/control-plane maintain the window counts and act on the decision. Keeps the policy unit-testable and the runtime swappable.
- **Tenant-scoped rate keys.** `rateLimitKey` is always prefixed `mcp:rl:<tenant>:<server>` (+`:oac:<client>`), so two tenants with the same server/client id never share a budget — an isolation guarantee that is unit-testable without a live store.
- **Enforcement mode mirrors the quota contract.** `enforced` blocks on breach; `unbounded` always allows — the same two modes the observability-quota-policies contract defines, so plan tiers map cleanly.
- **First-class quota dimension.** `mcp_tool_invocations` is added to usage-consumption (sourced from the `mcp_tool_invocations_total` business family, #398) and to quota-policies `supported_dimensions`, so MCP usage appears in the per-tenant quota posture. Verified against the validator coupling: hard-limit-enforcement requires only its own REQUIRED dimensions (no forced entry), quota-usage-view count-asserts scopes only — so this is a clean two-file additive chain (+ three count assertions updated to the genuine new totals).
- **Reuse #388 NetworkPolicy.** Egress already limited to DNS + platform namespace (blocks other tenant namespaces); no change needed. Verified it renders and the API server accepts it (server dry-run) and that it selects `in-falcone.io/component: mcp-server`.

## Risks / Trade-offs

- *NetworkPolicy not enforced on kindnet* → verified to apply cleanly + select the right pods; behavioral cross-namespace proof gated on a policy CNI (Calico/Cilium), documented in the policy and the spec (same posture as #388).
- *Window counting accuracy* → the module is window-agnostic (takes the observed count); burst vs sliding-window semantics are the runtime's choice.

## Migration Plan

Additive: pure module + tests; chart `mcp.quotas` defaults; two contract dimensions (+ count-assertion updates). No data migration. Quotas default to `enforced` with conservative limits; per-plan overrides resolve at call time.

## Open Questions

- Whether tool-call rate limiting is enforced at APISIX (limit-count plugin) vs the control-plane — the decision shape supports either; production wiring is the runtime follow-up.
- Per-plan quota tiers' exact numbers (defaults here are conservative starting points wired to the plans capability).
