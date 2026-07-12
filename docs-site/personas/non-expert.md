# Start Here: Non-expert User

Use this path when you want to see Falcone running and understand the basic objects before you dig
into Kubernetes or API details.

Falcone's current platform model is:

| Object | What it means |
| --- | --- |
| Tenant | The customer or account boundary. Tenant IDs use the `ten_...` shape in the generated contracts, while the running control-plane currently returns UUID-backed IDs from its local tenant handler. |
| Workspace | The project boundary inside a tenant. Workspaces have an `environment` field. Supported environments in the OpenAPI contract are `dev`, `sandbox`, `staging`, `prod`, and `preview`. |
| Service account | A workspace-scoped non-human credential. Runtime routes live under `/v1/workspaces/{workspaceId}/service-accounts`. |
| Function | A governed serverless action under `/v1/functions/actions`. |
| Flow | A workspace-scoped durable workflow under `/v1/flows/workspaces/{workspaceId}/flows`. Flows are Preview. |

There is no standalone public `stage` entity in the generated contracts. When guides say "stage",
they mean a workspace's `environment`.

## Fastest useful path

1. Install the platform locally with [Quickstart: kind](/guide/quickstart).
2. Log in to the console as `superadmin`.
3. Create your first tenant and workspace from the API command path in the quickstart, or use the
   console after the bootstrap job has created the platform realm and superadmin user.
4. Open [What is In Falcone?](/guide/what-is-falcone) for the guided console tour.

## What you should verify

After the quickstart, these checks should pass:

```bash
kubectl -n falcone get pods
kubectl -n falcone wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
curl -sS http://127.0.0.1:8080/readyz
```

Expected health response:

```json
{"status":"ok"}
```

The quickstart also creates a tenant and a workspace. The important output fields are:

```json
{
  "tenantId": "...",
  "workspaceId": "...",
  "environment": "dev"
}
```

## Where to go next

- [Developer persona](/personas/developer) if you want to call the API or build an app.
- [DevOps / operator persona](/personas/operator) if you need a real Kubernetes or OpenShift install.
- [API reference](/api/control-plane) if you want the current route map.
