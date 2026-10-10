# Data: Functions Console Contract Mapping

The Data: Functions console (`/console/functions/data`) is a thin UI over the published functions
API. It does not own a separate workspace-scoped write surface. The console must keep the route and
field mapping below in sync with `apps/control-plane-executor/openapi/control-plane.openapi.json` and the
kind control-plane route table.

| Console action | API route | Contract notes |
| --- | --- | --- |
| List workspace functions | `GET /v1/functions/workspaces/{workspaceId}/actions` | Returns a `FunctionActionCollection`. Rows are keyed by `resourceId`; display uses `actionName` and `execution.runtime`. The route (and its `GET /v1/functions/workspaces/{workspaceId}/inventory` sibling) is tenant-scoped: the kind control-plane resolves `workspaceId` against the caller's verified tenant, so a foreign or unknown workspace returns `403` (no existence oracle) and never another tenant's rows or `source.inlineCode`. |
| Deploy a function | `POST /v1/functions/actions` | Sends a function action write body containing the active `tenantId`, active `workspaceId`, `actionName`, `source`, `execution`, and `activationPolicy`. Do not post deploys to the workspace list route. |
| Delete a function | `DELETE /v1/functions/actions/{resourceId}` | Selection must provide the `resourceId` from the list/detail response. The console must require destructive confirmation, send an `Idempotency-Key`, refresh inventory only after the DELETE succeeds, and clear the deleted selection. |
| Invoke a function | `POST /v1/functions/actions/{resourceId}/invocations` | Selection must provide the `resourceId` from the list response. Plain input JSON is wrapped as `{ "parameters": ... }`; an existing invocation envelope is sent unchanged. |
| List activations | `GET /v1/functions/actions/{resourceId}/activations` | Uses the same selected `resourceId`. The route is not workspace/name scoped. |

The console's simple deploy JSON editor still accepts the legacy convenience form:

```json
{
  "name": "hello",
  "runtime": "nodejs",
  "code": "exports.main = async () => ({ \"ok\": true })",
  "main": "main"
}
```

Before the request is sent, the web-console client maps that form to the action write contract:

```json
{
  "workspaceId": "wrk_...",
  "tenantId": "ten_...",
  "actionName": "hello",
  "source": {
    "kind": "inline_code",
    "language": "javascript",
    "inlineCode": "exports.main = async () => ({ \"ok\": true })",
    "entryFile": "index.js"
  },
  "execution": {
    "runtime": "nodejs:20",
    "entrypoint": "main",
    "parameters": {},
    "environment": {},
    "limits": {
      "timeoutSeconds": 60,
      "memoryMb": 256
    },
    "webAction": {
      "enabled": false,
      "requireAuthentication": true,
      "rawHttpResponse": false
    }
  },
  "activationPolicy": {
    "logsAccess": "workspace_developers",
    "resultAccess": "workspace_developers",
    "rerunPolicy": "manual_only",
    "retentionHours": 168
  }
}
```

Already contract-shaped JSON can be pasted into the editor. The client preserves it and stamps the
currently selected `tenantId` and `workspaceId` so the body scope matches the active console tenant
and workspace.

Function deletion is a structural function lifecycle action. The kind control-plane resolves the
action row through the caller's tenant scope before any authorization decision or teardown side
effect. Cross-tenant or missing actions return not found without revealing existence. For an owned
action, the delete path removes the current `fn_actions` row, retained `fn_action_versions`, and
`fn_activations`, and requests deletion of the associated Knative service when `ksvc_name` is known.
The Knative delete helper treats an already-absent service as a clean success so retries do not leave
the console stuck on cluster garbage-collection timing.

## Authorization and isolation

Workspace function listing is tenant-scoped. The workspace-scoped LIST routes —
`GET /v1/functions/workspaces/{workspaceId}/inventory` and
`GET /v1/functions/workspaces/{workspaceId}/actions` — resolve the addressed workspace against the
caller's verified tenant before returning any function data. When the caller's tenant does not own
the workspace, or the workspace does not exist, the control-plane returns a uniform `403` with no
function data and no field that distinguishes "not yours" from "does not exist" (no existence
oracle); it never returns another tenant's function metadata or `source.inlineCode`. A
platform-trusted caller may read across tenants only on platform-observability routes. Function
resource routes require a verified workspace claim matching the addressed workspace; an actor type,
`superadmin` label, or internal flag alone is never a workspace grant. The store query also carries
the caller's tenant as a predicate (`fn_actions.tenant_id`) as defense-in-depth.

Workspace function deploy/update is also tenant-scoped. `POST /v1/functions/actions` (create) and
`PATCH /v1/functions/actions/{actionId}` (update) share one handler, which resolves the body
`workspaceId` against the caller's verified tenant before any create/deploy/update side effect. When
the caller's tenant does not own the workspace, or the workspace does not exist, the control-plane
returns a uniform `403` and performs no write — it never creates or overwrites an `fn_actions` row
and never deploys a Knative service into another tenant's workspace, and (as with the LIST routes)
the response does not distinguish a foreign workspace from a non-existent one. Mutation requires an
allowed workspace role (`workspace_owner`, `workspace_admin`, or `workspace_developer`) and a
matching verified workspace claim. Tenant owner/admin, platform operator, internal actor, and
actor-type-only superadmin credentials are denied.

Create and update return HTTP `202` with the exact seven-field `GatewayMutationAccepted` envelope:
`accepted`, `operation`, `resourceType`, `resourceId`, `status`, `correlationId`, and
`idempotencyKey`. Delete returns `FunctionDeletionAccepted`. Neither response proves that a Knative
Service has already disappeared.

Direct and aggregate teardown use stable tenant/function ownership labels, GET verification, and
UID/resourceVersion delete preconditions. An outage, ownership mismatch, replacement, or conflict
fails closed: the API returns `202 cleanup_pending`, retains metadata and ownership rows, and
creates/reuses an owner-scoped durable obligation. Recovery is idempotent and never selects an
adjacent owner's resource by an unscoped name. Hosted MCP state is the durable `falcone_mcp_state`
snapshot, retained until it can be reconciled safely.

## OpenAPI 1.22.0 contract correction (issue #992)

The functions family now advertises only the 23 operations served by the merged control-plane
runtime table. The previous contract contained 55 functions-family operations: 54 under
`/v1/functions` and one admin audit coverage operation. The 32 operations below had no runtime
route and returned `404 NO_ROUTE`; they are withdrawn rather than implemented in this change.

This is a minor contract correction within `/v1`: no served request, response, authentication, or
authorization behavior changes, so the existing policy requiring a new URI family for runtime
breaking changes does not apply. Generated SDKs will lose methods for the withdrawn operations;
clients must stop relying on those declarations. There is no deprecation replacement or coexistence
window for operations that were never served.

Functions support synchronous client invocation, manual activation rerun, lifecycle operations,
definition export/import (including packages), and workspace secrets. Event-driven and scheduled
invocation, trigger/rule management, HTTP exposure, package CRUD, quota queries, and audit queries
require a separate implementation enhancement. Optional trigger fields in served action schemas
and the console remain for compatibility; their presence does not enable automation.

Edit `apps/control-plane-executor/openapi/families/functions.openapi.json` for functions changes,
then run `npm run generate:public-api`. The generator merges that family source into the unified
contract, removes schemas made unreachable by withdrawal, and refreshes family contracts, the
route catalog, and public API docs. Other families still use the unified contract as their source.
The functions parity contract test reads both the shipped runtime map and seed routes without
network, cluster access, or credentials.

| Withdrawn operationId | Method | Path |
| --- | --- | --- |
| getFunctionAuditCoverage | GET | `/v1/admin/functions/audit/coverage` |
| createFunctionCronTrigger | POST | `/v1/functions/actions/{resourceId}/cron-triggers` |
| getFunctionCronTrigger | GET | `/v1/functions/actions/{resourceId}/cron-triggers/{triggerId}` |
| deleteFunctionHttpExposure | DELETE | `/v1/functions/actions/{resourceId}/http-exposure` |
| getFunctionHttpExposure | GET | `/v1/functions/actions/{resourceId}/http-exposure` |
| updateFunctionHttpExposure | PATCH | `/v1/functions/actions/{resourceId}/http-exposure` |
| createFunctionHttpExposure | POST | `/v1/functions/actions/{resourceId}/http-exposure` |
| createFunctionKafkaTrigger | POST | `/v1/functions/actions/{resourceId}/kafka-triggers` |
| getFunctionKafkaTrigger | GET | `/v1/functions/actions/{resourceId}/kafka-triggers/{triggerId}` |
| createFunctionStorageTrigger | POST | `/v1/functions/actions/{resourceId}/storage-triggers` |
| getFunctionStorageTrigger | GET | `/v1/functions/actions/{resourceId}/storage-triggers/{triggerId}` |
| getFunctionVersion | GET | `/v1/functions/actions/{resourceId}/versions/{versionId}` |
| getFunctionTenantQuota | GET | `/v1/functions/tenants/{tenantId}/quota` |
| listFunctionDeploymentAudit | GET | `/v1/functions/workspaces/{workspaceId}/audit` |
| listFunctionQuotaEnforcement | GET | `/v1/functions/workspaces/{workspaceId}/audit/quota-enforcement` |
| listFunctionRollbackEvidence | GET | `/v1/functions/workspaces/{workspaceId}/audit/rollback-evidence` |
| listFunctionPackages | GET | `/v1/functions/workspaces/{workspaceId}/packages` |
| createFunctionPackage | POST | `/v1/functions/workspaces/{workspaceId}/packages` |
| deleteFunctionPackage | DELETE | `/v1/functions/workspaces/{workspaceId}/packages/{packageName}` |
| getFunctionPackage | GET | `/v1/functions/workspaces/{workspaceId}/packages/{packageName}` |
| updateFunctionPackage | PATCH | `/v1/functions/workspaces/{workspaceId}/packages/{packageName}` |
| getFunctionWorkspaceQuota | GET | `/v1/functions/workspaces/{workspaceId}/quota` |
| listFunctionRules | GET | `/v1/functions/workspaces/{workspaceId}/rules` |
| createFunctionRule | POST | `/v1/functions/workspaces/{workspaceId}/rules` |
| deleteFunctionRule | DELETE | `/v1/functions/workspaces/{workspaceId}/rules/{ruleName}` |
| getFunctionRule | GET | `/v1/functions/workspaces/{workspaceId}/rules/{ruleName}` |
| updateFunctionRule | PATCH | `/v1/functions/workspaces/{workspaceId}/rules/{ruleName}` |
| listFunctionTriggers | GET | `/v1/functions/workspaces/{workspaceId}/triggers` |
| createFunctionTrigger | POST | `/v1/functions/workspaces/{workspaceId}/triggers` |
| deleteFunctionTrigger | DELETE | `/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}` |
| getFunctionTrigger | GET | `/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}` |
| updateFunctionTrigger | PATCH | `/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}` |
