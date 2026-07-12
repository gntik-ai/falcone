# API Reference: Gateway & Routing

APISIX is the public entry point. The route source is the chart bootstrap payload, backed by:

```text
../falcone-charts/charts/in-falcone/values.yaml
../falcone-charts/charts/in-falcone/templates/bootstrap-payload-configmap.yaml
deploy/gateway-config/public-route-catalog.json
```

The bootstrap job `falcone-in-falcone-bootstrap` reconciles the gateway routes on install and
upgrade.

## Credential classification

| Credential | Public form | Resolution |
| --- | --- | --- |
| Bearer JWT | `Authorization: Bearer <jwt>` | JWT is verified, roles/scopes are read from claims, tenant realm tokens derive tenant identity from the verified issuer. |
| API key | `apikey: flc_...`, `x-api-key: flc_...`, or `Authorization: ApiKey flc_...` | Executor verifies the key and resolves tenant, workspace, DB role, and scopes. |
| SSE query key | `?apikey=flc_...` | Accepted only for SSE routes where browser `EventSource` cannot set headers. |

Downstream services must not trust client-supplied `x-tenant-id` or `x-workspace-id` headers. The
executor only trusts gateway-injected headers when the configured gateway trust signal is valid, or
when running in the dev/test mode that has no gateway shared secret configured.

## Route destinations

The chart bootstrap template sends data-plane and executor-required routes to the
`controlPlaneExecutor` upstream. Control-plane management routes go to `controlPlane`.

Examples:

| Route family | Destination |
| --- | --- |
| `/v1/tenants`, `/v1/workspaces`, workspace service accounts, governed function actions | Control plane runtime. |
| `/v1/postgres/...`, `/v1/mongo/...`, `/v1/events/...`, `/v1/realtime/...`, `/v1/flows/...`, `/v1/mcp/...` | Control-plane executor runtime. |

## Workspace binding and cross-tenant checks

The executor enforces:

- API-key credentials bind to a specific workspace.
- JWTs with a `workspace_id` claim must match the workspace in the URL.
- Workspace-addressed structural writes verify the workspace belongs to the caller's tenant.
- Cross-tenant reads are hidden as forbidden or not found depending on the route's contract.

## Rate limiting

APISIX route policy uses route plugins declared through the chart/gateway policy. The gateway
supports per-key rate-limit buckets. Higher-level tenant and workspace quota checks are enforced in
the control-plane/executor route handlers.

## Public exposure

Public exposure is selected by `platform.network.exposureKind`:

| Value | Rendered object |
| --- | --- |
| `Ingress` | Kubernetes `Ingress`, such as `falcone-in-falcone-public`. |
| `LoadBalancer` | Kubernetes `Service` of type `LoadBalancer`. |
| `Route` | OpenShift Routes, such as `falcone-in-falcone-api`, `falcone-in-falcone-console`, `falcone-in-falcone-identity`, and `falcone-in-falcone-realtime`. |

OpenShift Route values set `haproxy.router.openshift.io/timeout: 30s`, which matters for SSE
traffic.

## Service accounts and API keys

Current workspace service-account routes are documented in
[Control Plane](/api/control-plane#service-accounts-and-credentials). Executor API-key management is
workspace-addressed in the runtime. Do not use stale examples that mint credentials with
`POST /v1/api-keys`.

## Preview surfaces

Flows and MCP are Preview but are part of the current route catalog/runtime:

- Flows: `/v1/flows/workspaces/{workspaceId}/...`
- MCP: `/v1/mcp/workspaces/{workspaceId}/...`

Hosted MCP server pods are internal-only and run on Knative; agents reach them through the gateway
and control-plane mediation.
