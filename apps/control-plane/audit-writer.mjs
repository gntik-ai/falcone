// Dispatch-level audit + scope-enforcement denial writer (kind deploy, #557).
//
// Hooks the audit store (audit-store.mjs) and the scope_enforcement_denials store
// (packages/provisioning-orchestrator 093 migration) into the control-plane request
// dispatch, so REAL control-plane actions (tenant/user/workspace lifecycle, governance
// mutations, ...) record an audit entry WITH the request correlation_id, and scope
// denials are recorded too. Both are best-effort: auditing must NEVER fail the action
// it describes.
//
// Isolation: the audit descriptor's tenant_id is resolved from the verified identity /
// path scope (never from the request body), and the denial writer carries tenant_id +
// workspace_id + actor_id, so a record can never land under another tenant.
import { randomUUID } from 'node:crypto';
import { recordAuditEvent, ACTION_CATEGORY_BY_TYPE } from './audit-store.mjs';

// Pure seed-route contract: startup must fail closed on audit gaps (#971).
export function validateRouteAuditCoverage(routes) {
  const errors = [];
  for (const route of routes) {
    const audit = route.audit;
    let reason = null;
    if (typeof audit === 'string') {
      if (audit.length > 64 || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(audit)) reason = 'invalid audit type';
      else if (!Object.hasOwn(ACTION_CATEGORY_BY_TYPE, audit)) reason = 'audit type has no explicit category';
    } else if (audit != null) {
      const keys = Object.keys(audit);
      if (keys.length !== 1 || !['self', 'exempt'].includes(keys[0])
        || typeof audit[keys[0]] !== 'string' || !audit[keys[0]].trim()) reason = 'invalid self/exempt audit reason';
    } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) reason = 'missing audit';
    if (reason) errors.push(`${route.method} ${route.path}: ${reason}`);
  }
  if (errors.length) throw new Error(`Route audit coverage (#971): ${errors.join('; ')}`);
}

// Map an HTTP status to the audited outcome (#644): the TRUE result of the action,
// recorded at write time (was hardcoded 'succeeded' at read time).
export function outcomeFromStatus(statusCode) {
  const s = Number(statusCode ?? 200);
  if (s < 400) return 'succeeded';
  if (s === 403) return 'denied';
  if (s < 500) return 'failed';
  return 'error';
}

// Resolve the OWNING tenant id of an action from the verified identity + path scope —
// never from the request body. The path tenantId (superadmin acting on a tenant) wins;
// otherwise the caller's own tenant. For workspace-scoped actions the owning tenant is
// the caller's tenant (the handler already 403s cross-tenant), with the workspaceId from
// the response when the action created it, else the path param.
function resolveScope(route, ctx, result) {
  const params = ctx.params ?? {};
  const identity = ctx.identity ?? {};
  const body = result?.body ?? {};
  const trustedScope = result?.auditScope ?? {};
  const tenantId = trustedScope.global === true && trustedScope.tenantId === null ? null
    : trustedScope.tenantId ?? params.tenantId
    ?? body.tenantId ?? body.tenant?.tenantId ?? body.tenant?.id
    ?? identity.tenantId ?? null;
  const workspaceId = trustedScope.workspaceId ?? params.workspaceId
    ?? body.workspaceId ?? body.workspace?.workspaceId ?? body.workspace?.id
    ?? null;
  return { tenantId, workspaceId };
}

// Build the audit descriptor declared by a local or module route, or null when the
// route is self-recorded, exempt, absent or cannot be attributed
// to a tenant. The TRUE outcome (succeeded/denied/failed/error) is derived from the
// status — failures and denials ARE recorded now (#644), distinguished by outcome.
// Returned shape is the recordAuditEvent() input (sans correlationId, added by the caller).
export function auditEventForRoute(route, ctx, result) {
  // Per-route metadata also covers module dispatch and shared handlers (#971).
  const actionType = typeof route?.audit === 'string' ? route.audit : null;
  if (!actionType) return null;
  const status = result?.statusCode ?? 200;
  const { tenantId, workspaceId } = resolveScope(route, ctx, result);
  // Only a handler may opt in to the platform-global chain (#971).
  if (!tenantId && !(result?.auditScope?.global === true && result.auditScope.tenantId === null)) return null;
  const evidence = result?.knativeEvidence;
  const safeEvidence = evidence && typeof evidence === 'object' ? {
    capability: evidence.capability === 'mcp' ? 'mcp' : 'function',
    operation: ['deploy', 'update', 'invoke', 'rollback', 'delete', 'cleanup'].includes(evidence.operation)
      ? evidence.operation : 'cleanup',
    mode: ['managed', 'external', 'disabled'].includes(evidence.mode) ? evidence.mode : 'disabled',
    state: ['ready', 'unverified', 'degraded', 'unavailable', 'disabled'].includes(evidence.state)
      ? evidence.state : 'unavailable',
    reason: /^[A-Z][A-Z0-9_]{0,63}$/.test(evidence.reason ?? '')
      ? evidence.reason : 'STATUS_UNAVAILABLE',
    result: ['unavailable', 'deferred', 'recovered', 'retry_failed'].includes(evidence.result)
      ? evidence.result : 'unavailable',
  } : null;
  return {
    actionType, actorId: ctx.identity?.sub ?? 'unknown', tenantId, workspaceId,
    outcome: outcomeFromStatus(status),
    newState: {
      method: route.method,
      path: route.path,
      status,
      ...(actionType === 'workspace.iam-client.create' && result?.iamClientAudit
        ? { iamClient: result.iamClientAudit } : {}),
      ...(safeEvidence ? { knative: safeEvidence } : {}),
      ...(actionType === 'workspace.function.activation.rerun' && result?.auditScope?.resourceId
        ? { resourceId: result.auditScope.resourceId } : {}),
    }
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
  requiredEntitlement = null, currentPlanId = null, sourceIp = null, requiredRole = null,
  correlationId, deniedAt = new Date().toISOString()
} = {}, log = console) {
  try {
    if (!tenantId || !actorId || !correlationId) return null;
    // A role refusal has no scope evidence; do not invent a scope failure (#958).
    if (denialType === 'SCOPE_INSUFFICIENT'
      && !requiredScopes?.length && !missingScopes?.length) denialType = 'ROLE_INSUFFICIENT';
    const res = await db.query(
      `INSERT INTO scope_enforcement_denials (
        id, tenant_id, workspace_id, actor_id, actor_type, denial_type, http_method, request_path,
        required_scopes, presented_scopes, missing_scopes, required_entitlement, current_plan_id,
        source_ip, correlation_id, denied_at, required_role
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (correlation_id, denied_at) DO NOTHING
      RETURNING *`,
      [randomUUID(), tenantId, workspaceId, actorId, actorType, denialType, httpMethod ?? 'GET',
        requestPath ?? '/', requiredScopes ?? [], presentedScopes ?? [], missingScopes ?? [],
        requiredEntitlement, currentPlanId, sourceIp, correlationId, deniedAt, requiredRole]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    log.warn?.(`[control-plane] scope denial write skipped: ${e?.message ?? e}`);
    return null;
  }
}

// Record a quota-enforcement decision into quota_enforcement_log (the store the quota audit
// reads). Called at an enforcement point (e.g. a 402 QUOTA_EXCEEDED) so a denial leaves a
// correlated row. Best-effort: a logging failure must not change the (already-decided)
// response. dimension_key must exist in quota_dimension_catalog (it does whenever a real
// decision was made — a missing dimension fails open, so no denial reaches here).
export async function recordQuotaEnforcement(db, {
  tenantId, workspaceId = null, dimensionKey, attemptedAction = null, currentUsage = null,
  effectiveLimit, quotaType = 'hard', graceMargin = 0, effectiveCeiling,
  source = 'default', decision, actorId = null, correlationId = null, warning = null
} = {}, log = console) {
  try {
    if (!tenantId || !dimensionKey || effectiveLimit == null || effectiveCeiling == null || !decision) return null;
    const res = await db.query(
      `INSERT INTO quota_enforcement_log (
        id, tenant_id, workspace_id, dimension_key, attempted_action, current_usage,
        effective_limit, quota_type, grace_margin, effective_ceiling, source, decision,
        actor_id, correlation_id, warning
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [randomUUID(), tenantId, workspaceId, dimensionKey, attemptedAction, currentUsage,
        effectiveLimit, quotaType, graceMargin ?? 0, effectiveCeiling, source ?? 'default', decision,
        actorId, correlationId, warning]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    log.warn?.(`[control-plane] quota enforcement write skipped: ${e?.message ?? e}`);
    return null;
  }
}

// Map a verified identity's actorType to the scope_enforcement_denials.actor_type domain.
function denialActorType(actorType) {
  const t = String(actorType ?? '').toLowerCase();
  if (t.includes('api') && t.includes('key')) return 'api_key';
  if (t.includes('service')) return 'service_account';
  if (t === 'anonymous' || t === 'anon') return 'anonymous';
  return 'user';
}

// Record an authorization denial from any dispatch path that returned 403 (#958)
// (best-effort). Attributed to the caller's verified tenant + actor and the request
// correlation id (generated if absent), so a tenant's audit query surfaces its own denied
// attempts. Unattributable denials are logged without request or credential material.
export async function recordRouteDenial(db, route, ctx, result, correlationId, log = console, denialType = 'ROLE_INSUFFICIENT') {
  try {
    if ((result?.statusCode ?? 200) !== 403) return null;
    const identity = ctx.identity ?? {};
    const tenantId = identity.tenantId ?? null;
    const actorId = identity.sub ?? identity.actorId ?? null;
    const actorType = identity.isServiceAccount ? 'service_account' : denialActorType(identity.actorType);
    const requestCorrelationId = correlationId || randomUUID();
    if (!tenantId || !actorId) {
      log.warn?.(JSON.stringify({
        event: 'authorization_denial_unattributed', tenant_id: tenantId, actor_id: actorId,
        actor_type: actorType, http_method: ctx.req?.method ?? route?.method ?? 'GET',
        request_path: route?.path ?? '/', required_role: route?.auth ?? null,
        correlation_id: requestCorrelationId
      }));
      return null;
    }
    return await recordScopeDenial(db, {
      tenantId,
      workspaceId: identity.workspaceId ?? null,
      actorId,
      actorType,
      denialType,
      requiredRole: route?.auth ?? null,
      httpMethod: ctx.req?.method ?? route?.method ?? 'GET',
      requestPath: route?.path ?? '/',
      correlationId: requestCorrelationId,
    }, log);
  } catch (e) {
    log.warn?.(`[control-plane] route denial write skipped: ${e?.message ?? e}`);
    return null;
  }
}
