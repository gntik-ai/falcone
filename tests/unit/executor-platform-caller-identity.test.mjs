import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://identity.test/realms/platform';
const now = 1_900_000_000_000;
const verifier = createJwtVerifier({
  issuer, jwksUrl: `${issuer}/protocol/openid-connect/certs`, now: () => now,
  fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] }) }),
});
async function identity(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'test' })}.${encode({ iss: issuer, exp: now / 1000 + 600, ...claims })}`;
  return verifier.verify(`${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`, 'ws-a');
}

// Pin the complete control-plane deriveActorType mapping, including non-platform roles.
for (const [role, actorType, platformCaller] of [
  ['superadmin', 'superadmin', true],
  ['platform_admin', 'superadmin', true],
  ['platform_operator', 'internal', true],
  ['tenant_owner', 'tenant_owner', false],
  ['tenant_admin', 'tenant_owner', false],
  ['workspace_admin', 'workspace_admin', false],
  ['workspace_owner', 'workspace_admin', false],
  ['tenant_member', 'tenant_member', false],
  ['tenant_developer', 'tenant_member', false],
  ['admin', 'tenant_member', false],
]) test(`verified platform role ${role} maps to ${actorType} with platformCaller=${platformCaller}`, async () => {
  const result = await identity({ realm_access: { roles: [role] } });
  assert.equal(result.actorType, actorType);
  assert.equal(result.platformCaller, platformCaller);
  assert.equal(result.tenantId, undefined, 'verification alone must never invent a tenant');
});

for (const actorType of ['superadmin', 'internal']) test(`verified platform actor_type ${actorType} is sufficient without roles`, async () => {
  const result = await identity({ actor_type: actorType });
  assert.equal(result.actorType, actorType);
  assert.equal(result.platformCaller, true);
});

test('actor_type overrides realm roles, as in the control plane', async () => {
  const result = await identity({ actor_type: 'tenant_member', realm_access: { roles: ['superadmin'] } });
  assert.equal(result.actorType, 'tenant_member');
  assert.equal(result.platformCaller, false);
});

test('the role mapping uses control-plane priority rather than token role ordering', async () => {
  const result = await identity({ realm_access: { roles: ['tenant_owner', 'platform_operator', 'platform_admin', 'superadmin'] } });
  assert.equal(result.actorType, 'superadmin');
  assert.equal(result.platformCaller, true);
});
