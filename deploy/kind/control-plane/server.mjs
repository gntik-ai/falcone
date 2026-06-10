// Falcone control-plane HTTP server (kind deploy).
//
// The repo ships the control-plane as serverless ACTION MODULES (main(params,
// overrides) -> {statusCode, body}) meant to run on OpenWhisk behind APISIX; it
// has no runnable API server. This server is that missing runtime: it
//   1) validates the incoming Bearer JWT against the Keycloak realm JWKS,
//   2) derives a TRUSTED identity (callerContext + x-* headers) from the verified
//      claims (so the request body can never spoof identity),
//   3) dispatches (method, path) to the real product action module via a
//      data-driven route table, injecting the dependencies each action needs
//      (pg Pool today; more added per family),
//   4) maps the action's {statusCode, body} back to HTTP, with CORS for the SPA.
//
// It is the production-shaped sibling of tests/env/action-runner (which trusts
// gateway-injected headers); here we self-validate the JWT so it works
// regardless of APISIX plugin configuration.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { routes as seedRoutes } from './routes.mjs';
import { LOCAL_HANDLERS } from './b-handlers.mjs';
import { ensureSchema } from './tenant-store.mjs';
import { ensureSagaSchema, recoverSagas } from './saga.mjs';

const { Pool } = pg;

const PORT = Number(process.env.PORT ?? 8080);
// DB_URL wins if set; otherwise the pg driver reads standard PG* env vars
// (PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT) — the secure path, with PGPASSWORD
// injected from the postgres Secret via secretKeyRef (no plaintext password).
const DB_URL = process.env.DB_URL || null;
const JWKS_URL = process.env.KEYCLOAK_JWKS_URL
  ?? 'http://falcone-keycloak:8080/realms/in-falcone-platform/protocol/openid-connect/certs';
const ISSUER = process.env.KEYCLOAK_ISSUER || null;   // optional exact-match check
const AUDIENCE = process.env.KEYCLOAK_AUDIENCE || null;
const ROUTE_MAP_FILE = process.env.ROUTE_MAP_FILE || null; // optional JSON merged over seedRoutes

const pool = DB_URL ? new Pool({ connectionString: DB_URL, max: 12 }) : new Pool({ max: 12 });
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

// ---- route table -----------------------------------------------------------
// Each route: { method, path, module, export, invoke, deps?, auth?,
//   mergeBodyIntoParams?, mergeQueryIntoParams?, defaults?, setClientModule? }.
// `path` is an Express-ish template: `{param}` -> named capture, trailing `/*`
// or `*` -> match-rest. Compiled to a RegExp with named groups once at load.
function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)         // escape regex metas (our { } handled next)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')    // {param} -> named group
    .replace(/\/\\\*$/, '(?:/.*)?')                          // trailing /* -> optional rest
    .replace(/\\\*/g, '.*');                                 // bare * -> rest
  return new RegExp('^' + rx + '/?$');
}

let ROUTES = [];
function loadRoutes(extra = []) {
  // Dedupe by `METHOD path`. Seed routes (curated: domain B local handlers +
  // proven A routes) take precedence over the generated runtime map on collision.
  const byKey = new Map();
  for (const r of [...extra, ...seedRoutes]) byKey.set(`${r.method} ${r.path}`, r);
  ROUTES = [...byKey.values()].map((r) => ({ ...r, _rx: compilePath(r.path) }));
  // Most-specific first: more path segments win; wildcard routes sink.
  ROUTES.sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
    || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
}

function matchRoute(method, path) {
  for (const r of ROUTES) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

// ---- helpers (shared shape with tests/env/action-runner) -------------------
function lowercaseHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  return out;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 8e6) req.destroy(); });
    req.on('end', () => resolve(d)); req.on('error', reject);
  });
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-correlation-id,idempotency-key',
  'Access-Control-Max-Age': '600'
};
function sendJson(res, statusCode, body, extra = {}) {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload), ...CORS, ...extra });
  res.end(payload);
}

// ---- identity: verify the Bearer JWT, derive trusted claims ----------------
const KNOWN_ROLE_TO_ACTORTYPE = [
  ['superadmin', 'superadmin'], ['platform_admin', 'superadmin'], ['platform_operator', 'internal'],
  ['tenant_owner', 'tenant_owner'], ['tenant_admin', 'tenant_owner'],
  ['workspace_admin', 'workspace_admin'], ['workspace_owner', 'workspace_admin']
];
function deriveActorType(claims) {
  if (claims.actor_type) return claims.actor_type;
  const roles = claims?.realm_access?.roles ?? [];
  for (const [role, type] of KNOWN_ROLE_TO_ACTORTYPE) if (roles.includes(role)) return type;
  return 'tenant_member';
}
async function authenticate(headers) {
  const auth = headers['authorization'];
  if (!auth || !/^bearer\s+/i.test(auth)) return null;
  const token = auth.replace(/^bearer\s+/i, '');
  const opts = {};
  if (ISSUER) opts.issuer = ISSUER;
  if (AUDIENCE) opts.audience = AUDIENCE;
  const { payload } = await jwtVerify(token, JWKS, opts);
  const roles = payload?.realm_access?.roles ?? [];
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean)
    : (Array.isArray(payload.scopes) ? payload.scopes : []);
  return {
    sub: payload.sub,
    tenantId: payload.tenant_id ?? null,
    workspaceId: payload.workspace_id ?? null,
    actorType: deriveActorType(payload),
    roles, scopes,
    // The trusted x-* headers a Falcone action / buildCallerContext expects.
    trustedHeaders: {
      'x-auth-subject': payload.sub ?? '',
      'x-tenant-id': payload.tenant_id ?? '',
      'x-workspace-id': payload.workspace_id ?? '',
      'x-actor-type': deriveActorType(payload),
      'x-actor-roles': roles.join(','),
      'x-actor-scopes': scopes.join(',')
    }
  };
}
function callerContextFrom(identity, correlationId) {
  return {
    actor: { id: identity.sub, type: identity.actorType, tenantId: identity.tenantId,
      roles: identity.roles, scopes: identity.scopes },
    tenantId: identity.tenantId, workspaceId: identity.workspaceId, correlationId: correlationId ?? null
  };
}
function authzOk(route, identity) {
  const need = route.auth;
  if (!need || need === 'public' || need === 'authenticated') return true;
  if (need === 'superadmin') return identity.actorType === 'superadmin' || identity.actorType === 'internal'
    || identity.roles.includes('superadmin') || identity.roles.includes('platform_admin');
  if (need === 'tenant_owner') return ['tenant_owner', 'tenant_admin', 'superadmin', 'internal'].includes(identity.actorType)
    || identity.roles.some((r) => ['tenant_owner', 'tenant_admin', 'superadmin', 'platform_admin'].includes(r));
  return true; // unknown -> defer to the action's own check
}

// ---- dependency injection + invoke (mirrors the proven shim) ----------------
const setClientDone = new Set();
async function ensureSetClient(route) {
  const mod = route.setClientModule;
  if (!mod || setClientDone.has(mod)) return;
  const imported = await import(mod);
  if (typeof imported.setClient === 'function') imported.setClient(pool);
  setClientDone.add(mod);
}
function routeNeedsDb(route) {
  return (route.deps ?? []).some((d) => d === 'db' || d === 'pg') || (route.invoke === 'params-pg');
}
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
function authFrom(identity) {
  return {
    subject: identity.sub, sub: identity.sub,
    tenantId: identity.tenantId, workspaceId: identity.workspaceId,
    actorType: identity.actorType, roles: identity.roles, scopes: identity.scopes
  };
}
const handlerCache = new Map();
async function loadHandler(route) {
  const key = route.module + '#' + route.export;
  if (!handlerCache.has(key)) {
    const mod = await import(route.module);
    const fn = mod[route.export];
    if (typeof fn !== 'function') throw Object.assign(new Error(`route ${route.path} export ${route.export} not a function`), { statusCode: 500 });
    handlerCache.set(key, fn);
  }
  return handlerCache.get(key);
}
// `db` is a DEDICATED pooled client (not the Pool) for routes that need it, so
// the actions' multi-statement transactions (BEGIN/INSERT/COMMIT) run on one
// connection. Released by the caller after the handler resolves.
async function invokeRoute(route, handler, params, callerContext, identity, db) {
  switch (route.invoke ?? 'callercontext-overrides') {
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

// ---- request handler -------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const method = (req.method ?? 'GET').toUpperCase();
  try {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const path = parsed.pathname;

    if (method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (path === '/healthz' || path === '/readyz') {
      try { await pool.query('SELECT 1'); return sendJson(res, 200, { status: 'ok' }); }
      catch (e) { console.error('[control-plane] healthz db check failed:', e); return sendJson(res, 503, { status: 'db_unavailable' }); }
    }
    if (path === '/') return sendJson(res, 200, { service: 'in-falcone-control-plane', routes: ROUTES.length });

    const matched = matchRoute(method, path);
    if (!matched) return sendJson(res, 404, { code: 'NO_ROUTE', message: `No action mapped for ${method} ${path}` });
    const route = matched.route;

    const headers = lowercaseHeaders(req.headers);
    const correlationId = headers['x-correlation-id'] ?? null;

    let identity = null;
    if (route.auth !== 'public') {
      try { identity = await authenticate(headers); }
      catch (e) { console.error('[control-plane] token verification failed:', e); return sendJson(res, 401, { code: 'INVALID_TOKEN', message: 'Token verification failed' }); }
      if (!identity) return sendJson(res, 401, { code: 'UNAUTHENTICATED', message: 'Missing or invalid Bearer token' });
      if (!authzOk(route, identity)) return sendJson(res, 403, { code: 'FORBIDDEN', message: `requires ${route.auth}` });
    }

    const query = Object.fromEntries(parsed.searchParams.entries());
    const rawBody = await readBody(req);
    let body = {};
    if (rawBody) { try { body = JSON.parse(rawBody); } catch { return sendJson(res, 400, { code: 'INVALID_JSON', message: 'Body is not valid JSON' }); } }

    // Domain B: local control-plane handlers (tenant lifecycle, user management)
    // — real implementations of what the repo only stubs. Dispatched directly,
    // not via the /repo action loader.
    if (route.localHandler) {
      const fn = LOCAL_HANDLERS[route.localHandler];
      if (typeof fn !== 'function') return sendJson(res, 500, { code: 'NO_HANDLER', message: `local handler ${route.localHandler} missing` });
      const ctx = { params: matched.params, query, body, identity, pool, callerContext: identity ? callerContextFrom(identity, correlationId) : null, req, res, cors: CORS };
      // Streaming routes (e.g. SSE consume) own the response: the handler writes
      // to `res` directly and ends it; we don't sendJson() after.
      if (route.stream) { await fn(ctx, res); return; }
      const result = await fn(ctx);
      return sendJson(res, result?.statusCode ?? 200, result?.body ?? null);
    }

    // Inject the TRUSTED identity headers derived from the verified JWT, having
    // first dropped any client-supplied x-* identity header (anti-spoofing).
    const owHeaders = { ...headers };
    for (const k of Object.keys(owHeaders)) {
      if (k === 'x-tenant-id' || k === 'x-workspace-id' || k === 'x-auth-subject' || k.startsWith('x-actor-')) delete owHeaders[k];
    }
    if (identity) Object.assign(owHeaders, identity.trustedHeaders);

    const params = {
      __ow_headers: owHeaders, __ow_path: path, __ow_method: method,
      method, path, query, body,
      ...(route.defaults ?? {}),
      ...(route.mergeQueryIntoParams ? query : {}),
      ...(route.mergeBodyIntoParams && body && typeof body === 'object' ? body : {}),
      ...matched.params
    };
    const callerContext = identity ? callerContextFrom(identity, correlationId) : null;

    const handler = await loadHandler(route);
    // Give transactional actions a dedicated connection (a Pool spreads
    // BEGIN/INSERT/COMMIT across connections -> writes silently roll back).
    let client = null, result;
    try {
      if (routeNeedsDb(route)) client = await pool.connect();
      result = await invokeRoute(route, handler, params, callerContext, identity, client ?? pool);
    } finally {
      if (client) client.release();
    }
    const respHeaders = {};
    for (const [k, v] of Object.entries(result?.headers ?? {})) {
      if (v == null) continue;
      const lk = k.toLowerCase();
      if (lk === 'content-type' || lk === 'content-length') continue;
      respHeaders[k] = String(v);
    }
    sendJson(res, result?.statusCode ?? 200, result?.body ?? null, respHeaders);
  } catch (err) {
    // Log the full error (incl. stack) server-side only; never echo an exception's
    // message/stack to the client (stack-trace exposure). Return the stable code.
    console.error('[control-plane] request failed:', err);
    const statusCode = err?.statusCode ?? (err?.code === 'FORBIDDEN' ? 403 : 500);
    const code = err?.code ?? 'CONTROL_PLANE_ERROR';
    sendJson(res, statusCode, { code, message: statusCode >= 500 ? 'Internal server error' : code });
  }
});

loadRoutes();
// Domain B needs the `tenants` registry + saga tables (no in-repo migration
// creates them). After the schema is ready, sweep any saga left 'running' by a
// prior crash and run its durable compensations (rollback survives a restart).
ensureSchema(pool)
  .then(() => ensureSagaSchema(pool))
  .then(() => recoverSagas(pool))
  .then((n) => console.log(`[control-plane] schema ready; recovered ${n} orphaned saga(s)`))
  .catch((e) => console.error('[control-plane] schema/recovery failed:', e.message));
if (ROUTE_MAP_FILE) {
  readFile(ROUTE_MAP_FILE, 'utf8').then((txt) => {
    try { const extra = JSON.parse(txt); loadRoutes(Array.isArray(extra) ? extra : []); console.log(`[control-plane] loaded ${ROUTES.length} routes (seed + ${ROUTE_MAP_FILE})`); }
    catch (e) { console.error('[control-plane] route map parse failed:', e.message); }
  }).catch(() => {});
}
server.listen(PORT, () => console.log(`[control-plane] listening on :${PORT}; routes=${ROUTES.length}; jwks=${JWKS_URL}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => pool.end().finally(() => process.exit(0))));
