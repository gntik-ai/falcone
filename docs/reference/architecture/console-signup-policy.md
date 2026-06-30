# Console signup policy and tenant context

The web console self-service signup flow (`/signup`) is driven by the public
control-plane policy endpoint:

```text
GET /v1/auth/signups/policy
```

The kind control-plane handler returns the runtime policy shape consumed by the
console:

```json
{
  "selfServiceEnabled": true,
  "mode": "self_service",
  "statusView": "signup",
  "passwordPolicy": { "minLength": 8 },
  "message": "Self-service signup is enabled."
}
```

The console MUST derive signup availability from `selfServiceEnabled`. Older
client-side fields such as `allowed`, `effectiveMode`, `approvalRequired`, and
`reason` are not emitted by the runtime handler and must not gate the form or
the login-page signup entry point.

## Tenant context

`POST /v1/auth/signups` creates a user in an existing tenant realm, so the
request body must include `tenantId`. The public signup page supports two tenant
context sources:

- A URL-provided tenant context: `/signup?tenantId=<tenant-id>` or
  `/signup?tenant=<tenant-id>`.
- An explicit `Tenant ID` form field for users who reach `/signup` without a
  tenant-bearing link.

If `workspaceId` is present in the URL (`/signup?...&workspaceId=<workspace-id>`)
or entered in the optional field, the console sends it too so the backend can
stamp the created Keycloak user with workspace context.

The console never hardcodes a tenant. A signup submit without a tenant context
is rejected client-side before the backend would return `tenantId is required`.

## Password minimum

The signup password field uses the advertised
`passwordPolicy.minLength` as its client-side `minLength`. The backend remains
authoritative and enforces the same configured minimum at
`POST /v1/auth/signups`, but using the advertised value in the form prevents the
browser from imposing a stale hardcoded minimum that can drift from the runtime
policy.
