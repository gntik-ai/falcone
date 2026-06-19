/**
 * parseConfigIdentity — derives caller identity for the tenant-config action
 * family exclusively from gateway-injected trusted headers.
 *
 * Identity is sourced from lowercase headers the APISIX gateway injects from
 * the verified token ($jwt_claim_* proxy-rewrite). The gateway strips any
 * client-supplied X-* identity headers, so these values are trustworthy.
 *
 * Required header: x-tenant-id (absent or empty → returns null → 401) UNLESS the
 *   caller passes `{ requireTenant: false }` — used by tenant-agnostic platform-admin
 *   endpoints (e.g. config format-versions) and by endpoints that address the target
 *   tenant via the URL path (e.g. config export-domains), where a platform operator
 *   (superadmin/sre) legitimately carries no own-tenant claim. With requireTenant:false
 *   and no x-tenant-id, identity is still derived from the trusted role/scope headers and
 *   returned with `tenantId: null`; authorization is then the action's responsibility.
 * Optional headers: x-auth-subject, x-actor-roles (comma or array),
 *                   x-actor-scopes (space or comma split, both supported).
 *
 * actor_type derivation (from trusted roles/scopes only — JWT payload is
 * never parsed):
 *   - 'superadmin'     if roles includes 'superadmin'
 *   - 'sre'            if roles includes 'sre'
 *   - 'service_account' if neither superadmin nor sre, but scopes includes
 *                       'platform:admin:config:export' or
 *                       'platform:admin:config:reprovision'
 *                       (replaces the old azp-based check — service-account
 *                        status is now inferred from the admin scope alone;
 *                        the gateway is the trust anchor, not the JWT azp claim)
 *   - null             if none of the above (caller present but unprivileged → 403)
 *
 * Returns null when x-tenant-id is absent or empty (→ 401 UNAUTHORIZED).
 * Returns { tenantId, actor_id, actor_type, roles, scopes } otherwise.
 *
 * Mirrors the pattern in:
 *   services/provisioning-orchestrator/src/actions/realtime/parse-identity.mjs
 *   services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity
 */

/** Split a comma-separated string or pass through an array. */
function splitComma(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Split a space-or-comma-separated scope string or pass through an array.
 * Supports both ' ' (JWT standard) and ',' (header convenience).
 */
function splitScopes(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    // Prefer space-split (JWT standard); fall back to comma-split.
    const bySpace = value.split(' ').map((s) => s.trim()).filter(Boolean);
    if (bySpace.length > 1) return bySpace;
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

const ADMIN_SCOPES = ['platform:admin:config:export', 'platform:admin:config:reprovision'];

/**
 * @param {object} params - OpenWhisk action params
 * @param {{ requireTenant?: boolean }} [opts] - requireTenant (default true): when false,
 *        a missing x-tenant-id does not short-circuit to null; identity is still derived
 *        from the trusted role/scope headers and returned with tenantId: null.
 * @returns {{ tenantId: string|null, actor_id: string, actor_type: string|null, roles: string[], scopes: string[] } | null}
 */
export function parseConfigIdentity(params, { requireTenant = true } = {}) {
  const headers = params?.__ow_headers ?? {};

  const rawTenantId = headers['x-tenant-id'];
  const hasTenant = !!rawTenantId && rawTenantId.trim() !== '';
  if (!hasTenant && requireTenant) {
    return null; // tenant-scoped action: missing required identity header → caller gets 401
  }

  const roles = splitComma(headers['x-actor-roles']);
  const scopes = splitScopes(headers['x-actor-scopes']);

  // requireTenant:false tolerates a missing x-tenant-id for platform operators, but a request
  // with NO trusted identity signal at all (no tenant, no roles, no scopes — e.g. a forged
  // Bearer JWT and nothing else) carries no identity and MUST 401. It is never treated as a
  // privileged caller: the JWT payload is never read here (anti-spoofing contract).
  if (!hasTenant && roles.length === 0 && scopes.length === 0) {
    return null;
  }

  let actor_type = null;
  if (roles.includes('superadmin')) {
    actor_type = 'superadmin';
  } else if (roles.includes('sre')) {
    actor_type = 'sre';
  } else if (ADMIN_SCOPES.some((s) => scopes.includes(s))) {
    // Service-account: holds an admin scope but is not superadmin or sre.
    // The gateway is the trust anchor; we no longer check the JWT azp claim.
    actor_type = 'service_account';
  }

  return {
    tenantId: hasTenant ? rawTenantId : null,
    actor_id: (headers['x-auth-subject'] ?? '').trim() || 'system',
    actor_type,
    roles,
    scopes,
  };
}
