// Webhook management plane — kind control-plane local handler (#643).
//
// The webhook engine (packages/webhook-engine) is code-complete but was never
// wired onto the kind runtime (/v1/webhooks/* returned 404 / NO_ROUTE). This
// local handler serves the management/subscription surface by wrapping the
// product action `webhook-management.mjs::main(params)`:
//   - builds the Postgres-backed db adapter from the webhook-only runtime pool
//     (webhook-db.mjs), while workspace authorization stays on the existing
//     global control-plane pool,
//   - maps the server's local-handler `ctx` to the action's single-arg params
//     (method + pathname from ctx.req.url, body, query),
//   - derives auth from the VERIFIED identity only (ctx.identity), so a request
//     body can never spoof the tenant/workspace/actor,
//   - returns {statusCode, body} for the server to serialize.
//
// Two addressing forms, both served by this handler:
//   1. Workspace-addressed (primary): /v1/workspaces/{workspaceId}/webhooks/...
//      The workspace comes from the PATH (consistent with functions/storage/events)
//      and is authorized against the caller's verified tenant — so a tenant_owner
//      (whose JWT carries no workspace_id) can manage a workspace's webhooks. This
//      form rides the existing gateway route /v1/workspaces/* and is reachable by
//      real principals.
//   2. Tenant-addressed: /v1/webhooks/... — the workspace comes from the JWT
//      (auth.workspaceId), for a workspace-scoped principal.
//
// Out of scope here: the outbound delivery-execution loop (dispatcher ->
// delivery-worker -> retry-scheduler), which needs a background event consumer
// that does not yet exist on the kind runtime. The /deliveries read endpoints are
// served and return empty lists until that loop is wired.
import {
  assertWebhookDatabasePoolBoundary,
  buildWebhookDb,
} from './webhook-db.mjs';
import { getWorkspace } from './tenant-store.mjs';
import { canManageTenant } from './tenant-scope.mjs';
import {
  configureWebhookRuntimeKeyContext,
  requireWebhookRuntimeKeyContext,
} from './webhook-runtime.mjs';

// The action module resolves under /repo in the image; REPO_ROOT lets a local
// checkout (tests) point at the source tree. Same convention as the route loader.
const REPO_ROOT = process.env.REPO_ROOT || '/repo';
const ACTION_PATH = `${REPO_ROOT}/packages/webhook-engine/actions/webhook-management.mjs`;

let _mainPromise = null;
export function setWebhookKeyContext(keyContext) {
  return configureWebhookRuntimeKeyContext(keyContext);
}
function loadMain() {
  if (!_mainPromise) _mainPromise = import(ACTION_PATH).then((m) => m.main);
  return _mainPromise;
}

function pathnameOf(url) {
  try { return new URL(url ?? '/', 'http://localhost').pathname; }
  catch { return String(url ?? '/').split('?')[0]; }
}

/**
 * Serve a webhook management request by delegating to the webhook-management action.
 * @param {object} ctx     the control-plane local-handler context
 * @param {object} [deps]  test seam: { buildDb, getWorkspace, keyContext, resolver }
 * @returns {Promise<{statusCode:number, body:any}>}
 */
export async function webhookManage(ctx, deps = {}) {
  const main = await loadMain();
  const buildDb = deps.buildDb ?? buildWebhookDb;
  const resolveWorkspace = deps.getWorkspace ?? getWorkspace;
  let keyContext = deps.keyContext;
  try {
    keyContext ??= requireWebhookRuntimeKeyContext();
  } catch {
    return { statusCode: 503, body: { code: 'WEBHOOK_KEY_UNAVAILABLE', message: 'Webhook key lifecycle is not ready' } };
  }
  try {
    assertWebhookDatabasePoolBoundary(
      ctx.webhookRuntimePool,
      ctx.webhookWritePool,
      { controlPlanePool: ctx.pool },
    );
  } catch (caught) {
    const code = caught?.code === 'WEBHOOK_DATABASE_PRINCIPALS_INVALID'
      ? 'WEBHOOK_DATABASE_PRINCIPALS_INVALID'
      : 'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED';
    return {
      statusCode: 503,
      body: {
        code,
        message: 'Webhook database principal configuration is unavailable',
      },
    };
  }
  const identity = ctx.identity ?? {};
  let path = pathnameOf(ctx.req?.url);
  let workspaceId = identity.workspaceId ?? null;
  let tenantId = identity.tenantId ?? null;

  // Workspace-addressed form: take the workspace from the PATH and authorize it
  // against the caller's verified tenant. A missing OR cross-tenant workspace is
  // a 404 before any role check (never disclose existence). The resolved record
  // supplies both scope dimensions, including for platform callers with no tenant
  // claim. Rewrite the path to the /v1/webhooks/... shape the action understands.
  if (ctx.params?.workspaceId) {
    const ws = await resolveWorkspace(ctx.pool, ctx.params.workspaceId);
    const platformCaller = identity.actorType === 'superadmin' || identity.actorType === 'internal';
    if (!ws || (!platformCaller && (identity.tenantId == null || identity.tenantId !== ws.tenant_id))) {
      return { statusCode: 404, body: { code: 'NOT_FOUND', message: 'workspace not found' } };
    }
    const idx = path.indexOf('/webhooks');
    const webhookPath = idx >= 0 ? path.slice(idx) : '';
    if (webhookPath !== '/webhooks/event-types' && !canManageTenant(identity, ws.tenant_id)) {
      return { statusCode: 403, body: { code: 'FORBIDDEN', message: 'requires superadmin or tenant owner/admin' } };
    }
    workspaceId = ws.id;
    tenantId = ws.tenant_id;
    path = '/v1/webhooks' + (idx >= 0 ? path.slice(idx + '/webhooks'.length) : '');
  }

  if (/^\/v1\/webhooks\/subscriptions(?:\/|$)/.test(path)
      && (typeof tenantId !== 'string' || tenantId.length === 0
        || typeof workspaceId !== 'string' || workspaceId.length === 0)) {
    return { statusCode: 400, body: { code: 'WEBHOOK_SCOPE_REQUIRED', message: 'Webhook tenant and workspace scope are required' } };
  }

  const result = await main({
    db: buildDb(ctx.webhookRuntimePool, { writePool: ctx.webhookWritePool }),
    kafka: null, // audit events are best-effort; the action no-ops when kafka is absent
    keyContext,
    env: process.env,
    method: (ctx.req?.method ?? 'GET').toUpperCase(),
    path,
    body: ctx.body ?? {},
    query: ctx.query ?? {},
    auth: { tenantId, workspaceId, actorId: identity.sub },
    resolver: deps.resolver, // undefined in prod -> action uses real DNS for SSRF validation
  });
  return { statusCode: result.statusCode, body: result.body };
}

export const WEBHOOK_HANDLERS = { webhookManage };
