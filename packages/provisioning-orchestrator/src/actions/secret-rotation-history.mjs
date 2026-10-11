import * as repo from '../repositories/secret-rotation-repo.mjs';
import { assertSecretRotationOwnership } from './secret-path-ownership.mjs';

export async function main({ auth, db, domain, tenantId, secretPath, limit = 20, offset = 0 } = {}) {
  const roles = auth?.roles ?? [];
  const allowed = roles.includes('superadmin')
    || (roles.includes('platform-operator') && ['platform', 'gateway', 'iam', 'functions'].includes(domain))
    || (domain === 'tenant' && roles.some(r => ['tenant-owner', 'tenant-operator'].includes(r)) && tenantId === auth?.tenantId);
  if (!allowed) return { error: { code: 'FORBIDDEN', status: 403 } };
  const ownership = await assertSecretRotationOwnership({ auth, secretPath, domain, tenantId, dataRepo: repo, db });
  if (ownership.error) return { error: ownership.error };
  limit = Number(limit); offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
    return { error: { code: 'INVALID_PAGINATION', status: 400 } };
  const { rows, total } = await repo.listRotationHistory(db, { secretPath, limit, offset });
  return { items: rows.map(({ __total, ...event }) => event), total };
}
