## Context

Falcone's existing permission model is a static, platform-owned matrix in
`services/internal-contracts/src/authorization-model.json`. Platform and
tenant roles are defined at deploy time; tenants have no mechanism to compose
finer-grained roles from the available action vocabulary. The Keycloak adapter
actively blocks mutation of reserved role names (`RESERVED_ROLE_NAMES`,
`keycloak-admin.mjs:23`) for non-platform scopes, which is the correct guard
but leaves no self-service RBAC path for tenant admins.

The `effective_roles` → `effective_permissions` resolution already exists and
is consumed by the gateway's scope-enforcement plugin. A custom role catalog
needs only to inject additional bindings into that resolution path.

## Goals / Non-Goals

**Goals:**
- Self-service role authoring for tenant admins bounded by their own permission set.
- Namespaced role names (`custom:` prefix) that structurally cannot collide with reserved names.
- Transparent folding of custom roles into the existing effective-permissions pipeline.
- Cross-tenant isolation: a custom role is always scoped to `(tenant_id, workspace_id)`.
- No privilege escalation: a custom role can never grant more than the creator holds.

**Non-Goals:**
- Changes to the platform permission matrix (`permission_matrix`) itself.
- Custom roles in Keycloak realms — bindings are persisted in the control-plane DB and resolved application-side; Keycloak is not mutated.
- Inter-workspace custom role inheritance or delegation.
- Workspace-level custom role authoring (initial scope: tenant-level only).

## Decisions

**D1 — `custom:` prefix as the namespace boundary.**
Rationale: A simple string prefix check is enforcement-point-agnostic (works at
the API layer, in the DB constraint, and in the effective-permissions resolver)
and makes the invariant legible in audit logs. Alternative: UUID-keyed roles with
no human-readable name; rejected because auditability and debuggability suffer.

**D2 — Persist bindings in the control-plane DB, not Keycloak.**
Rationale: Keycloak realm roles are heavyweight objects; using realm roles for
per-tenant custom roles would create unbounded role proliferation in the Keycloak
realm and couple every tenant RBAC change to a Keycloak admin API call.
Persisting in the control-plane DB keeps the custom-role lifecycle cheap, fast,
and transactional. The effective-permissions resolver joins the DB at resolution
time.

**D3 — Validate `allowed_actions` against the caller's own effective permissions.**
Rationale: This is the standard "you cannot grant what you do not hold" invariant.
It is computed at create/update time by calling `resolveTenantEffectiveCapabilities`
for the requesting principal and diffing against the submitted `allowed_actions`.

**D4 — Trigger `tenant.effective_permissions.recalculate` on mutation.**
Rationale: The recalculate action already exists and is idempotent. Reusing it
avoids building a separate cache-invalidation path and keeps the resolution
pipeline consistent.

## Risks / Trade-offs

**Risk: effective-permissions resolver latency increases under high custom-role count.**
Mitigation: Custom roles are resolved with a single indexed query on
`(tenant_id, workspace_id)` with a low expected cardinality (tenants are unlikely
to define hundreds of custom roles). Add a short TTL cache (mirroring `planCacheTtlSeconds`)
in the resolver.

**Risk: A misconfigured custom role accidentally grants a sensitive action.**
Mitigation: Server-side validation rejects any `allowed_actions` entry not present
in the platform `permission_matrix` action vocabulary, and rejects any action in the
`denied_actions` list of the `tenant_owner` role (the highest tenant role). The
`custom:` prefix and DB constraint form a second check.

**Risk: Tenant admin transfers ownership and the successor inherits custom roles.**
Mitigation: Custom roles are scoped to `tenant_id`, not the individual admin who
created them. Ownership transfer does not change the role catalog. Document this
in the API spec.

## Migration Plan

1. Ship migration `tenant_custom_roles` table with `(tenant_id, workspace_id, role_name TEXT, allowed_actions TEXT[], created_by TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ)` and indexes on `(tenant_id, workspace_id)` and unique on `(tenant_id, workspace_id, role_name)` where `deleted_at IS NULL`.
2. Add a DB check constraint: `role_name LIKE 'custom:%'`.
3. Deploy control-plane route handlers with validation logic before enabling the gateway route.
4. Add the gateway route entry in `public-api-routing.yaml` with `planCapabilityAnyOf: [identity.sso.oidc]`.
5. Update the effective-permissions resolver to join `tenant_custom_roles` and confirm existing tests pass.
6. Enable `tenant.effective_permissions.recalculate` fan-out on custom role mutations.
