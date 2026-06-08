/**
 * buildCallerContext — derives caller identity from gateway-injected headers only.
 *
 * Identity is sourced exclusively from the trusted headers the API gateway
 * injects from the verified token (APISIX proxy-rewrite from $jwt_claim_*),
 * read here as lowercase keys on params.__ow_headers. The gateway rejects any
 * client-supplied X-* identity headers, so these values are trustworthy.
 *
 * Returns null (→ HTTP 401) when x-auth-subject AND either x-tenant-id or
 * x-actor-type are absent or empty — i.e. we cannot establish a trusted
 * caller identity.
 *
 * The caller-supplied params.callerContext field is NEVER read. Dropping the
 * body field entirely is intentional: the only trusted identity source is the
 * gateway-injected headers.
 *
 * Mirrors the pattern in:
 *   services/provisioning-orchestrator/src/actions/realtime/parse-identity.mjs
 *   services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity
 *
 * callerContext shape consumed downstream:
 *   { actor: { id, type }, tenantId, correlationId }
 */
export function buildCallerContext(params) {
  const headers = params?.__ow_headers ?? {};

  const subject = headers['x-auth-subject'];
  const tenantId = headers['x-tenant-id'];
  const actorType = headers['x-actor-type'];

  // Require at minimum: a subject + (tenantId or actorType) to establish identity.
  if (!subject || (!tenantId && !actorType)) {
    return null;
  }

  // correlationId is not an identity/authorization field; a non-identity fallback is fine.
  const correlationId = headers['x-correlation-id'] ?? params?.correlation_id ?? null;

  return {
    actor: {
      id: subject,
      type: actorType ?? ''
    },
    tenantId: tenantId ?? null,
    correlationId
  };
}
