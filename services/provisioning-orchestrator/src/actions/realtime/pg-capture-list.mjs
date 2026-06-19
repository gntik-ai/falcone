import { CaptureConfigRepository } from '../../repositories/realtime/CaptureConfigRepository.mjs';

export async function main(params, deps = {}) {
  // The workspace being listed is addressed by the URL path
  // (GET /v1/realtime/workspaces/{workspaceId}/pg-captures), so a tenant-scoped caller
  // (e.g. a tenant_owner JWT, which carries no per-workspace claim) can reach it. The TENANT
  // is still taken ONLY from the trusted gateway header (x-tenant-id) — never the JWT payload
  // — preserving the anti-spoofing contract; the path workspaceId falls back to the
  // x-workspace-id header for workspace-scoped credentials. The repository read is
  // tenant-scoped, so a workspace id from another tenant returns nothing (no cross-tenant leak).
  const headers = params?.__ow_headers ?? {};
  const tenantId = headers['x-tenant-id'];
  const workspaceId = params.workspaceId ?? headers['x-workspace-id'];
  if (!tenantId || !workspaceId) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new CaptureConfigRepository(deps.db);
  const items = await repo.findByWorkspace(tenantId, workspaceId, params?.__ow_query?.status ?? params.status ?? null);
  return { statusCode: 200, body: { items: items.map((item) => item.toJSON()), total: items.length } };
}
