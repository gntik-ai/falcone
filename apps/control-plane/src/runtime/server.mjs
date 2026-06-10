// Control-plane HTTP service (change: add-control-plane-executor).
//
// The real, runnable control-plane that the gateway routes /v1/* to (replacing the
// placeholder image). It trusts the identity headers APISIX injects from the verified
// credential (x-tenant-id / x-workspace-id / x-auth-subject / x-actor-roles), maps the
// request to a data-API operation, and runs it through the executor (which builds the
// adapter plan and executes it against the workspace database). This first cut wires the
// Postgres data-row family end-to-end; other families plug into the same dispatch.
import http from 'node:http';
import { executePostgresData } from './postgres-data-executor.mjs';

// /v1/postgres/workspaces/{wid}/data/{db}/schemas/{schema}/tables/{table}/rows[/by-primary-key]
const ROWS_RE =
  /^\/v1\/postgres\/workspaces\/([^/]+)\/data\/([^/]+)\/schemas\/([^/]+)\/tables\/([^/]+)\/rows(\/by-primary-key)?$/;

const META_QUERY_KEYS = new Set(['select', 'order', 'page[size]', 'page[after]', 'countMode']);

function sendJson(res, statusCode, body) {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Body is not valid JSON'), { statusCode: 400, code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

function identityFromHeaders(headers, pathWorkspaceId) {
  return {
    tenantId: headers['x-tenant-id'],
    workspaceId: headers['x-workspace-id'] || pathWorkspaceId,
    actorId: headers['x-auth-subject'],
    // The gateway injects Keycloak roles; the DB application role is selected here
    // (anon vs service maps to a DB role in the add-app-api-keys change).
    roleName: headers['x-pg-role'] || 'falcone_app',
  };
}

function primaryKeyFromQuery(searchParams) {
  const pk = {};
  for (const [k, v] of searchParams.entries()) {
    if (!META_QUERY_KEYS.has(k)) pk[k] = v;
  }
  return Object.keys(pk).length > 0 ? pk : undefined;
}

function pageFromQuery(searchParams) {
  const size = searchParams.get('page[size]');
  const after = searchParams.get('page[after]');
  if (size == null && after == null) return undefined;
  return { size: size != null ? Number(size) : undefined, after: after ?? undefined };
}

export function createControlPlaneServer({ registry, logger = console } = {}) {
  if (!registry) throw new TypeError('createControlPlaneServer requires a connection registry');

  return http.createServer(async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const url = new URL(req.url, 'http://control-plane.local');

      if (method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
        return sendJson(res, 200, { status: 'ok' });
      }

      const m = ROWS_RE.exec(url.pathname);
      if (!m) return sendJson(res, 404, { code: 'NO_ROUTE', message: `No route for ${method} ${url.pathname}` });

      const [, workspaceId, databaseName, schemaName, tableName, byPk] = m;
      const identity = identityFromHeaders(req.headers, workspaceId);
      if (!identity.tenantId) return sendJson(res, 401, { code: 'UNAUTHENTICATED', message: 'Missing tenant identity' });

      const body = method === 'GET' || method === 'DELETE' ? {} : await readJsonBody(req);
      const base = { workspaceId, databaseName, schemaName, tableName, identity };

      let params;
      let successStatus = 200;
      if (!byPk && method === 'GET') {
        params = { ...base, operation: 'list', filters: body.filters, order: url.searchParams.get('order') ?? undefined, page: pageFromQuery(url.searchParams), countMode: url.searchParams.get('countMode') ?? undefined };
      } else if (!byPk && method === 'POST') {
        params = { ...base, operation: 'insert', values: body.values ?? body };
        successStatus = 201;
      } else if (byPk && method === 'GET') {
        params = { ...base, operation: 'get', primaryKey: primaryKeyFromQuery(url.searchParams) };
      } else if (byPk && method === 'PATCH') {
        params = { ...base, operation: 'update', primaryKey: primaryKeyFromQuery(url.searchParams), changes: body.changes ?? body };
      } else if (byPk && method === 'DELETE') {
        params = { ...base, operation: 'delete', primaryKey: primaryKeyFromQuery(url.searchParams) };
      } else {
        return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: `${method} not allowed on ${url.pathname}` });
      }

      const result = await executePostgresData(registry, params);
      return sendJson(res, successStatus, result);
    } catch (err) {
      const statusCode = err.statusCode ?? 500;
      if (statusCode >= 500) logger.error?.('[control-plane] request failed:', err);
      return sendJson(res, statusCode, {
        code: err.code ?? 'CONTROL_PLANE_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : err.message,
      });
    }
  });
}
