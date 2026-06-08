/**
 * parseIdentity — derives caller identity from gateway-injected headers only.
 *
 * Identity is sourced exclusively from the trusted headers the API gateway
 * injects from the verified token (APISIX proxy-rewrite from $jwt_claim_*),
 * read here as lowercase keys on params.__ow_headers. The gateway rejects any
 * client-supplied X-* identity headers, so these values are trustworthy.
 *
 * Returns null (→ HTTP 401) when x-tenant-id or x-workspace-id are absent or
 * empty. The Authorization Bearer token payload is never parsed or trusted for
 * tenant scoping.
 *
 * Mirrors the pattern in services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity.
 */
function parseRoles(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((r) => r.trim()).filter(Boolean);
  return [];
}

export function parseIdentity(params) {
  const headers = params?.__ow_headers ?? {};
  const tenantId = headers['x-tenant-id'];
  const workspaceId = headers['x-workspace-id'];
  if (!tenantId || !workspaceId) {
    return null;
  }
  return {
    tenantId,
    workspaceId,
    actorId: headers['x-auth-subject'] ?? 'system',
    roles: parseRoles(headers['x-actor-roles']),
  };
}
