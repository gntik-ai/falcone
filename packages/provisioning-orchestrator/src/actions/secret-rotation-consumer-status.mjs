import * as repo from '../repositories/secret-rotation-repo.mjs';

const PLATFORM_ROLES = new Set(['superadmin', 'platform-operator']);

function isPlatformCaller(auth) {
  const roles = auth?.roles ?? [];
  return roles.some((r) => PLATFORM_ROLES.has(r));
}

function hasBasePermission(auth, secretPath) {
  return Boolean(auth && Array.isArray(auth.roles) && auth.roles.length > 0 && secretPath);
}

export function resolveDependencies(params = {}) {
  return { db: params.db, repo: params.repo ?? repo };
}

export async function main(params = {}) {
  const { db, repo: dataRepo } = resolveDependencies(params);
  const { auth, secretPath } = params;
  if (!hasBasePermission(auth, secretPath)) return { error: { code: 'FORBIDDEN', status: 403 } };

  const activeVersion = await dataRepo.getActiveVersion(db, secretPath);

  if (!isPlatformCaller(auth)) {
    if (!activeVersion) return { error: { code: 'FORBIDDEN', status: 403 } };
    if (activeVersion.tenant_id !== auth.tenantId) return { error: { code: 'FORBIDDEN', status: 403 } };
  }

  const consumers = await dataRepo.listConsumers(db, secretPath);
  const vaultVersion = params.vaultVersion ?? activeVersion?.vault_version;
  const pending = await dataRepo.listPendingPropagations(db, { secretPath, vaultVersion });
  const pendingByConsumer = new Map(pending.map((row) => [row.consumer_id, row]));

  return {
    consumers: consumers.map((consumer) => {
      const row = pendingByConsumer.get(consumer.consumer_id);
      return {
        consumer_id: consumer.consumer_id,
        reload_mechanism: consumer.reload_mechanism,
        state: row?.state ?? 'confirmed',
        confirmedAt: row?.confirmed_at ?? null,
        timeoutAt: row?.timeout_at ?? null
      };
    })
  };
}
