import { CaptureConfigRepository } from '../../repositories/realtime/CaptureConfigRepository.mjs';
import { parseIdentity } from './parse-identity.mjs';
export async function main(params, deps = {}) {
  const identity = parseIdentity(params);
  if (!identity) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new CaptureConfigRepository(deps.db);
  const items = await repo.findByWorkspace(identity.tenantId, identity.workspaceId, params?.__ow_query?.status ?? params.status ?? null);
  return { statusCode: 200, body: { items: items.map((item) => item.toJSON()), total: items.length } };
}
