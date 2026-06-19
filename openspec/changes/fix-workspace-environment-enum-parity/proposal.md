# fix-workspace-environment-enum-parity

## Change type
bugfix

## Capability
tenant-provisioning

## Priority
P2

## Why
The live workspace `environment` catalog is authoritative in
`deploy/kind/control-plane/b-handlers.mjs::ENVIRONMENT_CATALOG` (line 294):

```js
const ENVIRONMENT_CATALOG = ['dev', 'staging', 'prod', 'sandbox', 'preview'];
```

The published OpenAPI schema in
`apps/control-plane/openapi/control-plane.openapi.json` at
`components.schemas.WorkspaceEnvironment.enum` listed only
`['dev', 'sandbox', 'staging', 'prod']` — `preview` was absent. Any
HTTP client or SDK generated from the published spec would treat a valid
`preview` environment value as an illegal enum member and reject it,
causing a spec/implementation split (GitHub issue #637).

The mismatch is a pure contract omission: the runtime handler already
accepts `preview` at line 340–341 (`ENVIRONMENT_CATALOG.includes(environment)`),
and the `GET /v1/tenants/{id}/workspaces/environments` catalog endpoint (line 304)
returns all five values including `preview`.

## What Changes
- `apps/control-plane/openapi/control-plane.openapi.json`:
  `components.schemas.WorkspaceEnvironment.enum` extended from four values
  (`dev`, `sandbox`, `staging`, `prod`) to five by adding `"preview"`, bringing
  the published contract into parity with `ENVIRONMENT_CATALOG`.

## Impact
- Generated clients now accept all five environment values without validation errors.
- No runtime behaviour change — the handler already accepted `preview`.
- Affected spec: `tenant-provisioning`.
