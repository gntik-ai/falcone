# Developer End-to-End: Workspace, Function, Flow

This guide starts from a running Falcone platform and a tenant and workspace provided by its
operator. It shows how to treat a workspace as a project/stage boundary, deploy a function,
invoke it, and call that function from a Flow.

The current public model has no standalone `stage` resource. A stage is represented by the
workspace `environment` field. The generated OpenAPI contract allows `dev`, `sandbox`, `staging`,
`prod`, and `preview`.

> [!NOTE]
> The generated OpenAPI schemas use `ten_...` and `wrk_...` identifier patterns. Use the IDs
> returned by your running platform; some runtimes return UUID-backed IDs. Do not hand-write
> ID prefixes.

## What you need

Ask your platform operator for the console and identity hostnames, a tenant ID (also the tenant
realm), tenant slug, workspace ID you may use, and a tenant user's username and password. The
account needs permission to deploy functions and manage and run flows in that workspace. You
also need `curl` and `jq` locally. Replace every placeholder below with the supplied value:

```bash
export API="https://<console hostname>"
export IAM="https://<identity hostname>"
export TENANT_ID="<tenant ID and realm>"
export TENANT_SLUG="<tenant slug>"
export WORKSPACE_ID="<workspace ID>"
export OWNER_USERNAME="<tenant username>"
export OWNER_PASSWORD="<tenant user password>"
```

Use the **console** hostname for `/v1/...` requests: its API proxy forwards them to the gateway.
The operator must configure issuer trust for the identity hostname and have Knative Serving
available before you deploy a function. See the [installation guide](/guide/installation#choose-a-guide)
and the [public surface configuration](/operations/helm-configuration#public-surface).

## 1. Get a tenant-scoped token

The tenant realm name is `TENANT_ID`, and the public app client is derived from the tenant slug.

```bash
export TENANT_TOKEN="$(
  curl -sS -X POST \
    "$IAM/realms/${TENANT_ID}/protocol/openid-connect/token" \
    -H 'content-type: application/x-www-form-urlencoded' \
    -d grant_type=password \
    -d client_id="${TENANT_SLUG}-app" \
    -d username="$OWNER_USERNAME" \
    --data-urlencode "password=${OWNER_PASSWORD}" \
    -d scope=openid | jq -r .access_token
)"
```

Check that the token was issued:

```bash
test "$TENANT_TOKEN" != "null" && test -n "$TENANT_TOKEN"
```

Expected result: the final `test` command exits with status `0` and prints nothing.

Verify the workspace/stage:

```bash
curl -sS "$API/v1/workspaces/$WORKSPACE_ID" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  | jq '{workspaceId, tenantId, slug, environment, state}'
```

Expected output shape:

```json
{
  "workspaceId": "...",
  "tenantId": "...",
  "slug": "acme-dev",
  "environment": "dev",
  "state": "active"
}
```

## 2. Deploy a function

The function runtime expects Node.js source that defines `main(params)`. The generated OpenAPI
route for governed functions is `POST /v1/functions/actions`.

```bash
cat > /tmp/falcone-hello-function.json <<'JSON'
{
  "tenantId": "",
  "workspaceId": "",
  "actionName": "hello-orders",
  "source": {
    "kind": "inline_code",
    "language": "javascript",
    "inlineCode": "function main(params, context) { return { greeting: `hello ${params.name || 'Falcone'}`, workspaceId: context.workspaceId }; }",
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
    "retentionHours": 24
  }
}
JSON

jq --arg tenant "$TENANT_ID" --arg workspace "$WORKSPACE_ID" \
  '.tenantId=$tenant | .workspaceId=$workspace' \
  /tmp/falcone-hello-function.json > /tmp/falcone-hello-function.resolved.json

curl -sS -X POST "$API/v1/functions/actions" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  -H 'content-type: application/json' \
  -H "idempotency-key: fn-hello-$(date +%s)" \
  -d @/tmp/falcone-hello-function.resolved.json \
  | tee /tmp/falcone-function-create.json

export FUNCTION_ID="$(jq -r '.resourceId' /tmp/falcone-function-create.json)"
```

Expected output shape:

```json
{
  "resourceId": "...",
  "status": "accepted",
  "acceptedAt": "..."
}
```

If this returns `FN_DEPLOY_FAILED` with a `serving.knative.dev` API error, Knative Serving is not
available in the cluster or the control-plane service account cannot create Knative Services.

## 3. Invoke the function

```bash
curl -sS -X POST "$API/v1/functions/actions/$FUNCTION_ID/invocations" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  -H 'content-type: application/json' \
  -H "idempotency-key: invoke-hello-$(date +%s)" \
  -d '{
        "parameters": { "name": "Falcone" },
        "triggerContext": { "kind": "direct" },
        "responseMode": "wait_for_result",
        "idempotencyScope": "request"
      }' \
  | tee /tmp/falcone-function-invoke.json

export ACTIVATION_ID="$(jq -r '.invocationId' /tmp/falcone-function-invoke.json)"
```

Expected output shape:

```json
{
  "invocationId": "...",
  "resourceId": "...",
  "status": "completed",
  "acceptedAt": "..."
}
```

Fetch the result:

```bash
curl -sS "$API/v1/functions/actions/$FUNCTION_ID/activations/$ACTIVATION_ID/result" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  | jq '{activationId, status, result}'
```

Expected output shape:

```json
{
  "activationId": "...",
  "status": "succeeded",
  "result": {
    "greeting": "hello Falcone",
    "workspaceId": "..."
  }
}
```

## 4. Create a Flow that calls the function

Flows are workspace-scoped and use the DSL documented in the
[Workflow DSL Reference](/architecture/workflow-dsl-reference). This minimal definition has one
`functions.invoke` task.

```bash
cat > /tmp/falcone-hello-flow.json <<'JSON'
{
  "name": "hello-order-flow",
  "definition": {
    "apiVersion": "v1.0",
    "name": "hello-order-flow",
    "description": "Call the hello-orders function.",
    "nodes": [
      {
        "id": "callFunction",
        "type": "task",
        "taskType": "functions.invoke",
        "input": {
          "actionId": "",
          "params": {
            "name": "Flow"
          }
        }
      }
    ]
  }
}
JSON

jq --arg action "$FUNCTION_ID" \
  '.definition.nodes[0].input.actionId=$action' \
  /tmp/falcone-hello-flow.json > /tmp/falcone-hello-flow.resolved.json

curl -sS -X POST "$API/v1/flows/workspaces/$WORKSPACE_ID/flows" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  -H 'content-type: application/json' \
  -d @/tmp/falcone-hello-flow.resolved.json \
  | tee /tmp/falcone-flow-create.json

export FLOW_ID="$(jq -r '.flowId' /tmp/falcone-flow-create.json)"
```

Expected output shape:

```json
{
  "flowId": "...",
  "name": "hello-order-flow",
  "status": "draft",
  "dslApiVersion": "v1.0"
}
```

Validate and publish version 1:

```bash
curl -sS -X POST "$API/v1/flows/workspaces/$WORKSPACE_ID/flows/$FLOW_ID/validate" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  | jq

curl -sS -X POST "$API/v1/flows/workspaces/$WORKSPACE_ID/flows/$FLOW_ID/versions" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  | tee /tmp/falcone-flow-version.json
```

Expected validation response:

```json
{
  "valid": true
}
```

Expected publish response shape:

```json
{
  "flowId": "...",
  "version": 1,
  "createdAt": "..."
}
```

## 5. Run the Flow

```bash
curl -sS -X POST "$API/v1/flows/workspaces/$WORKSPACE_ID/flows/$FLOW_ID/executions" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  -H 'content-type: application/json' \
  -d '{ "version": 1, "input": { "orderId": "ord-1001" } }' \
  | tee /tmp/falcone-flow-execution.json

export EXECUTION_ID="$(jq -r '.executionId' /tmp/falcone-flow-execution.json)"
```

Expected output shape:

```json
{
  "executionId": "...",
  "workflowId": "...",
  "version": 1,
  "status": "Running"
}
```

Check the run:

```bash
curl -sS "$API/v1/flows/workspaces/$WORKSPACE_ID/flows/$FLOW_ID/executions/$EXECUTION_ID" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  | jq
```

You have now used one workspace as a project/stage, deployed a Knative-backed function, invoked it,
and created a Flow that calls it.

## Cleanup

Delete the function and flow resources when you have finished:

```bash
curl -sS -X DELETE "$API/v1/functions/actions/$FUNCTION_ID" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  | jq

curl -sS -X DELETE "$API/v1/flows/workspaces/$WORKSPACE_ID/flows/$FLOW_ID" \
  -H "authorization: Bearer $TENANT_TOKEN" \
  | jq
```

## Local cluster (operator)

This section applies to a cluster you operate, such as the [kind quickstart](/guide/quickstart).
Creating the tenant, workspace and tenant user is operator work; complete those quickstart steps
first. The public-hostname walkthrough above requires the operator to expose the console and
identity endpoints and configure issuer trust for that identity hostname. See the
[installation guide](/guide/installation#choose-a-guide). The quickstart's local hostnames alone
do not establish ingress or issuer/JWKS trust; making them work is a separate deployment task.

For local diagnosis through direct service endpoints, use the following operator-only setup.
These endpoints bypass the public-hostname path above.

Functions and hosted MCP servers are Knative Services at runtime. For the kind path, install the
repo-provided Knative Serving + Kourier manifests before deploying a function:

```bash
kubectl apply -f deploy/kind/knative/serving-crds.yaml
kubectl apply -f deploy/kind/knative/serving-core.yaml
kubectl apply -f deploy/kind/knative/kourier.yaml
kubectl -n knative-serving wait --for=condition=Available deploy --all --timeout=10m
kubectl -n kourier-system wait --for=condition=Available deploy --all --timeout=10m
kubectl api-resources | grep serving.knative.dev
```

Expected result: `services.serving.knative.dev` appears in the API resource list.

Keep the quickstart control-plane and Keycloak port-forwards running:

```bash
kubectl -n falcone port-forward svc/falcone-control-plane 8080:8080
kubectl -n falcone port-forward svc/falcone-keycloak 8081:8080
```

Add a third port-forward for the executor runtime. Flows, data APIs, events, realtime, MCP, and the
executor-local function routes are served there:

```bash
kubectl -n falcone port-forward svc/falcone-control-plane-executor 8082:8080
```

Set endpoint variables:

```bash
export CONTROL_API=http://127.0.0.1:8080
export EXECUTOR_API=http://127.0.0.1:8082
```

The local identity endpoint is `http://127.0.0.1:8081`. The quickstart assigns tenant and
workspace IDs from its creation responses:

```bash
export TENANT_ID="$(jq -r '.tenantId' /tmp/falcone-tenant.json)"
export WORKSPACE_ID="$(jq -r '.workspaceId' /tmp/falcone-workspace.json)"
```
