# Start Here: Developer

Use this path when you already have a running Falcone platform and need to build against its current
API.

## Current API shape

The generated OpenAPI file is:

```text
apps/control-plane-executor/openapi/control-plane.openapi.json
```

Its public API title is `In Falcone Public API`, version `1.21.0`, with routes under `/v1`.
The gateway route catalog is:

```text
deploy/gateway-config/public-route-catalog.json
```

The kind/control-plane runtime also carries local routes in:

```text
apps/control-plane/routes.mjs
apps/control-plane/b-handlers.mjs
```

## Build sequence

For an end-to-end API walk-through, use [Developer End-to-End](/guide/developer-end-to-end).
It follows this order:

1. Reuse the tenant and workspace from the [kind quickstart](/guide/quickstart).
2. Treat the workspace `environment` as your stage (`dev`, `sandbox`, `staging`, `prod`, or
   `preview`).
3. Deploy a function with `POST /v1/functions/actions`.
4. Invoke the function with `POST /v1/functions/actions/{resourceId}/invocations`.
5. Create, validate, publish, and run a Flow with the `/v1/flows/workspaces/{workspaceId}/flows`
   route family.

## Data and realtime routes

The old `/v1/collections/{name}/documents` and `/v1/events/subscribe` examples have been removed
from the public guide path because they do not match the current generated OpenAPI/runtime data
routes.

Use these current route families:

| Capability | Route family |
| --- | --- |
| PostgreSQL rows | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows` |
| Mongo/FerretDB documents | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents` |
| Realtime document changes | `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes` |
| Realtime PostgreSQL row changes | `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes` |
| Event topics | `/v1/events/topics` and `/v1/events/topics/{resourceId}/publish` |
| Workspace service accounts | `/v1/workspaces/{workspaceId}/service-accounts` |
| MCP | `/v1/mcp/workspaces/{workspaceId}/servers` |

## Contract and CLI scope

The repository ships the OpenAPI contract, not a general-purpose tenant/workspace/function SDK.
Generate or configure a client from `apps/control-plane-executor/openapi/control-plane.openapi.json`
with the toolchain your application already uses, and keep the generated client pinned to the contract
version you test. The HTTP examples in [Developer End-to-End](/guide/developer-end-to-end) are the
supported path for the current tenant, workspace, data, function, and workflow surface.

The repository's MCP-only CLI can be inspected with:

```bash
node tools/falcone-cli/bin/falcone.mjs --help
```

Its current usage is:

```text
falcone mcp init <ts|python|go> --name <server>
falcone mcp dev [--port <n>]
falcone mcp deploy (--image <ref> | --source <dir>)
```

Use HTTP API examples for tenant, workspace, data, function, and workflow tasks until a broader CLI
surface exists.
