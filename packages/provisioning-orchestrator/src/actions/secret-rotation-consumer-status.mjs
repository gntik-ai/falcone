import * as repo from '../repositories/secret-rotation-repo.mjs';

import { assertSecretRotationOwnership, parseSecretPathOwner } from './secret-path-ownership.mjs';
import { canReadSecretRotationHistory } from './secret-rotation-history.mjs';

export function resolveDependencies(params = {}) {
  return { db: params.db, repo: params.repo ?? repo };
}

export async function main(params = {}) {
  const { db, repo: dataRepo } = resolveDependencies(params);
  const { auth, secretPath } = params;
  const parsed = parseSecretPathOwner(secretPath);
  const domain = params.domain ?? parsed.domain;
  const tenantId = params.tenantId ?? parsed.tenantId;
  if (!canReadSecretRotationHistory(auth, domain, tenantId)) return { error: { code: 'FORBIDDEN', status: 403 } };

  const ownership = await assertSecretRotationOwnership({ auth, secretPath, domain, tenantId, dataRepo, db });
  if (ownership.error) return { error: ownership.error };
  const ownerTenantId = ownership.ownerTenantId;
  if (params.vaultVersion !== undefined && (!Number.isInteger(params.vaultVersion) || params.vaultVersion < 1))
    return { error: { code: 'INVALID_VAULT_VERSION', status: 400 } };
  const activeVersion = params.vaultVersion === undefined
    ? await dataRepo.getActiveVersion(db, secretPath, ownerTenantId)
    : await dataRepo.getVersionByVaultVersion(db, { secretPath, vaultVersion: params.vaultVersion, tenantId: ownerTenantId });
  if (!activeVersion) return { error: { code: 'VERSION_NOT_FOUND', status: 404 } };
  if ((activeVersion.tenant_id ?? null) !== ownerTenantId) return { error: { code: 'FORBIDDEN', status: 403 } };

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
