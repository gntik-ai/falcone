# Data: Functions Console Contract Mapping

The Data: Functions console (`/console/functions/data`) is a thin UI over the published functions
API. It does not own a separate workspace-scoped write surface. The console must keep the route and
field mapping below in sync with `apps/control-plane/openapi/control-plane.openapi.json` and the
kind control-plane route table.

| Console action | API route | Contract notes |
| --- | --- | --- |
| List workspace functions | `GET /v1/functions/workspaces/{workspaceId}/actions` | Returns a `FunctionActionCollection`. Rows are keyed by `resourceId`; display uses `actionName` and `execution.runtime`. |
| Deploy a function | `POST /v1/functions/actions` | Sends a function action write body containing the active `tenantId`, active `workspaceId`, `actionName`, `source`, `execution`, and `activationPolicy`. Do not post deploys to the workspace list route. |
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
