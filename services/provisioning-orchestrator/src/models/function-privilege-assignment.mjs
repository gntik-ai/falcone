export const FUNCTION_SUBDOMAINS = Object.freeze(['function_deployment', 'function_invocation']);
export const FUNCTION_ACTOR_TYPES = Object.freeze(['user', 'service_account', 'api_key', 'trigger_identity', 'anonymous']);
export const FUNCTION_CHANGE_TYPES = Object.freeze(['assigned', 'revoked', 'migrated', 'system']);

export class FunctionPrivilegeAssignment {
  constructor(record = {}) {
    this.id = record.id ?? null;
    this.tenantId = record.tenantId;
    this.workspaceId = record.workspaceId;
    this.memberId = record.memberId;
    this.functionDeployment = Boolean(record.functionDeployment);
    this.functionInvocation = Boolean(record.functionInvocation);
    this.assignedBy = record.assignedBy ?? null;
    this.assignedAt = record.assignedAt ?? null;
    this.updatedAt = record.updatedAt ?? null;
  }
}

export function validateFunctionPrivilegeAssignment(record = {}) {
  if (typeof record.functionDeployment !== 'boolean' || typeof record.functionInvocation !== 'boolean') {
    throw new Error('INVALID_ASSIGNMENT: functionDeployment and functionInvocation must be boolean');
  }
  return new FunctionPrivilegeAssignment(record);
}

export function validateFunctionSubdomain(subdomain) {
  if (!FUNCTION_SUBDOMAINS.includes(subdomain)) throw new Error(`INVALID_FUNCTION_SUBDOMAIN: ${subdomain}`);
  return subdomain;
}
