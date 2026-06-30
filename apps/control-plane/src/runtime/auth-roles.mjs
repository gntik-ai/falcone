// Shared write-capable admin role set for the control-plane executor (single source of truth).
//
// These are the Keycloak realm roles that authorize *privileged structural writes* on the
// executor: a caller carrying at least one of them may manage API keys (#624) AND mutate flow
// definitions (#760). A read-only `tenant_viewer` — or any other role NOT in this set (e.g.
// `tenant_developer`) — is denied a structural write with `403 FORBIDDEN`.
//
// It is defined HERE (not inline in server.mjs) so server.mjs (API-key management gate) and
// flow-executor.mjs (flow-definition write gate) authorize against the EXACT same set and cannot
// drift. This module imports nothing from the runtime, so importing it introduces no cycle (in
// particular server.mjs must not gain a transitive dependency on flow-executor.mjs).
//
// The role names mirror the gateway's declared `structural_admin` privilege domain
// (services/gateway-config/public-route-catalog.json) and the per-tenant Keycloak realm roles
// Falcone provisions. The set is intentionally coarse (tenant/workspace admin and above); finer
// per-resource audiences are a separate, broader concern (#761 / #773).

// Roles permitted to perform a privileged structural write (manage API keys; create/update/delete/
// publish a flow definition). A non-admin role (e.g. tenant_developer) is denied. API keys are
// never structural admins: their data-plane scopes govern non-structural data operations only.
export const WRITE_CAPABLE_ADMIN_ROLES = new Set([
  'tenant_owner',
  'tenant_admin',
  'workspace_owner',
  'workspace_admin',
  'platform_admin',
  'superadmin',
]);

// Returns true only when `roles` is a non-empty list containing at least one write-capable admin role.
// The #773 structural-write gate uses this as a positive authorization check, so undefined/empty
// roles do NOT authorize structural writes. Older compatibility gates may still choose to defer on
// unknown roles for narrower surfaces.
export function hasWriteCapableRole(roles) {
  return Array.isArray(roles) && roles.length > 0 && roles.some((r) => WRITE_CAPABLE_ADMIN_ROLES.has(r));
}

// True when `roles` is KNOWN (a non-empty array) but contains NO write-capable admin role. This
// supports compatibility gates that still distinguish "known non-admin" from "unknown/empty" roles.
export function isKnownNonWriteRole(roles) {
  return Array.isArray(roles) && roles.length > 0 && !roles.some((r) => WRITE_CAPABLE_ADMIN_ROLES.has(r));
}
