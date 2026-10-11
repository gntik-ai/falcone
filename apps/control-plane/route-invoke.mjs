export const SUPPORTED_INVOKES = new Set(['params-pg', 'params-only', 'params-overrides', 'callercontext-overrides', 'owhttp-overrides', 'params-auth', 'params-auth-overrides', 'owhttp', 'params-auth-db', 'identity-overrides', 'workflow-status']);

const PLATFORM_ROLES = new Set(['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor',
  'platform-admin', 'platform-operator', 'platform-auditor']);

function buildOverrides(route, db) {
  const o = {};
  for (const dep of route.deps ?? []) {
    if (dep === 'db' || dep === 'pg') o.db = db;
    // kafka/minio/vault are optional: the actions no-op event emission when their
    // producer is absent, and the few minio/vault writers degrade gracefully.
  }
  return o;
}
// Build the `params.auth` object the params-auth* actions read, from the verified
// identity (subject/tenant/roles/scopes/actorType).
export function authFrom(identity) {
  // A verified tenant issuer cannot grant platform authority. Keep tenant roles
  // intact, but require platform issuer trust before forwarding platform roles.
  const roles = (identity.roles ?? []).filter(role => identity.trustKind === 'platform' || !PLATFORM_ROLES.has(role));
  return {
    subject: identity.sub, sub: identity.sub, actorId: identity.sub,
    tenantId: identity.tenantId, workspaceId: identity.workspaceId, workspaceIds: identity.workspaceIds,
    privilegeDomains: identity.privilegeDomains,
    actorType: identity.actorType, roles, scopes: identity.scopes
  };
}
export async function invokeRoute(route, handler, params, callerContext, identity, db, ensureSetClient = async () => {}) {
  switch (route.invoke ?? 'callercontext-overrides') {
    case 'workflow-status': {
      if (!identity?.tenantId) return { statusCode: 401, body: { code: 'UNAUTHENTICATED' } };
      if ((params.tenantId && params.tenantId !== identity.tenantId)
          || (params.workspaceId && !(identity.workspaceIds ?? [identity.workspaceId]).includes(params.workspaceId))) {
        return { statusCode: 403, body: { code: 'FORBIDDEN' } };
      }
      try {
        const status = await handler(params.jobRef, { ...callerContext, tenantId: identity.tenantId,
          workspaceId: params.workspaceId ?? null, role: undefined }, { db });
        return status ? { statusCode: 200, body: status } : { statusCode: 404, body: { code: 'NOT_FOUND' } };
      } catch (error) {
        if (error.code === 'FORBIDDEN') return { statusCode: 403, body: { code: 'FORBIDDEN' } };
        throw error;
      }
    }
    case 'identity-overrides':
      if (!identity?.tenantId) return { statusCode: 401, body: { code: 'UNAUTHENTICATED' } };
      return handler(params, { ...buildOverrides(route, db), identity: { ...identity, ...authFrom(identity) } });
    case 'params-auth-db': {
      if (!identity) return { statusCode: 401, body: { code: 'UNAUTHENTICATED' } };
      const tenantId = params.domain === 'tenant' ? identity.tenantId : null;
      const secretPath = params.domain === 'tenant'
        ? `tenant/${tenantId}/${params.secretName}` : `${params.domain}/${params.secretName}`;
      const roleAliases = { tenant_owner: 'tenant-owner', tenant_operator: 'tenant-operator', platform_operator: 'platform-operator' };
      const auth = authFrom(identity);
      auth.roles = auth.roles.flatMap(role => roleAliases[role] ? [role, roleAliases[role]] : [role]);
      const result = await handler({ ...params, tenantId, secretPath, auth, db,
        vaultClient: undefined, repo: undefined, publishEvent: undefined, triggerEsoRefresh: undefined });
      return result?.statusCode ? result : { statusCode: result?.error?.status ?? 200, body: result };
    }
    case 'params-pg': return handler({ ...params, pg: db });
    case 'params-only': return handler(params);
    case 'params-overrides': return handler(params, buildOverrides(route, db));
    case 'callercontext-overrides':
      return handler({ ...params, callerContext }, buildOverrides(route, db));
    case 'owhttp-overrides':
      return handler({ ...params, __ow_method: String(params.__ow_method ?? '').toLowerCase() }, buildOverrides(route, db));
    case 'params-auth':
      return handler({ ...params, auth: identity ? authFrom(identity) : null });
    case 'params-auth-overrides':
      return handler({ ...params, auth: identity ? authFrom(identity) : null }, buildOverrides(route, db));
    case 'owhttp':
      await ensureSetClient(route);
      return handler({ ...params, __ow_method: String(params.__ow_method ?? '').toLowerCase() });
    default:
      throw Object.assign(new Error(`route ${route.path} unknown invoke ${route.invoke}`), { statusCode: 500 });
  }
}
