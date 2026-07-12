# API Reference: Control Plane

The generated OpenAPI file is:

```text
apps/control-plane-executor/openapi/control-plane.openapi.json
```

It identifies the public API as `In Falcone Public API`, version `1.21.0`, with versioned routes
under `/v1`. Public gateway routes are catalogued in:

```text
deploy/gateway-config/public-route-catalog.json
```

The runnable control-plane and executor also carry local runtime route tables in:

```text
apps/control-plane/routes.mjs
apps/control-plane/b-handlers.mjs
apps/control-plane-executor/src/runtime/server.mjs
```

## Base URL

Through the gateway:

```text
https://<api-host>/v1/...
```

When port-forwarding the local quickstart, direct service URLs are:

```text
http://127.0.0.1:8080/v1/...   # control-plane service
http://127.0.0.1:8082/v1/...   # control-plane-executor service
```

## Authentication

| Method | Public form | Notes |
| --- | --- | --- |
| Bearer JWT | `Authorization: Bearer <jwt>` | Used by operators, tenant owners, workspace users, and service-account clients. |
| API key | `apikey: flc_...` | Executor data-plane routes support API-key identity when issued for a workspace. |
| SSE query key | `?apikey=flc_...` | Only for browser EventSource routes that cannot set headers. Header identity wins when both are present. |

Tenant and workspace identity must come from a verified credential or trusted gateway headers. Do
not send tenant/workspace IDs as a substitute for authentication.

## Tenant and workspace routes

Generated OpenAPI exposes canonical tenant and workspace mutations:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/tenants` | List or create tenants. |
| `GET` / `PUT` / `DELETE` | `/v1/tenants/{tenantId}` | Read, update, or delete a tenant. |
| `GET` / `POST` | `/v1/workspaces` | List or create workspaces in the generated contract. |
| `GET` / `PUT` / `DELETE` | `/v1/workspaces/{workspaceId}` | Read, update, or delete a workspace. |

The current local control-plane runtime also supports:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` / `GET` | `/v1/tenants/{tenantId}/workspaces` | Create or list workspaces for one tenant. |
| `GET` | `/v1/tenants/{tenantId}/environments` | List tenant environments. |
| `POST` | `/v1/tenants/{tenantId}/exports` | Export non-secret tenant configuration. |
| `POST` | `/v1/workspaces/{workspaceId}/promotions` | Promote workspace definitions between environments in the same tenant. |
| `POST` | `/v1/workspaces/{workspaceId}/clone` | Clone a workspace inside the same tenant. |

The workspace `environment` field is the stage boundary. The generated contract allows `dev`,
`sandbox`, `staging`, `prod`, and `preview`.

## Service accounts and credentials

The current workspace-scoped runtime routes are:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/workspaces/{workspaceId}/service-accounts` | List or create service accounts. |
| `GET` / `DELETE` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}` | Read or delete one service account. |
| `POST` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance` | Issue a credential. |
| `POST` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations` | Rotate credentials. |
| `POST` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations` | Revoke credentials. |

Do not use old examples that mint keys with `POST /v1/api-keys`; the current developer docs use
workspace service accounts and the executor's workspace API-key management routes.

## Functions

Generated OpenAPI exposes governed function actions:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/functions/actions` | Deploy a function action. |
| `GET` / `PATCH` / `DELETE` | `/v1/functions/actions/{resourceId}` | Read, update, or delete an action. |
| `POST` | `/v1/functions/actions/{resourceId}/invocations` | Invoke an action. |
| `GET` | `/v1/functions/actions/{resourceId}/activations` | List activations. |
| `GET` | `/v1/functions/actions/{resourceId}/activations/{activationId}` | Read one activation. |
| `GET` | `/v1/functions/actions/{resourceId}/activations/{activationId}/logs` | Read activation logs. |
| `GET` | `/v1/functions/actions/{resourceId}/activations/{activationId}/result` | Read activation result. |
| `GET` | `/v1/functions/actions/{resourceId}/versions` | List versions. |
| `POST` | `/v1/functions/actions/{resourceId}/rollback` | Roll back to a retained version. |

Functions run as Knative Services created at runtime by the control-plane. On OpenShift, that
requires OpenShift Serverless.

## Data APIs

Current data routes are workspace-addressed. See the dedicated pages:

| Capability | Route family |
| --- | --- |
| PostgreSQL rows | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows` |
| Mongo/FerretDB documents | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents` |
| Event topics | `/v1/events/topics` in OpenAPI, and `/v1/events/workspaces/{workspaceId}/topics` in the runtime executor. |
| Realtime | `/v1/realtime/workspaces/{workspaceId}/...` |

The older `/v1/collections/{name}/documents` examples are no longer used in this docs path.

## Flows routes

Flows are Preview and are served by the control-plane executor when Temporal is wired.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/flows/workspaces/{workspaceId}/task-types` | List task types. |
| `GET` / `POST` | `/v1/flows/workspaces/{workspaceId}/flows` | List or create flows. |
| `GET` / `PATCH` / `DELETE` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}` | Read, update, or delete a flow. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/validate` | Validate a draft. |
| `GET` / `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` | List or publish versions. |
| `GET` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions/{version}` | Read one version. |
| `GET` / `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` | List or start executions. |
| `GET` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}` | Read execution status. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/cancellations` | Cancel an execution. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/retries` | Retry an execution. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/signals/{signalName}` | Send a signal. |
| `GET` | `/v1/flows/workspaces/{workspaceId}/executions/{executionId}/events` | Stream execution events over SSE. |

See [Flows](/guide/flows) and [Workflow DSL Reference](/architecture/workflow-dsl-reference).

## MCP routes

MCP server hosting is Preview:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/mcp/workspaces/{workspaceId}/servers` | List or create MCP servers. |
| `GET` / `DELETE` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}` | Read or delete one server. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/curations` | Curate tool exposure. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/versions` | Publish a version. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/versions/{version}/approval` | Approve a held version. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls` | Invoke one tool through the control plane. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc` | MCP JSON-RPC endpoint. |

Hosted MCP server pods are internal-only and use Knative.

## Errors

Errors are JSON with a stable code and message shape:

```json
{ "code": "UNAUTHENTICATED", "message": "Missing tenant identity" }
```

Common statuses:

| Status | Meaning |
| --- | --- |
| `400` | Malformed JSON, invalid query, or validation error. |
| `401` | Missing or invalid credential. |
| `403` | Authenticated but not allowed for the route or workspace. |
| `404` | Unknown or hidden resource. |
| `409` | Conflict with existing state. |
| `429` | Rate or quota limit. |
| `502` / `503` | Upstream platform dependency unavailable. |
