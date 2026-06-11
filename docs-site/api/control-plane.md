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

## Errors

Errors are JSON with a stable `code` and a `message`:

```json
{ "code": "IDENTITY_MISSING", "message": "Missing tenant identity" }
```

| Status | When |
| --- | --- |
| `400` | Malformed body/query (`INVALID_JSON`, `INVALID_QUERY_JSON`) |
| `401` | Missing/invalid credential (fails closed) |
| `403` | Wrong privilege domain / scope |
| `404` | Unknown resource |
| `429` | Rate limit exceeded |
| `502/503` | Upstream/backend unavailable (`UPSTREAM_UNAVAILABLE`, `WORKSPACE_DB_UNRESOLVED`) |
