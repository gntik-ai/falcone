import { validateAssignment } from '../models/privilege-domain-assignment.mjs';
import * as repo from '../repositories/privilege-domain-repository.mjs';
import { TOPICS, buildAssignedEvent, buildLastAdminGuardEvent, buildRevokedEvent } from '../events/privilege-domain-events.mjs';

function ok(body) { return { statusCode: 200, body }; }
function err(status, code, detail = {}) { return { statusCode: status, body: { error: code, ...detail } }; }

function isAuthorized(auth, tenantId, workspaceId) {
  const roles = auth?.roles ?? [];
  if (roles.includes('platform_admin')) return true;
  if (auth?.tenantId !== tenantId) return false;
  return Boolean((auth?.privilegeDomains?.[workspaceId] ?? []).includes('structural_admin'));
}

export function resolveDependencies(overrides = {}) {
  return {
    db: overrides.db,
    repo: overrides.repo ?? repo,
    publishEvent: overrides.publishEvent ?? (async () => {}),
    syncKeycloakRoles: overrides.syncKeycloakRoles ?? (async () => {}),
    invalidateApisixCache: overrides.invalidateApisixCache ?? (async () => {}),
    log: overrides.log ?? console
  };
}

export async function main(params = {}, overrides = {}) {
  const deps = resolveDependencies(overrides);
  const { workspaceId, memberId, tenantId, auth } = params;
  const correlationId = params.correlationId ?? params.headers?.['x-correlation-id'] ?? null;
  try {
    validateAssignment(params);
  } catch (error) {
    return err(400, 'VALIDATION_ERROR', { message: error.message });
  }
  if (!workspaceId || !memberId || !tenantId) return err(400, 'VALIDATION_ERROR', { message: 'workspaceId, memberId and tenantId are required' });
  if (!isAuthorized(auth, tenantId, workspaceId)) return err(403, 'FORBIDDEN');

  const client = deps.db;
  await client.query('BEGIN');
  try {
    const current = await deps.repo.getAssignment(client, { tenantId, workspaceId, memberId });
    if (current?.structural_admin && params.structural_admin === false) {
      const count = await deps.repo.getStructuralAdminCountForUpdate(client, { workspaceId, tenantId });
      if (count <= 1) {
        await client.query('ROLLBACK');
        await deps.publishEvent(TOPICS.LAST_ADMIN, buildLastAdminGuardEvent({ tenantId, workspaceId, memberId, attemptedBy: auth?.sub ?? auth?.actorId ?? 'unknown' }));
        return err(400, 'LAST_STRUCTURAL_ADMIN');
      }
    }
    const result = await deps.repo.upsertAssignment(client, {
      tenantId,
      workspaceId,
      memberId,
      structural_admin: params.structural_admin,
      data_access: params.data_access,
      assignedBy: auth?.sub ?? auth?.actorId ?? memberId,
      correlationId
    });
    await client.query('COMMIT');

    Promise.resolve().then(async () => {
      try {
        await deps.syncKeycloakRoles({ workspaceId, memberId, previous: current, next: result.assignment });
      } catch (error) {
        deps.log.error?.({ event: 'keycloak_sync_failed', error: error.message });
      }
      try {
        await deps.invalidateApisixCache({ workspaceId });
      } catch (error) {
        deps.log.error?.({ event: 'apisix_invalidation_failed', error: error.message });
      }
      for (const transition of result.transitions) {
        const event = transition.changeType === 'assigned'
          ? buildAssignedEvent({ tenantId, workspaceId, memberId, privilegeDomain: transition.privilegeDomain, assignedBy: auth?.sub ?? memberId })
          : buildRevokedEvent({ tenantId, workspaceId, memberId, privilegeDomain: transition.privilegeDomain, revokedBy: auth?.sub ?? memberId });
        const topic = transition.changeType === 'assigned' ? TOPICS.ASSIGNED : TOPICS.REVOKED;
        await deps.publishEvent(topic, event);
      }
    });

    return ok(result.assignment);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.code === '40001') return err(409, 'CONFLICT');
    throw error;
  }
}
