// Control-plane HTTP service (changes: add-control-plane-executor, add-postgres-ddl-execute,
// add-postgres-data-crud-execute).
//
// The real, runnable control-plane the gateway routes /v1/* to. It trusts the identity
// headers APISIX injects from the verified credential (x-tenant-id / x-workspace-id /
// x-auth-subject / x-actor-roles), matches the request against a small route table, and
// runs it through the executors (which build adapter plans and execute them against the
// workspace database). Wires the Postgres data-row family (CRUD + bulk) and the Postgres
// DDL family (schema/table/column/index); other OpenAPI families plug into the same table.
import http from 'node:http';
import { executePostgresData } from './postgres-data-executor.mjs';
import { executePostgresDdl } from './postgres-ddl-executor.mjs';

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
    roleName: headers['x-pg-role'] || 'falcone_app',
  };
}

function primaryKeyFromQuery(searchParams) {
  const pk = {};
  for (const [k, v] of searchParams.entries()) if (!META_QUERY_KEYS.has(k)) pk[k] = v;
  return Object.keys(pk).length > 0 ? pk : undefined;
}

function pageFromQuery(searchParams) {
  const size = searchParams.get('page[size]');
  const after = searchParams.get('page[after]');
  if (size == null && after == null) return undefined;
  return { size: size != null ? Number(size) : undefined, after: after ?? undefined };
}

// Route table: [method, RegExp(pathname) with capture groups, handler(groups, {url, identity, body, registry})].
// Data routes are workspace/data-scoped; DDL routes are database-scoped (workspace via header).
function buildRoutes(registry) {
  const data = '^/v1/postgres/workspaces/([^/]+)/data/([^/]+)/schemas/([^/]+)/tables/([^/]+)';
  const ddl = '^/v1/postgres/databases/([^/]+)/schemas';
  return [
    ['GET', /^\/(healthz|readyz)$/, () => ({ status: 200, body: { status: 'ok' } }), { noAuth: true }],

    // ---- Postgres data rows (CRUD + bulk) ----
    ['GET', new RegExp(`${data}/rows$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'list', page: pageFromQuery(c.url.searchParams), countMode: c.url.searchParams.get('countMode') ?? undefined }, 200)],
    ['POST', new RegExp(`${data}/rows$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'insert', values: c.body.values ?? c.body }, 201)],
    ['POST', new RegExp(`${data}/rows/bulk/insert$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'bulk_insert', rows: c.body.rows ?? c.body.items }, 201)],
    ['GET', new RegExp(`${data}/rows/by-primary-key$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'get', primaryKey: primaryKeyFromQuery(c.url.searchParams) }, 200)],
    ['PATCH', new RegExp(`${data}/rows/by-primary-key$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'update', primaryKey: primaryKeyFromQuery(c.url.searchParams), changes: c.body.changes ?? c.body }, 200)],
    ['DELETE', new RegExp(`${data}/rows/by-primary-key$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'delete', primaryKey: primaryKeyFromQuery(c.url.searchParams) }, 200)],

    // ---- Postgres DDL (schema/table/column/index) ----
    ['POST', new RegExp(`${ddl}$`), ([db], c) =>
      runDdl(registry, 'schema', { databaseName: db, schemaName: c.body.schemaName ?? c.body.name }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables$`), ([db, s], c) =>
      runDdl(registry, 'table', { databaseName: db, schemaName: s, ...c.body }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/columns$`), ([db, s, t], c) =>
      runDdl(registry, 'column', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/indexes$`), ([db, s, t], c) =>
      runDdl(registry, 'index', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],
  ];
}

async function run(registry, fn, params, successStatus) {
  const result = await fn(registry, params);
  return { status: successStatus, body: result };
}

async function runDdl(registry, resourceKind, payload, c) {
  const result = await executePostgresDdl(registry, {
    resourceKind, action: 'create', payload, identity: c.identity,
    executionMode: c.url.searchParams.get('mode') === 'preview' || payload.dryRun ? 'preview' : 'execute',
  });
  return { status: result.executed === false ? 200 : 201, body: result };
}

export function createControlPlaneServer({ registry, logger = console } = {}) {
  if (!registry) throw new TypeError('createControlPlaneServer requires a connection registry');
  const routes = buildRoutes(registry);

  return http.createServer(async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const url = new URL(req.url, 'http://control-plane.local');

      const match = routes.find(([m, re]) => m === method && re.test(url.pathname));
      if (!match) return sendJson(res, 404, { code: 'NO_ROUTE', message: `No route for ${method} ${url.pathname}` });
      const [, re, handler, opts] = match;
      const groups = re.exec(url.pathname).slice(1);

      const identity = identityFromHeaders(req.headers, groups[0]);
      if (!opts?.noAuth && !identity.tenantId) {
        return sendJson(res, 401, { code: 'UNAUTHENTICATED', message: 'Missing tenant identity' });
      }
      const body = method === 'GET' || method === 'DELETE' ? {} : await readJsonBody(req);

      const { status, body: out } = await handler(groups, { url, identity, body, registry });
      return sendJson(res, status, out);
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
