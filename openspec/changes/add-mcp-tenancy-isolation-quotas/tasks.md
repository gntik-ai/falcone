## 1. Per-tenant quota + rate-limit enforcement

- [x] 1.1 `apps/control-plane/src/mcp-quota.mjs`: `evaluateServerCountQuota`, `evaluateToolCountQuota`, `evaluateToolCallRate` (scope server|oauth_client) → allow / QUOTA_EXCEEDED / RATE_LIMITED (HTTP 429, retryAfter); enforcement mode `enforced`|`unbounded`; `MCP_QUOTA_DEFAULTS` per plan tier
- [x] 1.2 `rateLimitKey` tenant+server(+oauth_client)-scoped (isolation — never collides across tenants); `quotaEnforcementAudit` → `mcp`-subsystem audit event (quota_adjustment, denied)
- [x] 1.3 Unit tests (6): each quota/rate evaluation (allow/deny), enforcement modes, key isolation, breach audit

## 2. First-class quota dimension + chart defaults

- [x] 2.1 `observability-usage-consumption.json`: `mcp_tool_invocations` metered dimension (source `mcp_tool_invocations_total`); `observability-quota-policies.json`: `mcp_tool_invocations` supported dimension
- [x] 2.2 `charts/in-falcone/values.yaml` `mcp.quotas` defaults + enforcement mode
- [x] 2.3 Update the genuine count assertions (usage metered dimensions + snapshot dimensions + quota posture dimensions: 9 → 10)

## 3. Isolation (reuse + verify)

- [x] 3.1 Reuse the #388 internal-only NetworkPolicy (egress = DNS + platform namespace only → blocks other tenant namespaces); endpoint gateway-only (#389), logs/audit tenant-scoped (#398), registry tenant-scoped (#396), OAuth realm-per-tenant (#390)
- [x] 3.2 LIVE on test-cluster-b: the NetworkPolicy renders with `mcp.enabled=true`, the API server accepts it (`kubectl apply --dry-run=server`), and it selects `in-falcone.io/component: mcp-server` with egress limited to DNS + platform ns. CNI is kindnet (no NP enforcement) → behavioral cross-namespace proof is gated on a policy CNI (Calico/Cilium), documented
- [x] 3.3 Scale-to-zero: Knative `min-scale: 0` (proven live in #394) — idle servers scale to zero, cold-start on demand

## 4. Verify

- [x] 4.1 `pnpm lint` + affected observability validators pass; full `test:unit` (0 fail) + `test:contracts` (0 fail) + `test:adapters` (104) + control-plane co-located (63) pass
- [x] 4.2 `openspec validate --strict` passes

## 5. Finalize

- [x] 5.1 Note: the module decides, the runtime (APISIX limit-count / control-plane) counts + acts; NetworkPolicy enforcement gated on a policy CNI; billing of MCP usage is out of scope (`cap:billing`)
