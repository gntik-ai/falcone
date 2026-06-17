Tracking issue: gntik-ai/falcone#493

## Why

`POST /v1/auth/signups {tenantId}` creates the end user in the shared `in-falcone-platform` realm (alongside `superadmin`) rather than in the tenant's own realm, and the user gets no `tenant_id` attribute. The admin path `POST /v1/tenants/{t}/users` (`createTenantUser`) correctly creates users in the tenant's `iam_realm` — so this is specifically the **self-service signup** path placing application end-users in the shared platform realm.

Live proof (`tests/live-audit/evidence/09-auth-and-governance.md`): `enduser1` appeared in the platform realm while the tenant realm stayed empty; contrast `b-handlers.mjs::createTenantUser`.

## What Changes

- Route self-service signup to the tenant's `iam_realm`, mirroring what `createTenantUser` already does.
- Stamp `tenant_id`/`workspace_id` attributes on the created user (the `tenant-context` scope already maps them).

## Capabilities

### New Capabilities

### Modified Capabilities

- `tenant-rbac`: Self-service signups create end-users inside the tenant's own realm with tenant-context claims, keeping the platform realm restricted to platform principals.

## Impact

- Self-service signup handler for `POST /v1/auth/signups`.
- Contrast reference: `b-handlers.mjs::createTenantUser`.
