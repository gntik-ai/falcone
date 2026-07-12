import {
  buildStorageProgrammaticCredentialSecretEnvelope,
  rotateStorageProgrammaticCredential,
} from '../../../adapters/src/storage-programmatic-credentials.mjs';
import { toSeaweedFSActions } from '../../../adapters/src/storage-access-policy.mjs';
import {
  STORAGE_BOUNDARY_ERROR_CODES,
  deriveWorkspaceStorageIdentityName
} from '../../../adapters/src/storage-tenant-context.mjs';
import { listExpiredStorageCredentials } from '../repositories/storage-credential-rotation-repo.mjs';

const STORAGE_CREDENTIAL_ROTATION_TOPIC = 'console.storage-credential-rotation.policy-expired';
const POLICY_ROTATION_REASON = 'policy_expiry';
const DEFAULT_BATCH_SIZE = 200;

// Default workspace key grant (read/write/list, no admin) for the SeaweedFS
// identity written on a policy rotation (change add-seaweedfs-tenant-identities §5.3).
const DEFAULT_IDENTITY_POLICY_DECISIONS = Object.freeze({ read: true, write: true, list: true, admin: false });

function resolveDependencies(params = {}) {
  return {
    db: params.db,
    repo: params.repo ?? { listExpiredStorageCredentials },
    rotateFn: params.rotateFn ?? rotateStorageProgrammaticCredential,
    publishEvent: params.publishEvent ?? (async () => {}),
    batchSize: params.batchSize ?? DEFAULT_BATCH_SIZE,
    now: params.now ?? null,
    // SeaweedFS identity wiring (§5.3) is OPT-IN: when no `writeIdentityFn` is
    // injected the sweep behaves exactly as before (pure rotation + event only),
    // so a deployment without SeaweedFS configured is unaffected.
    writeIdentityFn: params.writeIdentityFn ?? null,
    resolveBucketName: params.resolveBucketName ?? null,
    iamOptions: params.iamOptions ?? {},
    identityPolicyDecisions: params.identityPolicyDecisions ?? DEFAULT_IDENTITY_POLICY_DECISIONS
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
    bucketName: candidate.bucketName ?? candidate.bucket_name ?? null,
    rotationInProgress: candidate.rotationInProgress ?? candidate.rotation_in_progress ?? false
  };
}

async function resolveCandidateBucket(deps, candidate) {
  const scoped = Array.isArray(candidate.scopes)
    ? candidate.scopes.find((scope) => scope?.bucketName)?.bucketName
    : null;
  if (candidate.bucketName) return candidate.bucketName;
  if (scoped) return scoped;
  if (deps.resolveBucketName) {
    return deps.resolveBucketName({ tenantId: candidate.tenantId, workspaceId: candidate.workspaceId });
  }
  return null;
}

// Write the rotated SeaweedFS identity carrying BOTH the new and the previous
// credential entry (grace-window overlap, Design D4) so the old key keeps working
// until the grace-cleanup pass drops it (§5.3).
async function writeRotatedIdentity(deps, candidate, rotated) {
  const bucketName = await resolveCandidateBucket(deps, candidate);
  if (!bucketName) {
    const error = new Error(`No bucket mapping for workspace ${candidate.workspaceId}; refusing to write an unscoped SeaweedFS identity.`);
    error.code = STORAGE_BOUNDARY_ERROR_CODES.BUCKET_NOT_FOUND;
    throw error;
  }

  const previous = buildStorageProgrammaticCredentialSecretEnvelope({
    credentialId: candidate.credentialId,
    tenantId: candidate.tenantId,
    workspaceId: candidate.workspaceId,
    displayName: candidate.displayName,
    principal: candidate.principal,
    scopes: candidate.scopes,
    secretVersion: candidate.secretVersion
  });

  await deps.writeIdentityFn({
    name: deriveWorkspaceStorageIdentityName(candidate.workspaceId),
    credentials: [
      { accessKey: rotated.accessKeyId, secretKey: rotated.secretAccessKey },
      { accessKey: previous.accessKeyId, secretKey: previous.secretAccessKey }
    ],
    actions: toSeaweedFSActions(deps.identityPolicyDecisions),
    buckets: [bucketName]
  }, deps.iamOptions);
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

      // §5.3: propagate the new key to SeaweedFS (grace overlap) when wired.
      if (deps.writeIdentityFn) {
        await writeRotatedIdentity(deps, candidate, rotated);
      }

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

// §5.4 — grace-window cleanup sweep step. After a rotation's overlap window has
// elapsed, rewrite each identity to keep ONLY the current credential so the
// previous key is rejected. Fully injectable: the candidate list and the
// per-credential cleanup are supplied by the caller (the repo has no grace-state
// schema yet), and the step is a no-op unless a `writeIdentityFn` is wired.
export async function cleanupGraceExpiredIdentities(params = {}) {
  const deps = resolveDependencies(params);
  const errors = [];
  let cleaned = 0;

  if (!deps.writeIdentityFn || typeof deps.repo.listGraceExpiredStorageCredentials !== 'function') {
    return { cleaned, errors };
  }

  const candidates = await deps.repo.listGraceExpiredStorageCredentials(deps.db, deps.batchSize);

  for (const raw of candidates) {
    const candidate = normalizeCandidate(raw);
    try {
      const bucketName = await resolveCandidateBucket(deps, candidate);
      if (!bucketName) {
        const error = new Error(`No bucket mapping for workspace ${candidate.workspaceId}; cannot clean up SeaweedFS identity.`);
        error.code = STORAGE_BOUNDARY_ERROR_CODES.BUCKET_NOT_FOUND;
        throw error;
      }
      const current = buildStorageProgrammaticCredentialSecretEnvelope({
        credentialId: candidate.credentialId,
        tenantId: candidate.tenantId,
        workspaceId: candidate.workspaceId,
        displayName: candidate.displayName,
        principal: candidate.principal,
        scopes: candidate.scopes,
        secretVersion: candidate.secretVersion
      });
      await deps.writeIdentityFn({
        name: deriveWorkspaceStorageIdentityName(candidate.workspaceId),
        credentials: [{ accessKey: current.accessKeyId, secretKey: current.secretAccessKey }],
        actions: toSeaweedFSActions(deps.identityPolicyDecisions),
        buckets: [bucketName]
      }, deps.iamOptions);
      cleaned += 1;
    } catch (error) {
      errors.push({
        credentialId: candidate.credentialId,
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  return { cleaned, errors };
}
