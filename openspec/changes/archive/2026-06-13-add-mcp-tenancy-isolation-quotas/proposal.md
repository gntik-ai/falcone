## Why

The cardinal BaaS risk: one tenant reaching another's MCP server, tools, logs, or credentials; plus noisy-neighbor abuse of tool calls / running servers, and idle cost. This is the **P0** isolation + quota issue for the epic (#399, `security`/`tenant-isolation`).

## What Changes

- **Isolation model (ADR-12):** one MCP server per tenant project in the tenant namespace, with the internal-only **NetworkPolicy** (#388) — inbound only from the Knative ingress path, egress constrained to DNS + the platform namespace, so a tenant server **cannot reach another tenant's services**. Endpoint/tools are gateway-only (#389), logs/audit are tenant-scoped (#398), the registry is tenant-scoped (#396), and OAuth credentials are realm-per-tenant (#390) — this change ties those into one isolation contract.
- **Per-tenant quotas + rate limits (plans/quotas capability):** a pure enforcement module gates **running servers per tenant** and **tools per server**, and rate-limits **tool calls/min per server and per OAuth client**, with an **enforcement mode** (`enforced` | `unbounded`). Rate-limit counter keys are tenant+server(+client)-scoped, so one tenant's traffic can never consume or observe another's budget. Breaches return the correct enforcement response (`QUOTA_EXCEEDED` / `RATE_LIMITED`, HTTP 429) and are **audited** (`mcp` audit subsystem).
- **First-class quota dimension:** `mcp_tool_invocations` joins the usage-consumption + quota-policies contracts so MCP usage shows up in the per-tenant quota posture.
- **Scale-to-zero:** idle servers scale to zero via Knative (`min-scale: 0`, proven live in #394) and cold-start on demand — no idle cost.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add **tenancy isolation, quotas & rate limits** — the internal-only NetworkPolicy isolation contract, per-tenant server/tool quotas, per-server/per-OAuth-client tool-call rate limits with enforcement modes and audited breaches, the `mcp_tool_invocations` quota dimension, and idle scale-to-zero. Builds on #387/#388/#389/#390/#396/#398.

## Impact

- **control-plane:** `apps/control-plane/src/mcp-quota.mjs` (pure quota/rate-limit evaluation + tenant-scoped keys + enforcement audit) + tests.
- **chart:** `charts/in-falcone/values.yaml` `mcp.quotas` defaults + enforcement mode (NetworkPolicy already in #388).
- **internal-contracts:** `observability-usage-consumption.json` + `observability-quota-policies.json` gain `mcp_tool_invocations`.
- **Enforcement caveat:** NetworkPolicy is honored only under a policy-enforcing CNI (Calico/Cilium); test-cluster-b runs kindnet, which does NOT enforce it — the policy is verified to apply cleanly and select MCP-server pods, but the behavioral cross-namespace proof is gated on a policy CNI (production/CI).
- **Out of scope:** billing of MCP usage (future, `cap:billing`).
