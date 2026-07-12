import * as repo from '../repositories/secret-rotation-repo.mjs';

export function resolveDependencies(params = {}) {
  return {
    db: params.db,
    repo: params.repo ?? repo,
    publishEvent: params.publishEvent ?? (async () => {})
  };
}

// Authentication gate: the caller must present a verified service identity via
// params.auth = { sub, roles, tenantId }.  auth.sub is the authenticated service
// principal and is the only trusted source of caller identity.
// consumerId / secretPath / vaultVersion are untrusted caller-supplied inputs.
function isAuthenticated(auth) {
  return Boolean(auth && auth.sub);
}

// Tenant-consistency rule:
//   - For versioned secrets with a non-null tenant_id, the caller's auth.tenantId
//     must equal version.tenant_id.
//   - For platform/cross-domain versions where tenant_id is null, the caller's
//     auth.tenantId must also be null (platform service principal).
//   Treat version-not-found the same as mismatch (403) to prevent oracle attacks.
function tenantMatches(authTenantId, versionTenantId) {
  return authTenantId === versionTenantId;
}

export async function main(params = {}) {
  const { db, repo: dataRepo, publishEvent } = resolveDependencies(params);
  const { auth, consumerId, secretPath, vaultVersion } = params;

  // 1. Authentication check — must be first, before any repo call.
  if (!isAuthenticated(auth)) {
    return { error: { code: 'UNAUTHENTICATED', status: 401 } };
  }

  // 2. Identity check: the authenticated principal must match the claimed consumerId.
  //    This prevents a consumer from confirming on behalf of another consumer and
  //    prevents forged actorId in audit events.
  if (auth.sub !== consumerId) {
    return { error: { code: 'FORBIDDEN', status: 403 } };
  }

  // 3. Registry membership check: (secretPath, consumerId) must be registered in
  //    secret_consumer_registry.  Only registered service identities may ack.
  const consumers = await dataRepo.listConsumers(db, secretPath);
  const isRegistered = consumers.some((row) => row.consumer_id === consumerId);
  if (!isRegistered) {
    return { error: { code: 'FORBIDDEN', status: 403 } };
  }

  // 4. Tenant consistency check: resolve the version and ensure the caller's
  //    tenantId matches.  Version-not-found is also treated as 403 to avoid
  //    leaking existence information.
  const version = await dataRepo.getVersionByVaultVersion(db, { secretPath, vaultVersion });
  if (!version || !tenantMatches(auth.tenantId, version.tenant_id)) {
    return { error: { code: 'FORBIDDEN', status: 403 } };
  }

  // 5. All checks passed — fetch pending propagations before confirming, so we
  //    can detect whether this consumer had a pending row (for audit event).
  const before = await dataRepo.listPendingPropagations(db, { secretPath, vaultVersion });
  await dataRepo.confirmPropagation(db, { secretPath, vaultVersion, consumerId });

  // 6. Emit audit event only when this consumer had a pending propagation.
  //    actorId is always the authenticated principal (auth.sub), never the
  //    caller-supplied consumerId, to prevent audit forgery.
  if (before.some((row) => row.consumer_id === consumerId)) {
    await dataRepo.insertRotationEvent(db, {
      secretPath,
      domain: version.domain ?? 'platform',
      tenantId: version.tenant_id ?? null,
      eventType: 'consumer_reload_confirmed',
      vaultVersionNew: vaultVersion,
      actorId: auth.sub,
      actorRoles: auth.roles ?? ['consumer'],
      detail: { consumerId }
    });
  }

  await publishEvent('console.secrets.consumer.reload-confirmed', {
    consumerId,
    secretPath,
    vaultVersion,
    confirmedAt: new Date().toISOString()
  });

  return { ack: true };
}
