import * as repo from '../repositories/privilege-domain-repository.mjs';

function err(status, code, message) { return { statusCode: status, body: { error: code, message } }; }

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const dataRepo = overrides.repo ?? repo;
  const { auth } = params;
  const roles = auth?.roles ?? [];
  const limit = Math.min(Number(params.limit ?? 50), 200);
  const offset = Number(params.offset ?? 0);
  const requestedTenantId = params.tenantId;

  if (roles.includes('platform_admin')) {
    if (!requestedTenantId) return err(400, 'VALIDATION_ERROR', 'tenantId is required for platform_admin queries');
  } else if (roles.includes('tenant_owner')) {
    if (!auth?.tenantId || requestedTenantId && requestedTenantId !== auth.tenantId) return err(403, 'FORBIDDEN', 'tenant mismatch');
  } else {
    return err(403, 'FORBIDDEN', 'insufficient privileges');
  }

  const tenantId = roles.includes('tenant_owner') ? auth.tenantId : requestedTenantId;
  const result = await dataRepo.queryDenials(db, {
    tenantId,
    workspaceId: params.workspaceId,
    requiredDomain: params.requiredDomain,
    actorId: params.actorId,
    from: params.from,
    to: params.to,
    limit,
    offset
  });

  return { statusCode: 200, body: { denials: result.denials, total: result.total, limit, offset } };
}
