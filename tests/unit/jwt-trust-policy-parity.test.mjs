import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';
import { createMultiRealmVerifier } from '../../apps/control-plane/jwt-verify.mjs';

const publicBase = 'https://identity.test/realms/';
const internalBase = 'http://falcone-keycloak:8080/realms/';
const platformRealm = 'in-falcone-platform';
const issuer = `${publicBase}${platformRealm}`;
const internalIssuer = `${internalBase}${platformRealm}`;
const jwksUrl = `${internalIssuer}/protocol/openid-connect/certs`;
const now = 1_900_000_000_000;
const platformKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const tenantKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims = {}, { key = platformKey.privateKey, alg = 'RS256', kid = 'test' } = {}) {
  const input = `${encode({ alg, kid })}.${encode({ iss: internalIssuer, aud: 'account', sub: 'user', exp: now / 1000 + 600, realm_access: { roles: ['superadmin'] }, ...claims })}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}
const config = {
  issuer, jwksUrl, audience: 'in-falcone',
  trustedRealmBases: [publicBase, internalBase],
  platformAudiences: ['in-falcone', 'account'],
  tenantAudience: 'falcone-data-api', enforceTenantAudience: true,
  now: () => now,
  fetchImpl: async (url) => ({ ok: true, json: async () => ({ keys: [{
    ...(url === jwksUrl ? platformKey : tenantKey).publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256',
  }] }) }),
  logger: { warn() {} },
};

test('the in-cluster console token accepted by the deployed control plane also verifies in the executor', async () => {
  const jwt = token();
  // Reproduce the deployed control plane policy before applying the shared configuration.
  assert.equal((await createMultiRealmVerifier({ jwksUrl, fetchImpl: config.fetchImpl, now: config.now }).verify(jwt)).trust.kind, 'platform');
  const executor = await createJwtVerifier(config).verify(jwt, 'ws-a');
  assert.equal(executor.platformCaller, true);
  assert.equal(executor.tenantId, undefined);
  assert.equal((await createMultiRealmVerifier(config).verify(jwt)).trust.kind, 'platform');
});

const corpus = [
  ['public platform', token({ iss: issuer, aud: 'in-falcone' }), null],
  ['internal platform', token(), null],
  ['platform audience array', token({ aud: ['account', 'in-falcone'] }), null],
  ['public tenant', token({ iss: `${publicBase}tenant-a`, aud: 'falcone-data-api' }, { key: tenantKey.privateKey }), null],
  ['internal tenant', token({ iss: `${internalBase}tenant-a`, aud: ['account', 'falcone-data-api'] }, { key: tenantKey.privateKey }), null],
  ['foreign host', token({ iss: 'https://foreign.test/realms/in-falcone-platform' }), 'issuer'],
  ['foreign realm path', token({ iss: 'https://identity.test/not-realms/in-falcone-platform' }), 'issuer'],
  ['trailing segment', token({ iss: `${issuer}/extra` }), 'issuer'],
  ['issuer query', token({ iss: `${issuer}?other=1` }), 'issuer'],
  ['encoded path', token({ iss: `${publicBase}tenant%2fa` }), 'issuer'],
  ['wrong realm key', token({ iss: `${publicBase}wrong-realm`, aud: 'falcone-data-api' }), 'signature'],
  ['wrong platform audience', token({ aud: 'foreign', azp: 'in-falcone' }), 'audience'],
  ['missing platform audience', token({ aud: undefined, azp: 'in-falcone' }), 'audience'],
  ['wrong tenant audience', token({ iss: `${internalBase}tenant-a`, aud: 'account', azp: 'falcone-data-api' }, { key: tenantKey.privateKey }), 'audience'],
  ['expired', token({ exp: now / 1000 - 120 }), 'expiry'],
  ['future nbf', token({ nbf: now / 1000 + 120 }), 'nbf'],
  ['bad signature', token({}, { key: tenantKey.privateKey }), 'signature'],
  ['unsigned', token({}, { alg: 'none' }), 'alg'],
  ['HS256', token({}, { alg: 'HS256' }), 'alg'],
  ['unknown kid', token({}, { kid: 'unknown' }), 'key_lookup'],
  ['revoked SA', token({ azp: 'sa-revoked' }), 'revoked'],
  ['malformed', 'invalid.jwt.signature', 'malformed'],
];

for (const [name, jwt, expected] of corpus) test(`both verifiers apply the same policy: ${name}`, async () => {
  const verdicts = [];
  for (const create of [createJwtVerifier, createMultiRealmVerifier]) {
    const lines = [];
    const verifier = create({ ...config, revocationCheck: async (claims) => claims.azp === 'sa-revoked', logger: { warn: (line) => lines.push(line) } });
    let verdict = null;
    try { await verifier.verify(jwt); } catch (error) { verdict = error.category; }
    assert.equal(verdict, expected);
    verdicts.push(verdict);
    if (expected) {
      assert.equal(lines.length, 1);
      const log = JSON.parse(lines[0]);
      assert.deepEqual(Object.keys(log).sort(), ['aud', 'category', 'issHost']);
      assert.equal(log.category, expected);
      assert.ok(lines[0].length < 1500);
      if (expected !== 'malformed') {
        assert.equal(log.issHost, name === 'foreign host' ? 'foreign.test' : new URL(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).iss).host);
      }
      for (const segment of jwt.split('.')) if (segment.length > 8) assert.ok(!lines[0].includes(segment));
      assert.ok(!lines[0].includes('realm_access'));
      assert.ok(!lines[0].includes('superadmin'));
    } else assert.deepEqual(lines, []);
  }
  assert.deepEqual(verdicts, [expected, expected]);
});

test('both real revocation hooks use the verified tenant realm across issuer aliases', async () => {
  const { createSaRevocationCheck: controlPlaneHook } = await import('../../apps/control-plane/sa-revocation.mjs');
  const { createSaRevocationCheck: executorHook } = await import('../../apps/control-plane-executor/src/runtime/sa-revocation.mjs');
  let revoked = false;
  const lookup = async (_pool, clientId, realm) => {
    assert.equal(clientId, 'sa-test');
    assert.equal(realm, 'tenant-a');
    return { status: revoked ? 'revoked' : 'active' };
  };
  for (const [create, hook] of [[createJwtVerifier, executorHook], [createMultiRealmVerifier, controlPlaneHook]]) {
    const revocationCheck = hook({
      pool: {}, realmsBase: publicBase, platformRealm, cacheMs: 0, logger: { error() {} },
      lookupAuthState: lookup, store: { getServiceAccountAuthStateByClientId: lookup },
    });
    const verifier = create({ ...config, revocationCheck });
    for (const base of [publicBase, internalBase]) {
      const jwt = token({ iss: `${base}tenant-a`, aud: 'falcone-data-api', tenant_id: 'victim', azp: 'sa-test' }, { key: tenantKey.privateKey });
      revoked = false;
      await verifier.verify(jwt);
      revoked = true;
      await assert.rejects(verifier.verify(jwt), (error) => error.category === 'revoked');
    }
  }
});

test('both runtimes parse one environment contract without enabling rollout audiences by default', async () => {
  const executorApi = await import('../../apps/control-plane-executor/src/runtime/jwt-verify.mjs');
  const controlPlaneApi = await import('../../apps/control-plane/jwt-verify.mjs');
  const env = {
    KEYCLOAK_JWKS_URL: jwksUrl, KEYCLOAK_ISSUER: issuer, KEYCLOAK_AUDIENCE: 'in-falcone',
    KEYCLOAK_TRUSTED_REALM_BASES: JSON.stringify([publicBase, internalBase]),
    KEYCLOAK_PLATFORM_REALM: platformRealm,
    KEYCLOAK_PLATFORM_AUDIENCES: '["in-falcone","account"]',
    KEYCLOAK_TENANT_AUDIENCE: 'falcone-data-api', KEYCLOAK_ENFORCE_TENANT_AUDIENCE: 'true',
    KEYCLOAK_ALLOW_TENANT_REALMS: '0',
  };
  for (const api of [executorApi, controlPlaneApi]) {
    const options = api.jwtVerifierOptionsFromEnv(env);
    assert.deepEqual(options, {
      jwksUrl, issuer, audience: 'in-falcone', trustedRealmBases: [publicBase, internalBase],
      platformRealm, platformAudiences: ['in-falcone', 'account'],
      tenantAudience: 'falcone-data-api', enforceTenantAudience: true, allowTenantRealms: false,
    });
    assert.equal(api.jwtVerifierOptionsFromEnv({}).platformAudiences, undefined);
    for (const [name, value] of [
      ['KEYCLOAK_TRUSTED_REALM_BASES', '*'], ['KEYCLOAK_TRUSTED_REALM_BASES', '[]'],
      ['KEYCLOAK_PLATFORM_AUDIENCES', 'account'], ['KEYCLOAK_PLATFORM_AUDIENCES', '[]'],
      ['KEYCLOAK_ENFORCE_TENANT_AUDIENCE', 'yes'],
    ]) assert.throws(() => api.jwtVerifierOptionsFromEnv({ ...env, [name]: value }));
  }
});

test('issuer aliases and the account audience are opt-in and never inferred from the JWKS host', async () => {
  for (const create of [createJwtVerifier, createMultiRealmVerifier]) {
    const single = create({ ...config, trustedRealmBases: undefined, platformAudiences: undefined });
    await assert.rejects(single.verify(token()), (error) => error.category === 'issuer');
    await assert.rejects(single.verify(token({ iss: issuer })), (error) => error.category === 'audience');
    await single.verify(token({ iss: issuer, aud: 'in-falcone' }));
    const publicOnly = create({ ...config, trustedRealmBases: [publicBase] });
    await assert.rejects(publicOnly.verify(token()), (error) => error.category === 'issuer');
    const noTenants = create({ ...config, allowTenantRealms: false });
    await noTenants.verify(token());
    await assert.rejects(noTenants.verify(token({ iss: `${publicBase}tenant-a`, aud: 'falcone-data-api' }, { key: tenantKey.privateKey })), (error) => error.category === 'issuer');
    const legacy = create({ jwksUrl: 'https://identity.test/jwks', fetchImpl: config.fetchImpl, now: config.now, logger: config.logger });
    await legacy.verify(token({ iss: 'https://legacy.test', aud: 'anything' }, { key: tenantKey.privateKey }));
  }
});

test('tenant key fetches are restricted to configured exact bases and use each realm key', async () => {
  for (const create of [createJwtVerifier, createMultiRealmVerifier]) {
    const urls = [];
    const verifier = create({ ...config, fetchImpl: async (url) => { urls.push(url); return config.fetchImpl(url); } });
    for (const iss of [
      'https://identity.test.evil.test/realms/tenant-a',
      'https://identity.test@evil.test/realms/tenant-a',
      'https://identity.test/realms/../tenant-a',
      'https://identity.test/realms/tenant-a#extra',
      'https://identity.test/realms/tenant-a?extra=1',
      'https://identity.test/realms/tenant-a/extra',
      'https://identity.test/realms/tenant-a\\extra',
    ]) await assert.rejects(verifier.verify(token({ iss })), (error) => error.category === 'issuer');
    assert.deepEqual(urls, []);
    await verifier.verify(token());
    assert.deepEqual(urls, [jwksUrl]);
    await verifier.verify(token({ iss: issuer }));
    assert.deepEqual(urls, [jwksUrl], 'platform aliases share the configured JWKS cache');
    for (const base of [publicBase, internalBase]) await verifier.verify(token({ iss: `${base}tenant-a`, aud: 'falcone-data-api' }, { key: tenantKey.privateKey }));
    assert.deepEqual(urls, [jwksUrl, `${publicBase}tenant-a/protocol/openid-connect/certs`, `${internalBase}tenant-a/protocol/openid-connect/certs`]);
  }
});

test('invalid realm configuration fails closed before verification', () => {
  for (const create of [createJwtVerifier, createMultiRealmVerifier]) {
    for (const trustedRealmBases of [[], ['https://*.test/realms/'], ['https://user:pass@identity.test/realms/'], ['https://identity.test/realms/?query'], ['https://identity.test/realms/#fragment'], ['https://identity.test/realms'], ['file:///realms/']]) {
      assert.throws(() => create({ ...config, trustedRealmBases }));
    }
    assert.throws(() => create({ ...config, platformRealm: 'other-realm' }), /platform realm/);
    assert.throws(() => create({ ...config, trustedRealmBases: undefined, platformRealm: 'other-realm' }), /platform realm/);
    assert.throws(() => create({ ...config, jwksUrl: `${internalBase}other-realm/protocol/openid-connect/certs` }), /platform realm/);
    assert.throws(() => create({ ...config, platformAudiences: [] }), /platformAudiences/);
  }
});

test('failure logs redact arbitrary audience objects, control characters, and JWT segments', async () => {
  for (const create of [createJwtVerifier, createMultiRealmVerifier]) {
    const jwt = token({ aud: [encode({ alg: 'RS256', kid: 'test' }), { secret: 'never-log-this' }, 'account\nforged-line', 'x'.repeat(200), ...Array(20).fill('foreign')] });
    const lines = [];
    const verifier = create({ ...config, logger: { warn: (line) => lines.push(line) } });
    await assert.rejects(verifier.verify(jwt), (error) => error.category === 'audience');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      category: 'audience', issHost: 'falcone-keycloak:8080',
      aud: ['<REDACTED>', '<REDACTED>', '<REDACTED>', '<REDACTED>', 'foreign', 'foreign', 'foreign', 'foreign'],
    });
    for (const segment of jwt.split('.')) assert.ok(!lines[0].includes(segment));
    assert.ok(!lines[0].includes('never-log-this'));
  }
});

test('wildcard realm bases are invalid even without a primary issuer', () => {
  for (const create of [createJwtVerifier, createMultiRealmVerifier]) {
    assert.throws(() => create({ ...config, issuer: undefined, trustedRealmBases: ['https://*.test/realms/'] }), /exact HTTP/);
  }
});
