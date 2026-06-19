// Webhook management plane — kind control-plane local handler (#643).
//
// The webhook engine (services/webhook-engine) is code-complete but was never
// wired onto the kind runtime (/v1/webhooks/* returned 404 / NO_ROUTE). This
// local handler serves the management/subscription surface by wrapping the
// product action `webhook-management.mjs::main(params)`:
//   - builds the Postgres-backed db adapter from the runtime pool (webhook-db.mjs),
//   - maps the server's local-handler `ctx` to the action's single-arg params
//     (method + pathname from ctx.req.url, body, query),
//   - derives auth from the VERIFIED identity only (ctx.identity), so a request
//     body can never spoof the tenant/workspace/actor,
//   - returns {statusCode, body} for the server to serialize.
//
// Out of scope here: the outbound delivery-execution loop (dispatcher ->
// delivery-worker -> retry-scheduler), which needs a background event consumer
// that does not yet exist on the kind runtime. The /deliveries read endpoints
// are served and return empty lists until that loop is wired.
import { buildWebhookDb } from './webhook-db.mjs';

// The action module resolves under /repo in the image; REPO_ROOT lets a local
// checkout (tests) point at the source tree. Same convention as the route loader.
const REPO_ROOT = process.env.REPO_ROOT || '/repo';
const ACTION_PATH = `${REPO_ROOT}/services/webhook-engine/actions/webhook-management.mjs`;

let _mainPromise = null;
function loadMain() {
  if (!_mainPromise) _mainPromise = import(ACTION_PATH).then((m) => m.main);
  return _mainPromise;
}

function pathnameOf(url) {
  try { return new URL(url ?? '/', 'http://localhost').pathname; }
  catch { return String(url ?? '/').split('?')[0]; }
}

/**
 * Serve a /v1/webhooks/* request by delegating to the webhook-management action.
 * @param {object} ctx     the control-plane local-handler context
 * @param {object} [deps]  test seam: { buildDb } overrides the Postgres adapter
 * @returns {Promise<{statusCode:number, body:any}>}
 */
export async function webhookManage(ctx, deps = {}) {
  const main = await loadMain();
  const buildDb = deps.buildDb ?? buildWebhookDb;
  const identity = ctx.identity ?? {};
  const result = await main({
    db: buildDb(ctx.pool),
    kafka: null, // audit events are best-effort; the action no-ops when kafka is absent
    env: process.env,
    method: (ctx.req?.method ?? 'GET').toUpperCase(),
    path: pathnameOf(ctx.req?.url),
    body: ctx.body ?? {},
    query: ctx.query ?? {},
    auth: { tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: identity.sub },
    resolver: deps.resolver, // undefined in prod -> action uses real DNS for SSRF validation
  });
  return { statusCode: result.statusCode, body: result.body };
}

export const WEBHOOK_HANDLERS = { webhookManage };
