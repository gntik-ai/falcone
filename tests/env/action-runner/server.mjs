// Action-runner shim (TEST ONLY).
//
// A tiny node:http server that adapts a real HTTP request into the params shape
// the Falcone "action" handlers expect (OpenWhisk-style: a single `params`
// object in, `{ statusCode, body }` out), injects a real pg Pool at
// `params.pg`, dynamically imports the PRODUCT action module from the
// bind-mounted repo, calls its handler, and writes the result back as HTTP.
//
// It deliberately imports the action AS-IS from /repo/services/... so the slice
// exercises the genuine request chain, not a copy.

import http from 'node:http';
import { URL } from 'node:url';
import pg from 'pg';
import { matchRoute } from './routes.mjs';

const { Pool } = pg;

const PORT = Number(process.env.PORT ?? 8090);
const DB_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'postgres'
  }:${process.env.PGPORT ?? '5432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

// One shared Pool for the whole shim, injected into every action call.
const pool = new Pool({ connectionString: DB_URL, max: 8 });

// Cache imported action modules so we import each once.
const moduleCache = new Map();
async function loadHandler(route) {
  if (!moduleCache.has(route.module)) {
    moduleCache.set(route.module, import(route.module));
  }
  const mod = await moduleCache.get(route.module);
  const handler = route.exportName === 'default' ? mod.default : mod[route.exportName];
  if (typeof handler !== 'function') {
    throw new Error(`Module ${route.module} has no callable export "${route.exportName}"`);
  }
  return handler;
}

function lowercaseHeaders(rawHeaders) {
  // node already lowercases header names on req.headers; normalize array values
  // (e.g. multiple Set-Cookie) to a single comma-joined string the actions expect.
  const out = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

// Build the dependency-injection `overrides` object a `params-overrides` action
// expects, from the route's declared `deps`. Today only `db` is supported (the
// shared pg Pool, whose `.query()` interface the async-operation repos use).
function buildOverrides(route, pool) {
  const overrides = {};
  for (const dep of route.deps ?? []) {
    if (dep === 'db') {
      overrides.db = pool;
    } else {
      throw new Error(`Route ${route.name} declares unknown dep "${dep}"`);
    }
  }
  return overrides;
}

// Build params.callerContext from the gateway-injected identity headers, the way
// a real Falcone HTTP handler would before dispatching to a plan/quota action.
//
// The plan/quota actions (plan-list, plan-create, quota-dimension-catalog-list,
// ...) read params.callerContext.actor DIRECTLY (they do NOT call
// buildCallerContext off __ow_headers like the async-operation actions). So the
// trusted adapter — here, this shim, mirroring the real handler — is responsible
// for deriving callerContext from the TRUSTED headers APISIX injected from the
// verified JWT (x-auth-subject / x-tenant-id / x-actor-type), having first
// STRIPPED any client-supplied x-* identity headers. We OVERWRITE any
// client-supplied params.callerContext so the body can never spoof identity.
//
// actor.type is taken verbatim from x-actor-type. Note the plan/quota actions
// compare against 'superadmin' and 'tenant-owner' (hyphen); 'superadmin' is the
// one value identical across the async-operation underscore convention, so the
// slice's superadmin user satisfies both contracts.
function buildCallerContextFromHeaders(headers = {}) {
  const subject = headers['x-auth-subject'];
  const tenantId = headers['x-tenant-id'];
  const actorType = headers['x-actor-type'];
  if (!subject) return null;
  return {
    actor: {
      id: subject,
      type: actorType ?? '',
      // plan/quota tenant-scoped checks read actor.tenantId; mirror tenantId.
      tenantId: tenantId ?? null
    },
    tenantId: tenantId ?? null,
    correlationId: headers['x-correlation-id'] ?? null
  };
}

// Invoke a matched action the way its route declares. Returns the action's
// `{ statusCode, headers?, body }` result unchanged.
async function invokeRoute({ route, handler, params, pool }) {
  switch (route.invoke ?? 'params-pg') {
    case 'params-pg':
      // handler(params) with a real pg Pool injected at params.pg.
      return handler({ ...params, pg: pool });
    case 'params-only':
      // handler(params) — pure, no injected deps (e.g. a header-only GET).
      return handler(params);
    case 'params-overrides':
      // handler(params, overrides) — deps go in the second argument.
      return handler(params, buildOverrides(route, pool));
    case 'params-callercontext-overrides': {
      // handler(params, overrides) where the action reads params.callerContext
      // (built here from the TRUSTED gateway headers, overwriting any
      // client-supplied value) AND deps from overrides (overrides.db = Pool).
      // Used by the provisioning-orchestrator plan/quota actions.
      const callerContext = buildCallerContextFromHeaders(params.__ow_headers);
      if (!callerContext) {
        const err = new Error('callerContext could not be established from gateway headers');
        err.statusCode = 401;
        throw err;
      }
      return handler({ ...params, callerContext }, buildOverrides(route, pool));
    }
    default:
      throw new Error(`Route ${route.name} declares unknown invoke style "${route.invoke}"`);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const path = parsed.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // Liveness/readiness: cheap DB ping so the orchestrator only marks healthy
    // once Postgres is actually reachable from the shim.
    if (path === '/healthz') {
      try {
        await pool.query('SELECT 1');
        sendJson(res, 200, { status: 'ok' });
      } catch (err) {
        sendJson(res, 503, { status: 'db_unavailable', error: String(err.message ?? err) });
      }
      return;
    }

    const matched = matchRoute(method, path);
    if (!matched) {
      sendJson(res, 404, { code: 'NO_ROUTE', message: `No action mapped for ${method} ${path}` });
      return;
    }

    const query = Object.fromEntries(parsed.searchParams.entries());
    const rawBody = await readBody(req);
    let body = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        sendJson(res, 400, { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' });
        return;
      }
    }

    const headers = lowercaseHeaders(req.headers);
    const route = matched.route;

    const params = {
      // OpenWhisk-style fields the actions read.
      __ow_headers: headers,
      __ow_path: path,
      __ow_method: method,
      // Plain mirrors the scheduling action reads directly.
      method,
      path,
      query,
      body,
      // Route defaults (e.g. queryType for the async-operation query action).
      // Applied first so explicit query/body values below can override them.
      ...(route.defaults ?? {}),
      // OpenWhisk web actions flatten the query string and JSON body into the
      // top-level params. The scheduling action reads params.query/params.body
      // instead, so its route leaves these flags off; the async-operation
      // actions read flat fields, so their routes opt in to mirror OpenWhisk.
      ...(route.mergeQueryIntoParams ? query : {}),
      ...(route.mergeBodyIntoParams && body && typeof body === 'object' ? body : {}),
      // Path params from named capture groups (e.g. :operationId). For the broad
      // scheduling route the action splits the path itself; for the async-op
      // detail route this supplies params.operationId.
      ...matched.params,
      // Audit publishing is optional and intentionally omitted (no kafka here):
      // the action skips events when its producer dependency is absent.
    };

    const handler = await loadHandler(route);
    const result = await invokeRoute({ route, handler, params, pool });
    const statusCode = result?.statusCode ?? 200;
    const respBody = result?.body ?? null;
    // Propagate action-set response headers (e.g. X-Correlation-Id) but never
    // let the action override content-type/length sendJson computes.
    const respHeaders = {};
    for (const [k, v] of Object.entries(result?.headers ?? {})) {
      if (v == null) continue;
      const lk = k.toLowerCase();
      if (lk === 'content-type' || lk === 'content-length') continue;
      respHeaders[k] = String(v);
    }
    sendJson(res, statusCode, respBody, respHeaders);
  } catch (err) {
    const statusCode = err?.statusCode ?? 500;
    sendJson(res, statusCode, { code: 'SHIM_ERROR', message: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[action-runner] listening on :${PORT} (DB ${DB_URL.replace(/:[^:@/]*@/, ':****@')})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
}
