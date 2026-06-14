/**
 * Runtime executors for storage-credential lifecycle side-effects against
 * SeaweedFS (change add-seaweedfs-tenant-identities, §5/§6/§7).
 *
 * The `services/adapters/src` storage modules are PURE, deterministic builders
 * (`rotate*`/`revoke*` return records/envelopes only — no I/O) and are locked by
 * the contract/unit/adapter/blackbox suites. This module is the runtime/
 * orchestration layer that COMPOSES those pure builders with the SeaweedFS IAM
 * client so a rotation/revocation/policy-change actually reaches the backend —
 * without making the builders impure. Every collaborator is injectable so this
 * is unit-testable without a live SeaweedFS.
 *
 * @module actions/storage-identity-runtime
 */

import {
  buildStorageProgrammaticCredentialSecretEnvelope,
  revokeStorageProgrammaticCredential,
  rotateStorageProgrammaticCredential,
} from '../../../adapters/src/storage-programmatic-credentials.mjs';
import { toSeaweedFSActions } from '../../../adapters/src/storage-access-policy.mjs';
import {
  STORAGE_BOUNDARY_ERROR_CODES,
  deriveWorkspaceStorageIdentityName,
} from '../../../adapters/src/storage-tenant-context.mjs';
import {
  writeIdentity,
  deleteIdentity,
  updateIdentityActions,
  reloadIdentities,
} from '../../../adapters/src/seaweedfs-iam-client.mjs';

// Default grant for a workspace storage key (mirrors provisioning + the built-in
// `member` role): read/write/list, no admin.
export const DEFAULT_IDENTITY_POLICY_DECISIONS = Object.freeze({ read: true, write: true, list: true, admin: false });

const defaultIamClient = Object.freeze({ writeIdentity, deleteIdentity, updateIdentityActions, reloadIdentities });

function requireWorkspaceId(credential) {
  const workspaceId = credential?.workspaceId;
  if (!workspaceId) {
    const error = new Error('credential.workspaceId is required for a SeaweedFS identity operation.');
    error.code = STORAGE_BOUNDARY_ERROR_CODES.WORKSPACE_REQUIRED;
    throw error;
  }
  return workspaceId;
}

function requireBucketName(bucketName) {
  if (!bucketName) {
    const error = new Error('A workspace bucket name is required; refusing to write an unscoped SeaweedFS identity.');
    error.code = STORAGE_BOUNDARY_ERROR_CODES.BUCKET_NOT_FOUND;
    throw error;
  }
  return bucketName;
}

function keyPairForVersion(credential, secretVersion) {
  const envelope = buildStorageProgrammaticCredentialSecretEnvelope({ ...credential, secretVersion });
  return { accessKey: envelope.accessKeyId, secretKey: envelope.secretAccessKey, envelope };
}

/**
 * Manual rotation runtime path (§5.1). Rotates the pure credential builder
 * (secretVersion + 1) and writes the SeaweedFS identity carrying BOTH the new
 * and the previous credential entry (grace-window overlap, Design D4), so the
 * old key keeps working until {@link cleanupRotatedCredentialIdentity} drops it.
 *
 * @returns {Promise<{envelope:object, identityName:string, previousAccessKeyId:string}>}
 */
export async function rotateStorageCredentialIdentity({
  credential,
  bucketName,
  policyDecisions = DEFAULT_IDENTITY_POLICY_DECISIONS,
  requestedAt,
  rotationReason = 'manual',
  iamClient = defaultIamClient,
  iamOptions = {},
} = {}) {
  const workspaceId = requireWorkspaceId(credential);
  requireBucketName(bucketName ?? credential.scopes?.[0]?.bucketName);
  const resolvedBucket = bucketName ?? credential.scopes?.[0]?.bucketName;

  const newEnvelope = rotateStorageProgrammaticCredential({ credential, requestedAt, rotationReason });
  const previous = keyPairForVersion(credential, credential.secretVersion);
  const identityName = deriveWorkspaceStorageIdentityName(workspaceId);

  await iamClient.writeIdentity({
    name: identityName,
    credentials: [
      { accessKey: newEnvelope.accessKeyId, secretKey: newEnvelope.secretAccessKey },
      { accessKey: previous.accessKey, secretKey: previous.secretKey },
    ],
    actions: toSeaweedFSActions(policyDecisions),
    buckets: [resolvedBucket],
  }, iamOptions);

  return { envelope: newEnvelope, identityName, previousAccessKeyId: previous.accessKey };
}

/**
 * Grace-window cleanup (§5.4): after the overlap window elapses, rewrite the
 * identity to keep ONLY the current credential so the previous key is rejected.
 *
 * @returns {Promise<{identityName:string, keptAccessKeyId:string}>}
 */
export async function cleanupRotatedCredentialIdentity({
  credential,
  bucketName,
  policyDecisions = DEFAULT_IDENTITY_POLICY_DECISIONS,
  iamClient = defaultIamClient,
  iamOptions = {},
} = {}) {
  const workspaceId = requireWorkspaceId(credential);
  const resolvedBucket = requireBucketName(bucketName ?? credential.scopes?.[0]?.bucketName);
  const current = keyPairForVersion(credential, credential.secretVersion);
  const identityName = deriveWorkspaceStorageIdentityName(workspaceId);

  await iamClient.writeIdentity({
    name: identityName,
    credentials: [{ accessKey: current.accessKey, secretKey: current.secretKey }],
    actions: toSeaweedFSActions(policyDecisions),
    buckets: [resolvedBucket],
  }, iamOptions);

  return { identityName, keptAccessKeyId: current.accessKey };
}

/**
 * Explicit revocation runtime path (§6.1). Marks the pure credential record
 * revoked and deletes the SeaweedFS identity so the key is immediately rejected.
 *
 * @returns {Promise<{credential:object, identityName:string, deleted:boolean}>}
 */
export async function revokeStorageCredentialIdentity({
  credential,
  identityName,
  requestedAt,
  iamClient = defaultIamClient,
  iamOptions = {},
} = {}) {
  const name = identityName ?? deriveWorkspaceStorageIdentityName(requireWorkspaceId(credential));
  const revoked = revokeStorageProgrammaticCredential({ credential, requestedAt });
  const result = await iamClient.deleteIdentity(name, iamOptions);
  return { credential: revoked, identityName: name, deleted: result.deleted };
}

/**
 * Lifecycle cascade revocation (§6.2): enumerate and delete every SeaweedFS
 * identity owned by the workspaces/tenant being deleted, before the deletion is
 * considered complete.
 *
 * @returns {Promise<{revoked:Array<{identityName:string, deleted:boolean}>}>}
 */
export async function cascadeRevokeWorkspaceIdentities({
  workspaceIds = [],
  identityNames = [],
  iamClient = defaultIamClient,
  iamOptions = {},
} = {}) {
  const names = identityNames.length > 0
    ? identityNames
    : workspaceIds.map((id) => deriveWorkspaceStorageIdentityName(id));
  const revoked = [];
  for (const name of names) {
    const result = await iamClient.deleteIdentity(name, iamOptions);
    revoked.push({ identityName: name, deleted: result.deleted });
  }
  return { revoked };
}

/**
 * Policy-update sync (§7.1): re-scope the identity's actions in place (preserving
 * its credentials) so a policy downgrade (e.g. read-only) removes `Write`
 * immediately, without requiring a key rotation.
 *
 * @returns {Promise<{identityName:string, actions:string[]}>}
 */
export async function syncStorageIdentityActions({
  workspaceId,
  bucketName,
  policyDecisions,
  iamClient = defaultIamClient,
  iamOptions = {},
} = {}) {
  if (!workspaceId) {
    const error = new Error('workspaceId is required to sync SeaweedFS identity actions.');
    error.code = STORAGE_BOUNDARY_ERROR_CODES.WORKSPACE_REQUIRED;
    throw error;
  }
  const resolvedBucket = requireBucketName(bucketName);
  const identityName = deriveWorkspaceStorageIdentityName(workspaceId);
  const result = await iamClient.updateIdentityActions({
    name: identityName,
    actions: toSeaweedFSActions(policyDecisions),
    buckets: [resolvedBucket],
  }, iamOptions);
  return { identityName, actions: result.actions };
}
