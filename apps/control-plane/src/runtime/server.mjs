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
import https from 'node:https';
import { executePostgresData } from './postgres-data-executor.mjs';
import { executePostgresDdl } from './postgres-ddl-executor.mjs';

const META_QUERY_KEYS = new Set(['select', 'order', 'page[size]', 'page[after]', 'countMode']);

function sendJson(res, statusCode, body) {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

// Reverse-proxy a request the executor does not itself serve to the control-plane upstream.
// The executor only handles the data-plane + DDL slice; every other path under the data
// prefixes (browse/inventory/management) is served by the legacy control-plane. The request
// stream is piped through untouched (method/path/query/headers/body) and the upstream response
// is streamed back, so this never buffers the body.
//
// SSRF-safe by construction: protocol/host/port are pinned to the operator-configured
// `upstream` (a URL parsed at startup); ONLY the path+query are taken from the request. A
// hostile request-target (absolute- or protocol-relative form, e.g. `//169.254.169.254/…`)
// therefore cannot redirect the proxy off the configured control-plane host.
const PROXY_TIMEOUT_MS = 30000;
function proxyRequest(req, res, upstream, logger) {
  const incoming = new URL(req.url, 'http://upstream.invalid');
  const client = upstream.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: upstream.host };
  delete headers.connection;
  const upstreamReq = client.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: `${incoming.pathname}${incoming.search}`,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.setTimeout(PROXY_TIMEOUT_MS, () => upstreamReq.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEDOUT' })));
  upstreamReq.on('error', (err) => {
    logger.error?.('[control-plane] upstream proxy failed:', err);
    if (!res.headersSent) sendJson(res, 502, { code: 'UPSTREAM_UNAVAILABLE', message: 'Control-plane upstream unavailable' });
    else res.destroy();
  });
  req.pipe(upstreamReq);
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

// Extract a presented API key from the request headers (Supabase-style):
//   Authorization: ApiKey flc_... | Authorization: Bearer flc_... | apikey: flc_... | x-api-key: flc_...
function apiKeyFromHeaders(headers) {
  const auth = headers['authorization'];
  if (auth) {
    const m = /^(?:ApiKey|Bearer)\s+(flc_\S+)$/i.exec(auth);
    if (m) return m[1];
  }
  const direct = headers['apikey'] || headers['x-api-key'];
  return typeof direct === 'string' && direct.startsWith('flc_') ? direct : undefined;
}

// Resolve identity. A presented API key is AUTHORITATIVE: its tenant/workspace come from
// the verified key, never from request headers — otherwise a caller on the no-JWT api-key
// gateway route could send `apikey: flc_…` together with a spoofed `x-tenant-id: victim`
// and the executor would trust the header (cross-tenant access). An invalid key fails closed
// (no fallback to spoofable headers). Only when NO key is presented do we trust the
// gateway-injected JWT identity headers (the gateway strips client-supplied context headers
// and sets them from verified JWT claims).
async function resolveIdentity(headers, pathWorkspaceId, apiKeyStore) {
  const key = apiKeyFromHeaders(headers);
  if (key) {
    const resolved = apiKeyStore ? await apiKeyStore.verifyKey(key) : undefined;
    if (resolved) {
      return {
        tenantId: resolved.tenantId,
        workspaceId: resolved.workspaceId,
        actorId: `apikey:${resolved.keyType}`,
        roleName: resolved.roleName,
        dbRole: resolved.dbRole, // assumed via SET LOCAL ROLE → RLS enforced for anon keys
        scopes: resolved.scopes,
      };
    }
    return { tenantId: undefined }; // key presented but invalid/unverifiable → 401, fail closed
  }
  return identityFromHeaders(headers, pathWorkspaceId); // no key → trust gateway JWT headers
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
function buildRoutes(registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor) {
  const data = '^/v1/postgres/workspaces/([^/]+)/data/([^/]+)/schemas/([^/]+)/tables/([^/]+)';
  const ddl = '^/v1/postgres/databases/([^/]+)/schemas';
  const keys = '^/v1/workspaces/([^/]+)/api-keys';
  const mdoc = '^/v1/mongo/workspaces/([^/]+)/data/([^/]+)/collections/([^/]+)/documents';
  const evt = '^/v1/events/workspaces/([^/]+)/topics';
  const fn = '^/v1/functions/workspaces/([^/]+)/actions';
  return [
    ['GET', /^\/(healthz|readyz)$/, () => ({ status: 200, body: { status: 'ok' } }), { noAuth: true }],

    // ---- Workspace API keys (issue/list/rotate/revoke) — admin (JWT) identity ----
    ['POST', new RegExp(`${keys}$`), ([w], c) =>
      requireStore(apiKeyStore).issueKey({ tenantId: c.identity.tenantId, workspaceId: w, keyType: c.body.keyType, scopes: c.body.scopes }).then((r) => ({ status: 201, body: r }))],
    ['GET', new RegExp(`${keys}$`), ([w]) =>
      requireStore(apiKeyStore).listKeys(w).then((items) => ({ status: 200, body: { items } }))],
    ['POST', new RegExp(`${keys}/([^/]+)/rotations$`), ([w, id], c) =>
      requireStore(apiKeyStore).rotateKey({ id, workspaceId: w }).then((r) => ({ status: 201, body: r }))],
    ['DELETE', new RegExp(`${keys}/([^/]+)$`), ([w, id]) =>
      requireStore(apiKeyStore).revokeKey({ id, workspaceId: w }).then((r) => ({ status: 200, body: r }))],

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
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/policies$`), ([db, s, t], c) =>
      runDdl(registry, 'policy', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/security$`), ([db, s, t], c) =>
      runDdl(registry, 'table_security', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],

    // ---- MongoDB documents (CRUD) ----
    ['GET', new RegExp(`${mdoc}$`), ([w, db, coll], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'list', filter: c.body.filter, page: { size: c.url.searchParams.get('page[size]') ?? undefined } }, 200)],
    ['POST', new RegExp(`${mdoc}$`), ([w, db, coll], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'insert', payload: { document: c.body.document ?? c.body } }, 201)],
    ['GET', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'get', documentId: id }, 200)],
    ['PATCH', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'update', documentId: id, payload: { update: c.body.update ?? c.body } }, 200)],
    ['PUT', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'replace', documentId: id, payload: { document: c.body.document ?? c.body } }, 200)],
    ['DELETE', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'delete', documentId: id }, 200)],

    // ---- Events (Kafka): topics + publish + consume (workspace-scoped) ----
    ['GET', new RegExp(`${evt}$`), ([w], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'list_topics' }, 200)],
    ['POST', new RegExp(`${evt}$`), ([w], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'create_topic', topic: c.body.topic, payload: c.body }, 201)],
    ['POST', new RegExp(`${evt}/([^/]+)/publish$`), ([w, topic], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'publish', topic, payload: c.body }, 202)],
    ['GET', new RegExp(`${evt}/([^/]+)/messages$`), ([w, topic], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'consume', topic, payload: { maxMessages: Number(c.url.searchParams.get('maxMessages') ?? 10), timeoutMs: Number(c.url.searchParams.get('timeoutMs') ?? 3000) } }, 200)],

    // ---- Functions: deploy / list / get / invoke / activations (workspace-scoped) ----
    ['GET', new RegExp(`${fn}$`), ([w], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'list' }, 200)],
    ['POST', new RegExp(`${fn}$`), ([w], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'deploy', name: c.body.name, payload: c.body }, 201)],
    ['GET', new RegExp(`${fn}/([^/]+)$`), ([w, name], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'get', name }, 200)],
    ['POST', new RegExp(`${fn}/([^/]+)/invocations$`), ([w, name], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'invoke', name, payload: c.body }, 200)],
    ['GET', new RegExp(`${fn}/([^/]+)/activations$`), ([w, name], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'activations', name }, 200)],
  ];
}

async function runFunctions(functionsExecutor, params, successStatus) {
  if (!functionsExecutor) throw Object.assign(new Error('Functions are not enabled'), { statusCode: 501, code: 'FUNCTIONS_DISABLED' });
  const result = await functionsExecutor.executeFunctions(params);
  return { status: successStatus, body: result };
}

async function runMongo(mongoExecutor, params, successStatus) {
  if (!mongoExecutor) throw Object.assign(new Error('MongoDB is not enabled'), { statusCode: 501, code: 'MONGO_DISABLED' });
  const result = await mongoExecutor.executeMongoData(params);
  return { status: successStatus, body: result };
}

async function runEvents(eventsExecutor, params, successStatus) {
  if (!eventsExecutor) throw Object.assign(new Error('Events are not enabled'), { statusCode: 501, code: 'EVENTS_DISABLED' });
  const result = await eventsExecutor.executeEvents(params);
  return { status: successStatus, body: result };
}

function requireStore(apiKeyStore) {
  if (!apiKeyStore) throw Object.assign(new Error('API keys are not enabled'), { statusCode: 501, code: 'API_KEYS_DISABLED' });
  return apiKeyStore;
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

export function createControlPlaneServer({ registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor, controlPlaneUpstream, logger = console } = {}) {
  if (!registry) throw new TypeError('createControlPlaneServer requires a connection registry');
  // Parse + validate the upstream at startup (fail-fast). Host/port are fixed here so the
  // per-request proxy can never be steered to a different host (SSRF).
  const upstream = controlPlaneUpstream ? new URL(controlPlaneUpstream) : undefined;
  const routes = buildRoutes(registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor);

  return http.createServer(async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const url = new URL(req.url, 'http://control-plane.local');

      const match = routes.find(([m, re]) => m === method && re.test(url.pathname));
      if (!match) {
        // Not part of the executor's data-plane/DDL slice → fall through to the control-plane
        // (browse/inventory/management routes under the same prefixes) when an upstream is set.
        if (upstream) return proxyRequest(req, res, upstream, logger);
        return sendJson(res, 404, { code: 'NO_ROUTE', message: `No route for ${method} ${url.pathname}` });
      }
      const [, re, handler, opts] = match;
      const groups = re.exec(url.pathname).slice(1);

      const identity = await resolveIdentity(req.headers, groups[0], apiKeyStore);
      if (!opts?.noAuth && !identity.tenantId) {
        return sendJson(res, 401, { code: 'UNAUTHENTICATED', message: 'Missing tenant identity' });
      }
      // Key management must not be performed with an anon/service API key — admin (JWT) only.
      const isKeyMgmt = url.pathname.includes('/api-keys');
      if (isKeyMgmt && identity.dbRole) {
        return sendJson(res, 403, { code: 'FORBIDDEN', message: 'API keys cannot manage API keys' });
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
