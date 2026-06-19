# fix-executor-rbac-scope-role-enforcement

## Change type
bugfix

## Capability
app-credentials

## Priority
P1

## Why
On the kind / APISIX-standalone profile, intra-tenant RBAC is not enforced: API-key scopes and actor
roles are ignored. A `data:read`-only key can WRITE and run DDL, and a non-admin `tenant_developer` can
ISSUE API keys (a workspace-admin operation). GitHub issue #624.

**Root cause (code-verified).** The authorization model and a gateway plugin
(`services/gateway-config/plugins/scope-enforcement.lua`) exist, but the kind APISIX standalone config
does not wire the plugin, and the executor (`apps/control-plane/src/runtime/server.mjs`) trusts
gateway-injected `x-actor-scopes` (and never reads `x-actor-roles`) instead of enforcing the verified
credential's OWN authority. The data/mongo/DDL handlers never compare the verified API key's scopes
against the operation, and the api-key issuance handler performs no role check (the only `/api-keys`
guard is "API keys cannot manage API keys"). So on any deployment that omits the gateway plugin, the
scope/role layer is a silent no-op. Tenant isolation is unaffected (cross-tenant attempts still 403) —
this is purely intra-tenant privilege/scope.

The fix follows the spec scenario "enforcement holds without relying solely on the gateway": the executor
enforces the verified credential's own scopes and roles as defense-in-depth, so a missing gateway plugin
no longer grants full access. This also hardens the production profile.

## What Changes
- `apps/control-plane/src/runtime/server.mjs`:
  - Declare a `scope` on each data-plane route (reads → `data:read`, writes → `data:write`, DDL →
    `ddl:write`, realtime subscribe → `data:read`), matching the API-key scope vocabulary in
    `apps/control-plane/src/runtime/api-keys.mjs`.
  - In the request gate, for an **API-key** credential (`identity.dbRole` present) on a scoped route,
    reject with `403 INSUFFICIENT_SCOPE` when the key's scopes do not include the required scope. JWT /
    admin / gateway-header identities are governed by roles + RLS, not these data-plane scopes, so they
    are not subject to the data-plane scope check.
  - Gate the `/api-keys` management routes on an administrative role: when the caller's roles are KNOWN
    and contain no admin role (tenant_owner/admin, workspace_owner/admin, platform admin), reject with
    `403`. Unknown/empty roles defer to the existing gates (back-compat with admin tokens and the
    trusted-header dev path).
  - Parse `x-actor-roles` in `identityFromHeaders` (defense-in-depth on the trusted-header path; it was
    declared in the gateway contract but never read by the executor).

## Impact
- A `data:read` key can no longer write or run DDL; a non-admin role (e.g. `tenant_developer`) can no
  longer issue API keys — independent of whether the gateway scope plugin is wired.
- No change to tenant isolation, RLS, or the cross-tenant checks (which already 403).
- Backwards-compatible: SERVICE keys (full data/ddl scopes) and admin tokens are unaffected; the existing
  blackbox suites (incl. admin JWTs with empty role sets minting keys) continue to pass.
- Affected specs: `app-credentials`.
