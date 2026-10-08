// Source-only HTTP harness (#958). Run the unmodified server dispatch and selected
// real local handlers, omitting process bootstrap. Only DB and JWKS I/O are faked.
import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';
import { routes } from '../../../apps/control-plane/routes.mjs';
import * as store from '../../../apps/control-plane/tenant-store.mjs';
import * as audit from '../../../apps/control-plane/audit-writer.mjs';
import * as metrics from '../../../apps/control-plane/metrics-registry.mjs';
import * as requestBody from '../../../apps/control-plane/request-body.mjs';
import * as knative from '../../../apps/control-plane/knative-runtime-handlers.mjs';
import * as sa from '../../../apps/control-plane/sa-revocation.mjs';
import { createRuntimeCleanupRepository } from '../../../apps/control-plane/runtime-cleanup-repository.mjs';
import { createMultiRealmVerifier } from '../../../apps/control-plane/jwt-verify.mjs';

export const TEN_A = '11111111-1111-1111-1111-111111111111';
export const TEN_B = '22222222-2222-2222-2222-222222222222';
export const WS_B = '44444444-4444-4444-4444-444444444444';
const serverSource = await readFile(new URL('../../../apps/control-plane/server.mjs', import.meta.url), 'utf8');
const localSource = await readFile(new URL('../../../apps/control-plane/b-handlers.mjs', import.meta.url), 'utf8');
const runtimeRoutes = JSON.parse(await readFile(new URL('../../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));

function declaration(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  if (start < 0) throw Error(`missing handler ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

export async function startDenialServer({ insert = null, extraRoutes = [] } = {}) {
  const rows = [];
  const warnings = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes('INSERT INTO scope_enforcement_denials')) {
        if (insert) await insert();
        const columns = sql.match(/INSERT INTO scope_enforcement_denials\s*\(([^)]+)\)/)[1]
          .split(',').map((column) => column.trim());
        const row = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
        rows.push(row);
        return { rows: [row] };
      }
      if (sql.includes('FROM tenants')) return { rows: [ { id: values[0], iam_realm: values[0] } ] };
      if (sql.includes('FROM workspaces')) return { rows: [{ id: WS_B, tenant_id: TEN_B }] };
      if (sql.includes('FROM scope_enforcement_denials')) {
        let found = rows;
        for (const column of ['tenant_id', 'denial_type', 'actor_id']) {
          const match = sql.match(new RegExp(`${column} = \\$(\\d+)`));
          if (match) found = found.filter((row) => row[column] === values[Number(match[1]) - 1]);
        }
        return { rows: sql.includes('COUNT(*)') ? [{ total: found.length }] : found };
      }
      throw Error(`unexpected database operation: ${sql}`);
    },
    async connect() { return { query: pool.query, release() {} }; }
  };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'audit-fixture', alg: 'RS256' };
  const jwtVerifier = createMultiRealmVerifier({
    jwksUrl: 'http://fixture/realms/platform/protocol/openid-connect/certs',
    fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [key] }) })
  });
  const token = (claims = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: `http://fixture/realms/${TEN_A}`, sub: 'actor-alpha', azp: 'sa-alpha',
      exp: Math.floor(Date.now() / 1000) + 300, realm_access: { roles: [] }, ...claims
    })).toString('base64url');
    const content = `${header}.${payload}`;
    return `${content}.${sign('sha256', Buffer.from(content), privateKey).toString('base64url')}`;
  };
  const localNames = ['getTenant', 'listTenantUsers', 'getWorkspace', 'listServiceAccountsHandler'];
  const locals = new Function('store', [
    localSource.match(/^const ok = .*$/m)[0], localSource.match(/^const err = .*$/m)[0],
    ...['tenantOut', 'workspaceOut', 'canManageTenant', 'canManageTenantId',
      'resolveWorkspaceForManage', ...localNames].map((name) => declaration(localSource, name)),
    `return { getTenant, listTenantUsers, getWorkspace, listServiceAccounts: listServiceAccountsHandler };`
  ].join('\n'))(store);
  const remap = (route) => ({ ...route,
    ...(route.module ? { module: fileURLToPath(new URL(`../../../${route.module.replace('/repo/', '')}`, import.meta.url)) } : {})
  });
  const bindings = {
    http, pool, jwtVerifier, PORT: 0,
    seedRoutes: [...routes, ...extraRoutes].map(remap),
    LOCAL_HANDLERS: locals,
    console: { error() {}, warn: (line) => warnings.push(line) },
    webhookRuntimePool: null, webhookWritePool: null, knativeRuntime: null, runtimeTeardownCoordinator: null,
    createRuntimeCleanupRepository,
    ...audit, ...metrics, ...requestBody, ...knative, ...sa
  };
  // The full route table, helpers, verified identity, invocation and HTTP handler
  // are evaluated together. No dispatch or authorization function is replaced.
  const core = serverSource.slice(serverSource.indexOf('// ---- route table'),
    serverSource.indexOf('export async function bootstrapControlPlane'));
  bindings.runtimeRoutes = runtimeRoutes.map(remap);
  const server = new Function(...Object.keys(bindings), `${core}\nloadRoutes(runtimeRoutes); return server;`)(...Object.values(bindings));
  return {
    token, pool, warnings,
    async request(path, { correlationId = 'corr-fixture', bearer = token(), method = 'GET', body = null } = {}) {
      // Synthetic HTTP streams allow the same request boundary in sandboxes that
      // disallow listening sockets. The actual http.Server request listener runs.
      const req = Readable.from(body ? [Buffer.from(body)] : []);
      Object.assign(req, { method, url: path, headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        'x-correlation-id': correlationId, 'content-type': 'application/json'
      } });
      const chunks = [];
      const res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); } });
      res.writeHead = (status, headers) => {
        res.statusCode = status;
        res.headers = new Headers(headers);
      };
      const finished = new Promise((resolve) => res.on('finish', resolve));
      server.emit('request', req, res);
      await finished;
      return { status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers };
    },
    close: () => Promise.resolve()
  };
}
