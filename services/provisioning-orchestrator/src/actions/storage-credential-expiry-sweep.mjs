import { rotateStorageProgrammaticCredential } from '../../../adapters/src/storage-programmatic-credentials.mjs';
import { listExpiredStorageCredentials } from '../repositories/storage-credential-rotation-repo.mjs';

const STORAGE_CREDENTIAL_ROTATION_TOPIC = 'console.storage-credential-rotation.policy-expired';
const POLICY_ROTATION_REASON = 'policy_expiry';
const DEFAULT_BATCH_SIZE = 200;

function resolveDependencies(params = {}) {
  return {
    db: params.db,
    repo: params.repo ?? { listExpiredStorageCredentials },
    rotateFn: params.rotateFn ?? rotateStorageProgrammaticCredential,
    publishEvent: params.publishEvent ?? (async () => {}),
    batchSize: params.batchSize ?? DEFAULT_BATCH_SIZE,
    now: params.now ?? null
  };
}

// Normalize a candidate row (snake_case from SQL or camelCase from injected fakes)
// into the shape the rotate builder expects.
function normalizeCandidate(candidate = {}) {
  const principal = candidate.principal ?? {
    principalType: candidate.principal_type,
    principalId: candidate.principal_id
  };

  return {
    credentialId: candidate.credentialId ?? candidate.credential_id,
    tenantId: candidate.tenantId ?? candidate.tenant_id ?? null,
    workspaceId: candidate.workspaceId ?? candidate.workspace_id,
    displayName: candidate.displayName ?? candidate.display_name,
    principal,
    scopes: candidate.scopes,
    state: candidate.state ?? 'active',
    secretVersion: candidate.secretVersion ?? candidate.secret_version ?? 1,
    createdAt: candidate.createdAt ?? candidate.created_at,
    lastRotatedAt: candidate.lastRotatedAt ?? candidate.last_rotated_at,
    policyMaxAgeDays: candidate.policyMaxAgeDays ?? candidate.max_storage_credential_age_days ?? null,
    rotationInProgress: candidate.rotationInProgress ?? candidate.rotation_in_progress ?? false
  };
}

export async function main(params = {}) {
  const deps = resolveDependencies(params);
  const errors = [];
  let processed = 0;

  const candidates = await deps.repo.listExpiredStorageCredentials(deps.db, deps.batchSize);

  for (const raw of candidates) {
    const candidate = normalizeCandidate(raw);

    // Idempotent: a credential already mid-rotation (grace overlap in progress)
    // has been handled by a prior sweep; skip it.
    if (candidate.rotationInProgress) {
      continue;
    }

    try {
      const rotated = await deps.rotateFn({
        credential: {
          credentialId: candidate.credentialId,
          tenantId: candidate.tenantId,
          workspaceId: candidate.workspaceId,
          displayName: candidate.displayName,
          principal: candidate.principal,
          scopes: candidate.scopes,
          state: candidate.state,
          secretVersion: candidate.secretVersion,
          createdAt: candidate.createdAt,
          lastRotatedAt: candidate.lastRotatedAt,
          policyMaxAgeDays: candidate.policyMaxAgeDays
        },
        requestedAt: deps.now ?? undefined,
        rotationReason: POLICY_ROTATION_REASON
      });

      const secretVersion = rotated?.credential?.secretVersion ?? candidate.secretVersion + 1;

      await deps.publishEvent(STORAGE_CREDENTIAL_ROTATION_TOPIC, {
        eventCategory: 'credential_rotation',
        rotationReason: POLICY_ROTATION_REASON,
        tenantId: candidate.tenantId,
        workspaceId: candidate.workspaceId,
        credentialId: candidate.credentialId,
        secretVersion
      });

      processed += 1;
    } catch (error) {
      errors.push({
        credentialId: candidate.credentialId,
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  return { processed, errors };
}
