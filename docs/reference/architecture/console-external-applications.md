# Console External Applications Route Shim

The web console Auth page (`/console/auth`) includes an external-applications and federation
management section. The public API catalog already publishes the workspace application routes, so
the kind control-plane serves those routes locally instead of hiding the section.

The kind implementation is intentionally small and durable: it stores one canonical external
application document per row in `external_applications.app_json`, while indexing the workspace,
tenant, slug, protocol, state, and lifecycle timestamps as columns. Federated providers are embedded
in `app_json.federatedProviders`; there is no separate provider table in the kind shim.

## Served Routes

All routes require an authenticated caller. The handler resolves the workspace from the path before
touching the application registry.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{workspaceId}/applications` | Lists the workspace applications. An owned workspace with no rows returns `200` with an empty collection. |
| `POST` | `/v1/workspaces/{workspaceId}/applications` | Validates and stores one external application, returning `202 accepted` or a structured `400 VALIDATION_ERROR`. |
| `GET` | `/v1/workspaces/{workspaceId}/applications/templates` | Returns starter templates from the existing external-application IAM helper. |
| `GET` | `/v1/workspaces/{workspaceId}/applications/{applicationId}` | Returns one stored external application. |
| `PUT` | `/v1/workspaces/{workspaceId}/applications/{applicationId}` | Updates one stored external application, including `desiredState: "soft_deleted"` from the console delete flow. |
| `GET` | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers` | Lists the embedded federated providers for one application. |
| `POST` | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers` | Adds one embedded federated provider, returning `202 accepted` or structured validation errors. |
| `GET` | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}` | Returns one embedded provider. |
| `PUT` | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}` | Updates one embedded provider without allowing `providerId` changes. |

## Authorization

Read routes allow platform callers and same-tenant authenticated users. Write routes require a
platform caller or a same-tenant `tenant_owner`/`tenant_admin`.

Missing and foreign workspaces both return `404 WORKSPACE_NOT_FOUND` before the handler queries the
applications table. This preserves the no-existence-leak behavior used by other workspace-owned
kind handlers. Same-tenant non-admin users can list/read applications, but mutation attempts return
`403 FORBIDDEN`.

## Validation

Application writes normalize the console payload into the canonical `ExternalApplication` shape and
reuse `apps/control-plane/src/external-application-iam.mjs` for OIDC/SAML validation. Invalid
configuration returns a structured response:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "external application configuration is invalid",
  "validation": {
    "status": "invalid",
    "checks": [
      {
        "code": "missing_authentication_flow",
        "severity": "error",
        "message": "authenticationFlows must declare at least one supported flow.",
        "fieldPath": "authenticationFlows"
      }
    ]
  }
}
```

The console can therefore show a domain validation error instead of an infrastructure `404 NO_ROUTE`.
Valid writes return the published `MutationAccepted` shape with `status: "accepted"`.
