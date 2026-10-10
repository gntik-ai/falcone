// Source-only HTTP harness for #982: real routing, authentication and request listener,
// without process bootstrap (database migrations need a running PostgreSQL instance).
// Only DB and JWKS I/O are faked. Response streams exercise the real finish hook.
import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
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
import { createJwtVerifier } from '../../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';
import { secretBackendHealth } from '../../../apps/control-plane/fn-handlers.mjs';
import { respondHealth } from '../../../apps/control-plane/health-response.mjs';

const serverSource = await readFile(new URL('../../../apps/control-plane/server.mjs', import.meta.url), 'utf8');
const localSource = await readFile(new URL('../../../apps/control-plane/b-handlers.mjs', import.meta.url), 'utf8');
const runtimeRoutes = JSON.parse(await readFile(new URL('../../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));
export const TENANT = '11111111-1111-1111-1111-111111111111';

function declaration(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  if (start < 0) throw Error(`missing handler ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

export async function startMetricsServer() {
  const pool = {
    async query(sql, values = []) {
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM tenants')) return { rows: [{ id: values[0], iam_realm: values[0] }] };
      if (sql.includes('INSERT INTO scope_enforcement_denials')) return { rows: [] };
      throw Error(`unexpected database operation: ${sql}`);
    },
  };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'metrics-fixture', alg: 'RS256' };
  const verifierOptions = {
    jwksUrl: 'http://fixture/realms/platform/protocol/openid-connect/certs',
    fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [key] }) }),
  };
  const jwtVerifier = createMultiRealmVerifier(verifierOptions);
  const token = (claims = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: `http://fixture/realms/${TENANT}`, sub: 'metrics-actor', azp: 'console-ui',
      exp: Math.floor(Date.now() / 1000) + 300, realm_access: { roles: ['tenant_owner'] }, ...claims,
    })).toString('base64url');
    const content = `${header}.${payload}`;
    return `${content}.${sign('sha256', Buffer.from(content), privateKey).toString('base64url')}`;
  };
  // Use the real tenant read handler, with its real store and permission predicate.
  const locals = new Function('store', [
    localSource.match(/^const ok = .*$/m)[0], localSource.match(/^const err = .*$/m)[0],
    ...['tenantOut', 'canManageTenant', 'getTenant'].map((name) => declaration(localSource, name)),
    'return { getTenant };',
  ].join('\n'))(store);
  const bindings = {
    http, pool, jwtVerifier, PORT: 0, seedRoutes: routes, LOCAL_HANDLERS: locals,
    console: { error() {}, warn() {} },
    webhookRuntimePool: null, webhookWritePool: null, knativeRuntime: null, runtimeTeardownCoordinator: null,
    createRuntimeCleanupRepository, secretBackendHealth, respondHealth,
    ...audit, ...metrics, ...requestBody, ...knative, ...sa,
  };
  // Evaluate the complete route table, helpers and HTTP handler together. No routing,
  // auth or metric function is replaced. Startup safety gates remain untouched.
  const core = serverSource.slice(serverSource.indexOf('// ---- route table'),
    serverSource.indexOf('export async function bootstrapControlPlane'));
  const server = new Function(...Object.keys(bindings), 'runtimeRoutes',
    `${core}\nloadRoutes(runtimeRoutes); return server;`)(...Object.values(bindings), runtimeRoutes);
  return {
    token, executorJwtVerifier: createJwtVerifier(verifierOptions),
    async request(path, { bearer = null, method = 'GET' } = {}) {
      const req = Readable.from([]);
      Object.assign(req, { method, url: path, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
      const chunks = [];
      const res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); } });
      res.writeHead = (status, headers) => { res.statusCode = status; res.headers = new Headers(headers); };
      const finished = new Promise((resolve) => res.on('finish', resolve));
      server.emit('request', req, res);
      await finished;
      return { status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers };
    },
  };
}
