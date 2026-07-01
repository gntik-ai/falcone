# API Reference — Control Plane

All public HTTP routes are listed in `services/gateway-config/public-route-catalog.json` and tagged with a **privilege domain**. This page is the index; the data-plane families have their own pages ([PostgreSQL](/api/postgresql), [MongoDB](/api/mongodb), [Realtime](/api/realtime), [Gateway](/api/gateway)).

## Base URL & versioning

All routes are under `/v1` and served through the gateway:

```
https://<api-host>/v1/...
```

## Authentication

| Method | Header | Notes |
| --- | --- | --- |
| API key | `apikey: flc_anon_…` / `flc_service_…` | Data plane; also `?apikey=` for SSE |
| Bearer JWT | `Authorization: Bearer <jwt>` | Operator/admin; issued by Keycloak |

The tenant/workspace are resolved **from the credential**, in precedence order (API key → JWT → gateway headers). Invalid credentials return `401` and never fall back to headers. See [Security](/architecture/security).

## Privilege domains

| Domain | Meaning |
| --- | --- |
| `structural_admin` | Lifecycle & management — requires admin/owner scope |
| `data_access` | Day-to-day data plane |

## Structural-admin routes

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/tenants` | Create a tenant |
| PUT | `/v1/tenants/{id}` | Update a tenant |
| DELETE | `/v1/tenants/{id}` | Soft-delete a tenant |
| POST | `/v1/workspaces` | Create a workspace |
| PUT | `/v1/workspaces/{id}` | Update a workspace |
| DELETE | `/v1/workspaces/{id}` | Soft-delete a workspace |
| GET | `/v1/workspaces/{id}/members` | List members |
| POST | `/v1/workspaces/{id}/members` | Add a member |
| DELETE | `/v1/workspaces/{id}/members/{memberId}` | Remove a member |
| GET | `/v1/schemas` | List schemas/collections |
| POST | `/v1/schemas` | Define a schema/collection |
| PUT | `/v1/schemas/{id}` | Update a schema |
| DELETE | `/v1/schemas/{id}` | Drop a schema |
| POST | `/v1/functions` | Deploy a function *(function_deployment)* |
| PUT | `/v1/functions/{id}/config` | Configure a function *(function_deployment)* |
| DELETE | `/v1/functions/{id}` | Remove a function *(function_deployment)* |
| POST | `/v1/api-keys` | Mint an anon/service API key |
| DELETE | `/v1/api-keys/{id}` | Revoke an API key |
| POST | `/v1/services/configure` | Configure a backing service |
| PUT | `/v1/quotas` | Set quota limits |

## Data-access routes

| Method | Path | Family |
| --- | --- | --- |
| GET/POST | `/v1/collections/{name}/documents` | [Data API](/api/postgresql) |
| PUT/DELETE | `/v1/collections/{name}/documents/{id}` | Data API |
| POST | `/v1/collections/{name}/query` | Data API |
| GET/PUT/DELETE | `/v1/objects/{bucket}/{key}` | Object storage |
| POST | `/v1/functions/{id}/invoke` | Functions *(function_deployment)* |
| GET | `/v1/analytics/query` | Analytics |
| POST | `/v1/events/publish` | [Events](/api/realtime) |
| GET | `/v1/events/subscribe` | [Realtime](/api/realtime) (SSE) |

## Flows routes *(Preview)*

Served by the control-plane runtime when Flows is enabled (`TEMPORAL_ADDRESS`). Workspace-scoped;
authoring is `structural_admin`, running/observing is `data_access`. See the
[Flows guide](/guide/flows) and the [Workflow DSL Reference](/architecture/workflow-dsl-reference).

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/v1/flows/workspaces/{ws}/flows` | List / create flows |
| GET/PATCH/DELETE | `…/flows/{flowId}` | Get / update / delete a flow |
| POST | `…/flows/{flowId}/validate` | Validate a draft (FLW-E checks) |
| GET/POST | `…/flows/{flowId}/versions` | List / publish immutable versions |
| GET/POST | `…/flows/{flowId}/executions` | List / start runs |
| GET | `…/executions/{executionId}` | Run status |
| POST | `…/executions/{executionId}/cancellations` · `…/retries` · `…/signals/{name}` | Cancel / retry / signal |
| GET | `…/executions/{executionId}/events` | Run event stream (SSE) |

## MCP management routes *(Preview)*

Served by the control-plane runtime when MCP hosting is enabled (`MCP_ENABLED`). Workspace-scoped;
the tenant is credential-derived, so a cross-tenant read/call/audit returns `404`. See the
[MCP guide](/guide/mcp) and [MCP Architecture](/architecture/mcp).

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/v1/mcp/workspaces/{ws}/servers` | List / create a server (`source: instant` \| `official`) |
| GET/DELETE | `…/servers/{serverId}` | Get (endpoint, version, tools) / delete |
| POST | `…/servers/{serverId}/curations` | Curate the tool set |
| POST | `…/servers/{serverId}/versions` | Publish a version |
| POST | `…/servers/{serverId}/versions/{version}/approval` | Approve a held (rug-pull-reviewed) version |
| POST | `…/servers/{serverId}/tool-calls` | Invoke a tool (control-plane-mediated) |
| GET | `…/servers/{serverId}/audit` | Tenant-scoped audit trail |

> Flows and MCP routes are served directly by the control-plane runtime; gateway public-surface
> registration in the route catalog is part of the ongoing work.

## Errors

Errors are JSON with a stable `code` and a `message`:

```json
{ "code": "IDENTITY_MISSING", "message": "Missing tenant identity" }
```

IAM and other Keycloak-admin-backed mutations keep the same stable domain `code`
(`IAM_ASSIGN_ROLE_FAILED`, `CREATE_SA_FAILED`, and similar) when the upstream identity provider
rejects an admin request. The client-facing `message` is sanitized and must not include internal
Keycloak admin URLs, raw `keycloak METHOD /realms/...` request lines, tenant realm path fragments, or
verbatim upstream Keycloak response bodies. Server-side diagnostics retain method, path, upstream
status, and response body for logs/debugging without serializing those details into API responses.

| Status | When |
| --- | --- |
| `400` | Malformed body/query (`INVALID_JSON`, `INVALID_QUERY_JSON`) |
| `401` | Missing/invalid credential (fails closed) |
| `403` | Wrong privilege domain / scope |
| `404` | Unknown resource |
| `429` | Rate limit exceeded |
| `502/503` | Upstream/backend unavailable (`UPSTREAM_UNAVAILABLE`, `WORKSPACE_DB_UNRESOLVED`) |
