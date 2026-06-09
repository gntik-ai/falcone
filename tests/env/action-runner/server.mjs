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

function sendJson(res, statusCode, body) {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
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
      // Path params from named capture groups (e.g. :id) — none for the broad
      // scheduling route (the action splits the path itself), but kept generic.
      ...matched.params,
      // Real Postgres client injected by the shim (NOT env-driven inside action).
      pg: pool,
      // Audit publishing is optional and intentionally omitted (no kafka here):
      // the action skips events when params.publishAudit is absent.
    };

    const handler = await loadHandler(matched.route);
    const result = await handler(params);
    const statusCode = result?.statusCode ?? 200;
    const respBody = result?.body ?? null;
    sendJson(res, statusCode, respBody);
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
