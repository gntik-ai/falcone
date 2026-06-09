# Per-tenant custom roles & permission bindings

| Field | Value |
|---|---|
| **Change ID** | `add-tenant-custom-rbac` |
| **Capability** | `tenant-rbac` (new) |
| **Type** | enhancement |
| **Priority** | P1 |
| **OpenSpec change** | `openspec/changes/add-tenant-custom-rbac/` |

---

## Why

Falcone's authorization model is governed by a fixed, platform-defined permission matrix (`services/internal-contracts/src/authorization-model.json::permission_matrix`, line 716+) that enumerates static roles (`platform_admin`, `platform_operator`, `tenant_owner`, `tenant_admin`, etc.) with hard-coded `allowed_actions`/`denied_actions`. Tenants cannot define their own roles.

`services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES` (line 23) lists 14 platform/tenant/workspace role names that are actively blocked from mutation for non-platform scopes (line 412). While `effective_roles` flow through the gateway via `X-Actor-Roles` and `tenant.effective_permissions.recalculate` actions exist in the matrix, there is **no API surface to author a tenant-scoped role** bundling a subset of permission_matrix actions. Tenant admins are stuck with coarse, platform-defined grants and cannot implement least-privilege access internally without platform involvement.

## What Changes

- Introduce a per-tenant custom role catalog persisted as `(tenant_id, workspace_id, role_name, allowed_actions[])` with a `custom:` prefix namespace guarantee.
- Expose CRUD endpoints `GET/POST/PUT/DELETE /v1/admin/iam/tenant-roles/*` gated on `tenant.role_mappings.manage`.
- Validate that `allowed_actions` is a strict subset of the creator's own effective permissions; platform-scoped and RESERVED_ROLE_NAMES actions are always rejected.
- Fold active custom roles into the `effective_roles`/`effective_permissions` resolution path consumed by the gateway scope-enforcement plugin.
- Reuse `tenant.effective_permissions.recalculate` on mutation/deletion.
- Ship a new migration `tenant_custom_roles` table on the control-plane DB.

## Spec delta (EARS)

- The system **SHALL** allow a tenant admin to create a custom role namespaced `custom:` binding a non-empty subset of permission_matrix actions scoped to `(tenant_id, workspace_id)`.
- The system **SHALL** reject any custom role name that matches a `RESERVED_ROLE_NAMES` entry or lacks the `custom:` prefix (HTTP 422).
- The system **SHALL** reject any `allowed_actions` containing an action not held by the requesting principal (HTTP 403 — no privilege escalation).
- The system **SHALL** reject any `allowed_actions` containing a platform-scoped action regardless of the creator's role (HTTP 403).
- The system **SHALL** include active custom roles when computing effective permissions for a user, so downstream scope checks reflect custom bindings transparently.
- The system **SHALL** scope all reads of custom roles to the caller's own `(tenant_id, workspace_id)`; a cross-tenant read MUST return HTTP 404.

Full spec: `openspec/changes/add-tenant-custom-rbac/specs/tenant-rbac/spec.md`

## Tasks

See `openspec/changes/add-tenant-custom-rbac/tasks.md` for the full checklist. Key groups:

1. Baseline — confirm green before starting
2. Black-box tests (write-first): valid creation, name collision rejection, privilege escalation rejection, cross-tenant read → 404, effective-permissions integration
3. Database migration — `tenant_custom_roles` table with `custom:` check constraint and composite index
4. API route handlers — POST/GET/PUT/DELETE with full validation
5. Effective-permissions resolver — join `tenant_custom_roles`, add short-TTL cache
6. Gateway config — new route family `tenant_iam_custom_roles` in `public-api-routing.yaml`
7. Integration validation — `bash tests/blackbox/run.sh`

## Acceptance criteria

- `POST /v1/admin/iam/tenant-roles` with `custom:` prefix and a valid subset of creator permissions returns HTTP 201.
- `POST` with a name matching any `RESERVED_ROLE_NAMES` entry returns HTTP 422.
- `POST` with `allowed_actions` containing a platform-scoped action returns HTTP 403.
- `POST` by a principal who does not hold the requested action returns HTTP 403.
- A user assigned the custom role passes scope check on an endpoint requiring one of its granted actions.
- After deletion, the same scope check is denied and `effective_permissions.recalculate` has been triggered.
- `GET /v1/admin/iam/tenant-roles/{roleId}` where `roleId` belongs to a different tenant returns HTTP 404.

## Code evidence

- `services/internal-contracts/src/authorization-model.json::permission_matrix` (line 716+) — fixed platform matrix, no tenant-custom-role surface.
- `services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES` (line 23) — 14 reserved names blocked from mutation.
- `services/adapters/src/keycloak-admin.mjs` (line 412) — guard: `if (roleName && RESERVED_ROLE_NAMES.includes(roleName) && context.scope !== 'platform')` rejects role mutation for non-platform scope; confirms no custom authoring path exists.
- `services/internal-contracts/src/authorization-model.json::permission_matrix[tenant][tenant_owner].allowed_actions` includes `tenant.role_mappings.manage` and `tenant.effective_permissions.recalculate` — the resolution infrastructure exists but has no authoring surface.

## Resolution (OpenSpec)

```
/opsx:apply add-tenant-custom-rbac
/opsx:verify add-tenant-custom-rbac
bash tests/blackbox/run.sh
/opsx:archive add-tenant-custom-rbac
```

Or use the wrapper: `/implement-change add-tenant-custom-rbac`

Optional real-stack E2E: `/e2e-issue add-tenant-custom-rbac`
