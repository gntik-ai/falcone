# API Reference — Gateway & Routing

The APISIX gateway is the single entry point. It classifies each request by credential, enforces the route's privilege domain, rate-limits per key, and injects verified identity headers before forwarding. Route definitions are catalogued in `services/gateway-config/public-route-catalog.json`; policy is built in `scripts/lib/gateway-policy.mjs`.

## Credential classification

| Credential | How it's matched | Routed to |
| --- | --- | --- |
| API key | `apikey` header matching `^flc_` (route `vars`) | Executor (data plane) |
| Bearer JWT | validated `Authorization: Bearer …` | Control plane / data plane with injected identity |

The gateway accepts the key in several forms downstream (`apikey:`, `x-api-key:`, `Authorization: ApiKey/Bearer flc_…`), and `?apikey=` for SSE — but the canonical public form is the **`apikey` header**.

## Anon vs service keys

| | `flc_anon_…` | `flc_service_…` |
| --- | --- | --- |
| Audience | browser / public | server-side / CI |
| Privilege | read-mostly, bound to a non-`BYPASSRLS` DB role (RLS applies) | elevated within the tenant |
| SSE via `?apikey=` | yes | not recommended (don't expose) |

Mint keys with `POST /v1/api-keys` (`structural_admin`); revoke with `DELETE /v1/api-keys/{id}`. The key encodes the `(tenant, workspace, DB role, scopes)` it resolves to.

## Identity injection

After validating a token, the gateway injects trusted context and **strips any client-supplied** equivalents:

```
x-tenant-id      x-workspace-id     x-auth-subject     x-pg-role
```

Downstream services trust these only when no stronger credential (API key / verified JWT) was presented — see the [precedence rules](/architecture/overview#identity-resolution-precedence).

## Scope enforcement

Each route declares a `privilege_domain` (`structural_admin` | `data_access`); function routes add a `function_deployment` sub-domain. A custom plugin rejects callers whose verified scope doesn't permit the route's domain (`403`). Specs: `services/gateway-config/tests/plugins/scope-enforcement-*`.

## Rate limiting

APISIX `limit-count`, configured for **per-key** buckets:

```yaml
plugins:
  limit-count:
    key_type: var_combination     # per-key; `var` alone would key globally
    key: $http_apikey
    count: <N>
    time_window: <seconds>
    policy: local                  # node-local (≈ N× with N gateway replicas)
    # policy: redis                # globally exact, needs Redis
    rejected_code: 429
```

- `policy: local` — fast, no dependency, but the effective limit scales with gateway replica count.
- `policy: redis` — globally exact across replicas, at the cost of a Redis dependency.

Per-tenant **quotas** (from the plan's `quota_policy`) provide higher-level resource limits on top of rate limiting.

## Exposure

Routes are published as Kubernetes **Ingress** or OpenShift **Routes** depending on `platform.network.exposureKind`. Realtime routes get an extended timeout (SSE). The bootstrap job reconciles routes from the chart on install/upgrade.

> **Flows & MCP *(Preview)*.** The [Flows](/api/control-plane#flows-routes-preview) (`/v1/flows`) and [MCP management](/api/control-plane#mcp-management-routes-preview) (`/v1/mcp`) surfaces are served by the **control-plane runtime** (gateway public-surface registration in the route catalog is ongoing). Hosted **MCP-server pods are internal-only** (NetworkPolicy) — agents reach them over Streamable HTTP through the gateway with an OAuth 2.1 token, never directly.
