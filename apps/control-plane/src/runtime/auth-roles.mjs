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
// publish a flow definition). A non-admin role (e.g. tenant_developer) is denied; an API key is
// never granted a role and is gated separately by its data-plane scopes.
export const WRITE_CAPABLE_ADMIN_ROLES = new Set([
  'tenant_owner',
  'tenant_admin',
  'workspace_owner',
  'workspace_admin',
  'platform_admin',
  'superadmin',
]);

// Returns true when `roles` is a KNOWN, non-empty list that contains at least one write-capable
// admin role. Returns false ONLY when the roles are known (an array with entries) and none is
// write-capable — that is the deny case. Callers MUST treat an undefined/empty `roles` as
// "unknown" and DEFER to the other gates (e.g. RLS, the trusted-gateway path, an admin token that
// carries no realm-role claims), exactly as the API-key management gate has done since #624 — so
// legitimate internal/system/no-claims callers are never regressed. The within-tenant escalation
// this guards (a `tenant_viewer` JWT) always carries a non-empty, non-admin roles array, so the
// deny fires precisely for it.
export function hasWriteCapableRole(roles) {
  return Array.isArray(roles) && roles.length > 0 && roles.some((r) => WRITE_CAPABLE_ADMIN_ROLES.has(r));
}

// True when `roles` is KNOWN (a non-empty array) but contains NO write-capable admin role — the
// explicit deny condition for a structural write. Mirrors the server.mjs API-key gate's predicate
// (`Array.isArray(roles) && roles.length > 0 && !roles.some(...)`) so the two gates stay identical.
export function isKnownNonWriteRole(roles) {
  return Array.isArray(roles) && roles.length > 0 && !roles.some((r) => WRITE_CAPABLE_ADMIN_ROLES.has(r));
}
