export const DOMAINS = Object.freeze(['structural_admin', 'data_access']);
export const ACTOR_TYPES = Object.freeze(['user', 'service_account', 'api_key', 'anonymous']);
export const CHANGE_TYPES = Object.freeze(['assigned', 'revoked', 'migrated', 'system']);

export function validateAssignment({ structural_admin, data_access }) {
  if (typeof structural_admin !== 'boolean' || typeof data_access !== 'boolean') {
    throw new Error('INVALID_ASSIGNMENT: both structural_admin and data_access must be boolean');
  }
  return { structural_admin, data_access };
}

export function validatePrivilegeDomain(domain) {
  if (!DOMAINS.includes(domain)) throw new Error(`INVALID_DOMAIN: ${domain}`);
  return domain;
}

export function createAssignment(record = {}) {
  return {
    id: record.id ?? null,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    memberId: record.memberId,
    structural_admin: Boolean(record.structural_admin),
    data_access: Boolean(record.data_access),
    assignedBy: record.assignedBy ?? null,
    assignedAt: record.assignedAt ?? null,
    updatedAt: record.updatedAt ?? null
  };
}
