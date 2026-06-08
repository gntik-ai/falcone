import { MongoCaptureConfigRepository } from '../../repositories/realtime/MongoCaptureConfigRepository.mjs';
import { parseIdentity } from './parse-identity.mjs';

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export async function main(params, deps = {}) {
  const identity = parseIdentity(params);
  if (!identity) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };

  const repo = deps.configRepo ?? new MongoCaptureConfigRepository(deps.db);
  const items = await repo.findByWorkspace(identity.tenantId, identity.workspaceId, params?.__ow_query?.status ?? params.status ?? null);
  const page = parsePositiveInt(params?.__ow_query?.page ?? params.page, 1);
  const limit = parsePositiveInt(params?.__ow_query?.limit ?? params.limit, items.length || 50);
  const start = (page - 1) * limit;
  const pagedItems = items.slice(start, start + limit);

  return {
    statusCode: 200,
    body: {
      items: pagedItems.map((item) => item.toJSON()),
      total: items.length,
      page,
      limit
    }
  };
}
