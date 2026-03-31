import * as repo from '../repositories/privilege-domain-repository.mjs';

function err(status, code, message) { return { statusCode: status, body: { error: code, message } }; }

function allowed(auth, tenantId) {
  const roles = auth?.roles ?? [];
  return roles.includes('platform_admin') || (roles.includes('tenant_owner') && auth?.tenantId === tenantId);
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const dataRepo = overrides.repo ?? repo;
  const { auth, tenantId, workspaceId, memberId } = params;
  if (!tenantId || !workspaceId) return err(400, 'VALIDATION_ERROR', 'tenantId and workspaceId are required');
  if (!allowed(auth, tenantId)) return err(403, 'FORBIDDEN');
  if (memberId) {
    const assignment = await dataRepo.getAssignment(db, { tenantId, workspaceId, memberId });
    if (!assignment) return err(404, 'NOT_FOUND', 'Member privilege assignment not found');
    return { statusCode: 200, body: assignment };
  }
  const assignments = await dataRepo.listAssignments(db, { tenantId, workspaceId });
  return { statusCode: 200, body: assignments };
}
