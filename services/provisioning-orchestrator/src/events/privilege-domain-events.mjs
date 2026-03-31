export const TOPICS = Object.freeze({
  DENIED: process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_DENIED || 'console.security.privilege-domain-denied',
  ASSIGNED: process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_ASSIGNED || 'console.security.privilege-domain-assigned',
  REVOKED: process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_REVOKED || 'console.security.privilege-domain-revoked',
  LAST_ADMIN: process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_LAST_ADMIN || 'console.security.last-admin-guard-triggered'
});

function stamp(eventType, payload) {
  return { eventType, ...payload, occurredAt: new Date().toISOString() };
}

export function buildDeniedEvent({ tenantId, workspaceId = null, actorId, actorType, credentialDomain = null, requiredDomain, httpMethod, requestPath, correlationId }) {
  return stamp('privilege_domain_denied', { tenantId, workspaceId, actorId, actorType, credentialDomain, requiredDomain, httpMethod, requestPath, correlationId });
}

export function buildAssignedEvent({ tenantId, workspaceId, memberId, privilegeDomain, assignedBy, pending_review = false }) {
  return stamp('privilege_domain_assigned', { tenantId, workspaceId, memberId, privilegeDomain, assignedBy, pending_review });
}

export function buildRevokedEvent({ tenantId, workspaceId, memberId, privilegeDomain, revokedBy }) {
  return stamp('privilege_domain_revoked', { tenantId, workspaceId, memberId, privilegeDomain, revokedBy });
}

export function buildLastAdminGuardEvent({ tenantId, workspaceId, memberId, attemptedBy }) {
  return stamp('last_admin_guard_triggered', { tenantId, workspaceId, memberId, attemptedBy });
}
