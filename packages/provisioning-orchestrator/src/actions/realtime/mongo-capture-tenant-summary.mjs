import { MongoCaptureConfigRepository } from '../../repositories/realtime/MongoCaptureConfigRepository.mjs';
import { MongoCaptureQuotaRepository } from '../../repositories/realtime/MongoCaptureQuotaRepository.mjs';
import { parseIdentity } from './parse-identity.mjs';
export async function main(params, deps = {}) {
  const identity = parseIdentity(params);
  const tenantId = params.tenantId ?? params.path?.tenantId;
  if (!identity || identity.tenantId !== tenantId || !identity.roles?.includes('tenant_owner')) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new MongoCaptureConfigRepository(deps.db);
  const quotaRepo = deps.quotaRepo ?? new MongoCaptureQuotaRepository(deps.db);
  const workspaces = await repo.findByTenantSummary(tenantId);
  const quotaMax = (await quotaRepo.getQuota('tenant', tenantId))?.max_collections ?? Number(process.env.MONGO_CAPTURE_DEFAULT_TENANT_QUOTA ?? 50);
  return { statusCode: 200, body: { tenant_id: tenantId, workspaces: workspaces.map((row) => ({ ...row, quota_max: quotaMax })) } };
}
