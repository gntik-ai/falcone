// Dispatch-level audit + scope-enforcement denial writer (kind deploy, #557).
//
// Hooks the audit store (audit-store.mjs) and the scope_enforcement_denials store
// (services/provisioning-orchestrator 093 migration) into the control-plane request
// dispatch, so REAL control-plane actions (tenant/user/workspace lifecycle, governance
// mutations, ...) record an audit entry WITH the request correlation_id, and scope
// denials are recorded too. Both are best-effort: auditing must NEVER fail the action
// it describes.
//
// Isolation: the audit descriptor's tenant_id is resolved from the verified identity /
// path scope (never from the request body), and the denial writer carries tenant_id +
// workspace_id + actor_id, so a record can never land under another tenant.
import { randomUUID } from 'node:crypto';
import { recordAuditEvent } from './audit-store.mjs';

// Local handlers whose effect is a STATE MUTATION worth auditing, mapped to a stable
// action_type. Read handlers (list*/get*/iam list*/metrics*) are intentionally absent,
// so a GET never produces an audit record.
const AUDITABLE_LOCAL_HANDLERS = {
  createTenant: 'tenant.create', deleteTenant: 'tenant.delete', purgeTenant: 'tenant.purge',
  createTenantUser: 'tenant.user.create',
  setAuthConfig: 'tenant.auth-config.update', setSocialProvider: 'tenant.social-provider.upsert',
  deleteSocialProvider: 'tenant.social-provider.delete',
  createWorkspace: 'workspace.create',
  createServiceAccount: 'workspace.service-account.create',
  issueCredential: 'workspace.service-account.credential.issue',
  rotateCredential: 'workspace.service-account.credential.rotate',
  revokeCredential: 'workspace.service-account.credential.revoke',
  provisionDatabase: 'workspace.database.provision',
  provisionDatabaseGeneric: 'workspace.database.provision',
  rotateDatabaseCredential: 'workspace.database.credential.rotate',
  registerFunction: 'workspace.function.register',
  iamCreateUser: 'iam.user.create', iamDeleteUser: 'iam.user.delete', iamSetUserStatus: 'iam.user.status',
  iamCreateRole: 'iam.role.create', iamCreateGroup: 'iam.group.create',
  iamAssignUserRoles: 'iam.user.role-assign', iamRemoveUserRoles: 'iam.user.role-remove',
  iamAddUserToGroup: 'iam.user.group-add', iamRemoveUserFromGroup: 'iam.user.group-remove'
};

// Resolve the OWNING tenant id of an action from the verified identity + path scope —
// never from the request body. The path tenantId (superadmin acting on a tenant) wins;
// otherwise the caller's own tenant. For workspace-scoped actions the owning tenant is
// the caller's tenant (the handler already 403s cross-tenant), with the workspaceId from
// the response when the action created it, else the path param.
function resolveScope(route, ctx, result) {
  const params = ctx.params ?? {};
  const identity = ctx.identity ?? {};
  const body = result?.body ?? {};
  const tenantId = params.tenantId
    ?? body.tenantId ?? body.tenant?.tenantId ?? body.tenant?.id
    ?? identity.tenantId ?? null;
  const workspaceId = params.workspaceId
    ?? body.workspaceId ?? body.workspace?.workspaceId ?? body.workspace?.id
    ?? null;
  return { tenantId, workspaceId };
}

// Build the audit descriptor a successfully-completed mutating local route produces, or
// null when the route is non-auditable (a read) or the action did not succeed (>=400).
// Returned shape is the recordAuditEvent() input (sans correlationId, added by the caller).
export function auditEventForRoute(route, ctx, result) {
  if (!route?.localHandler) return null;
  const actionType = AUDITABLE_LOCAL_HANDLERS[route.localHandler];
  if (!actionType) return null;
  const status = result?.statusCode ?? 200;
  if (status >= 400) return null; // only successful mutations are audited
  const { tenantId, workspaceId } = resolveScope(route, ctx, result);
  if (!tenantId) return null; // never record an action we cannot attribute to a tenant
  return {
    actionType, actorId: ctx.identity?.sub ?? 'unknown', tenantId, workspaceId,
    newState: { method: route.method, path: route.path, status }
  };
}

// Record the audit event for a dispatched local action (best-effort). Swallows any
// error so auditing never breaks the action; logs at warn for diagnosability.
export async function recordRouteAudit(db, route, ctx, result, correlationId, log = console) {
  try {
    const desc = auditEventForRoute(route, ctx, result);
    if (!desc) return null;
    return await recordAuditEvent(db, { ...desc, correlationId: correlationId ?? null });
  } catch (e) {
    log.warn?.(`[control-plane] audit write skipped: ${e?.message ?? e}`);
    return null;
  }
}

// Record a scope-enforcement denial into scope_enforcement_denials (the store the
// scope-enforcement audit query reads). Reuses the product repo's insert via the same
// SQL contract; tenant_id/workspace_id/actor_id/correlation_id are mandatory carriers.
// Best-effort: a denial-record failure must not change the (already-denied) response.
export async function recordScopeDenial(db, {
  tenantId, workspaceId = null, actorId, actorType = 'user', denialType = 'SCOPE_INSUFFICIENT',
  httpMethod, requestPath, requiredScopes = [], presentedScopes = [], missingScopes = [],
  requiredEntitlement = null, currentPlanId = null, sourceIp = null,
  correlationId, deniedAt = new Date().toISOString()
} = {}, log = console) {
  try {
    if (!tenantId || !actorId || !correlationId) return null;
    const res = await db.query(
      `INSERT INTO scope_enforcement_denials (
        id, tenant_id, workspace_id, actor_id, actor_type, denial_type, http_method, request_path,
        required_scopes, presented_scopes, missing_scopes, required_entitlement, current_plan_id,
        source_ip, correlation_id, denied_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (correlation_id, denied_at) DO NOTHING
      RETURNING *`,
      [randomUUID(), tenantId, workspaceId, actorId, actorType, denialType, httpMethod ?? 'GET',
        requestPath ?? '/', requiredScopes ?? [], presentedScopes ?? [], missingScopes ?? [],
        requiredEntitlement, currentPlanId, sourceIp, correlationId, deniedAt]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    log.warn?.(`[control-plane] scope denial write skipped: ${e?.message ?? e}`);
    return null;
  }
}

export { AUDITABLE_LOCAL_HANDLERS };
