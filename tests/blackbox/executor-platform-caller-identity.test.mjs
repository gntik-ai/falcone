import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { request as httpRequest } from '../helpers/http-request.mjs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const issuer = 'https://identity.test/realms/platform';
const now = 1_900_000_000_000;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' };
function token(extra = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'test' })}.${encode({
    iss: issuer, aud: 'console', exp: now / 1000 + 600, sub: 'platform-user',
    realm_access: { roles: ['superadmin'] }, ...extra,
  })}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
}
const flows = [
  { tenantId: 'tenant-a', workspaceId: 'ws-a', flowId: 'flow-a' },
  { tenantId: 'tenant-b', workspaceId: 'ws-b', flowId: 'flow-b' },
];
async function request({ claims, path = '/v1/flows/workspaces/ws-a/flows', resolver = async (ws) => ({ 'ws-a': 'tenant-a', 'ws-b': 'tenant-b' })[ws], legacy = false, rawToken, method = 'GET', headers = {}, apiKeyStore, gatewaySharedSecret } = {}) {
  const executions = [];
  const jwtVerifier = createJwtVerifier({
    jwksUrl: legacy ? 'https://identity.test/keys' : `${issuer}/protocol/openid-connect/certs`,
    issuer: legacy ? undefined : issuer, audience: 'console', now: () => now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }),
  });
  const server = createControlPlaneServer({
    registry: {}, jwtVerifier, resolveWorkspaceTenant: resolver, apiKeyStore, gatewaySharedSecret,
    flowExecutor: { async executeFlows(params) {
      executions.push(params);
      return { items: flows.filter((flow) => flow.tenantId === params.identity.tenantId && flow.workspaceId === params.identity.workspaceId) };
    } },
    logger: { error() {} },
  });
  const response = await httpRequest(server, {
    method, path, headers: { authorization: `Bearer ${rawToken ?? token(claims)}`, ...headers },
  });
  return { ...response, executions };
}

test('platform superadmin without a tenant lists only the path workspace flows using its owning tenant', async () => {
  const result = await request();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body, { items: [flows[0]] });
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0].identity.tenantId, 'tenant-a');
  assert.equal(result.executions[0].identity.workspaceId, 'ws-a');
  assert.equal(result.executions[0].identity.platformCaller, true);
  assert.equal(result.executions[0].identity.actorType, 'superadmin');
});

for (const [name, resolver] of [
  ['unknown workspace', async () => undefined],
  ['resolver error', async () => { throw new Error('Workspace store unavailable'); }],
]) test(`platform caller gets 404 and no handler for ${name}`, async () => {
  const result = await request({ resolver });
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'NOT_FOUND');
  assert.deepEqual(result.executions, []);
});

for (const [name, options] of [
  ['non-platform role', { claims: { realm_access: { roles: ['tenant_member'] } } }],
  ['no roles', { claims: { realm_access: { roles: [] } } }],
  ['non-platform actor claim overrides platform role', { claims: { actor_type: 'tenant_member' } }],
  ['legacy issuer', { legacy: true, claims: { actor_type: 'superadmin' } }],
  ['no resolver', { resolver: null }],
  ['no path workspace despite credential binding', { method: 'POST', path: '/v1/postgres/databases/db/schemas', claims: { workspace_id: 'ws-a' } }],
  ['expired token', { claims: { exp: now / 1000 - 120 } }],
  ['wrong audience', { claims: { aud: 'foreign' } }],
  ['untrusted issuer', { claims: { iss: 'https://foreign.test/realms/platform' } }],
  ['invalid token', { rawToken: 'invalid.jwt.signature' }],
]) test(`${name} remains unauthenticated without a tenant identity`, async () => {
  const result = await request(options);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, ['expired token', 'wrong audience', 'untrusted issuer', 'invalid token'].includes(name)
    ? { code: 'INVALID_TOKEN', message: 'Invalid token' }
    : { code: 'UNAUTHENTICATED', message: 'Missing tenant identity' });
  assert.deepEqual(result.executions, []);
});

for (const actor_type of [undefined, 'superadmin', 'internal']) test(`tenant issuer retains its own tenant with platform role and actor ${actor_type}`, async () => {
  const result = await request({ claims: { iss: 'https://identity.test/realms/tenant-b', tenant_id: 'tenant-a', actor_type } });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'CROSS_TENANT_VIOLATION');
  assert.deepEqual(result.executions, []);
});

for (const claims of [
  { workspace_id: 'ws-b' },
  { workspace_id: 'ws-a', workspace_ids: ['ws-b'] },
]) test(`platform substitution preserves credential binding for ${JSON.stringify(claims)}`, async () => {
  const result = await request({ claims });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'FORBIDDEN');
  assert.deepEqual(result.executions, []);
});

test('a platform token with a tenant claim cannot substitute another tenant', async () => {
  const result = await request({ claims: { tenant_id: 'tenant-b' } });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'CROSS_TENANT_VIOLATION');
  assert.deepEqual(result.executions, []);
});

test('platform caller scopes the same token independently to another path workspace', async () => {
  const result = await request({ path: '/v1/flows/workspaces/ws-b/flows' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { items: [flows[1]] });
  assert.equal(result.executions[0].identity.tenantId, 'tenant-b');
});

for (const [claims, actorType] of [
  [{ realm_access: { roles: ['platform_admin'] } }, 'superadmin'],
  [{ realm_access: { roles: ['platform_operator'] } }, 'internal'],
  [{ actor_type: 'internal', realm_access: { roles: [] } }, 'internal'],
]) test(`platform actor ${actorType} lists workspace flows`, async () => {
  const result = await request({ claims });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { items: [flows[0]] });
  assert.equal(result.executions[0].identity.actorType, actorType);
});

test('platform actor substitution preserves structural write role gates', async () => {
  const result = await request({ method: 'POST', claims: { actor_type: 'internal', realm_access: { roles: ['tenant_member'] } } });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'FORBIDDEN');
  assert.deepEqual(result.executions, []);
});

const gatewayHeaders = { authorization: '', 'x-gateway-auth': 'synthetic-gateway-proof', 'x-actor-roles': 'superadmin', 'x-platform-caller': 'true' };
for (const tenant of [undefined, 'tenant-a', 'tenant-b']) test(`gateway header identity keeps its tenant ${tenant}`, async () => {
  const result = await request({ gatewaySharedSecret: 'synthetic-gateway-proof', headers: { ...gatewayHeaders, ...(tenant ? { 'x-tenant-id': tenant } : {}) } });
  assert.equal(result.status, tenant === 'tenant-a' ? 200 : tenant ? 403 : 401);
  if (tenant === 'tenant-a') {
    assert.deepEqual(result.body, { items: [flows[0]] });
    assert.equal(result.executions[0].identity.platformCaller, undefined);
  } else assert.deepEqual(result.executions, []);
});

test('an invalid gateway proof remains unauthenticated', async () => {
  const result = await request({ gatewaySharedSecret: 'synthetic-gateway-proof', headers: { ...gatewayHeaders, 'x-tenant-id': 'tenant-a', 'x-gateway-auth': 'wrong' } });
  assert.equal(result.status, 401);
  assert.deepEqual(result.executions, []);
});

test('headers cannot promote a verified non-platform actor', async () => {
  const result = await request({ claims: { realm_access: { roles: ['tenant_member'] } }, headers: { 'x-tenant-id': 'tenant-a', 'x-actor-roles': 'superadmin', 'x-platform-caller': 'true' } });
  assert.equal(result.status, 401);
  assert.deepEqual(result.executions, []);
});

for (const tenantId of [undefined, 'tenant-a', 'tenant-b']) test(`API key retains its stored tenant ${tenantId}`, async () => {
  const result = await request({
    headers: { authorization: 'Bearer flc_service_synthetic', 'x-tenant-id': 'tenant-a', 'x-actor-roles': 'superadmin' },
    apiKeyStore: { async verifyKey() { return { tenantId, workspaceId: 'ws-a', keyType: 'service', dbRole: 'falcone_service', scopes: ['data:read'] }; } },
  });
  assert.equal(result.status, tenantId === 'tenant-a' ? 200 : tenantId ? 403 : 401);
  if (tenantId === 'tenant-a') {
    assert.deepEqual(result.body, { items: [flows[0]] });
    assert.equal(result.executions[0].identity.platformCaller, undefined);
  } else assert.deepEqual(result.executions, []);
});
