import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { request } from '../helpers/http-request.mjs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const publicBase = 'https://identity.test/realms/';
const internalBase = 'http://falcone-keycloak:8080/realms/';
const realm = 'in-falcone-platform';
const jwksUrl = `${internalBase}${realm}/protocol/openid-connect/certs`;
const now = 1_900_000_000_000;
const platformKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const tenantKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(extra = {}, key = platformKey.privateKey) {
  const input = `${encode({ alg: 'RS256', kid: 'test' })}.${encode({ iss: `${internalBase}${realm}`, aud: 'account', exp: now / 1000 + 600, realm_access: { roles: ['superadmin'] }, ...extra })}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}
function server() {
  const jwtVerifier = createJwtVerifier({
    issuer: `${publicBase}${realm}`, jwksUrl, audience: 'in-falcone',
    trustedRealmBases: [publicBase, internalBase], platformAudiences: ['in-falcone', 'account'],
    tenantAudience: 'falcone-data-api', enforceTenantAudience: true, now: () => now,
    fetchImpl: async (url) => ({ ok: true, json: async () => ({ keys: [{ ...(url === jwksUrl ? platformKey : tenantKey).publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }] }) }),
    logger: { warn() {} },
  });
  return createControlPlaneServer({
    registry: {}, jwtVerifier, resolveWorkspaceTenant: async () => 'tenant-a',
    flowExecutor: { async executeFlows({ identity }) { return { items: [{ tenantId: identity.tenantId, workspaceId: identity.workspaceId }] }; } },
    mcpEngine: { async executeMcp({ identity }) { return { items: [{ tenantId: identity.tenantId, workspaceId: identity.workspaceId }] }; } },
    logger: { error() {} },
  });
}
const paths = ['/v1/flows/workspaces/ws-a/flows', '/v1/mcp/workspaces/ws-a/servers'];
for (const path of paths) {
  for (const base of [publicBase, internalBase]) test(`console superadmin without tenant reaches ${path} from ${base}`, async () => {
    const result = await request(server(), { method: 'GET', path, headers: { authorization: `Bearer ${token({ iss: `${base}${realm}` })}` } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body, { items: [{ tenantId: 'tenant-a', workspaceId: 'ws-a' }] });
  });
  test(`bad signature returns INVALID_TOKEN on ${path}`, async () => {
    const result = await request(server(), { method: 'GET', path, headers: { authorization: `Bearer ${token({}, tenantKey.privateKey)}` } });
    assert.equal(result.status, 401);
    assert.equal(result.body.code, 'INVALID_TOKEN');
  });
  test(`tenant owner lists its own workspace on ${path}`, async () => {
    const jwt = token({ iss: `${internalBase}tenant-a`, aud: 'falcone-data-api', realm_access: { roles: ['tenant_owner'] } }, tenantKey.privateKey);
    const result = await request(server(), { method: 'GET', path, headers: { authorization: `Bearer ${jwt}` } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body, { items: [{ tenantId: 'tenant-a', workspaceId: 'ws-a' }] });
  });
  test(`tenant realm cannot use another tenant's workspace on ${path}`, async () => {
    const jwt = token({ iss: `${internalBase}tenant-b`, aud: 'falcone-data-api', tenant_id: 'tenant-a' }, tenantKey.privateKey);
    const result = await request(server(), { method: 'GET', path, headers: { authorization: `Bearer ${jwt}` } });
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'CROSS_TENANT_VIOLATION');
  });
}
for (const authorization of [undefined, 'Bearer opaque-invalid', 'Bearer flc_invalid']) test(`non-JWT credential retains Missing tenant identity: ${authorization ?? 'missing'}`, async () => {
  const result = await request(server(), { method: 'GET', path: paths[0], headers: authorization ? { authorization } : {} });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { code: 'UNAUTHENTICATED', message: 'Missing tenant identity' });
});
