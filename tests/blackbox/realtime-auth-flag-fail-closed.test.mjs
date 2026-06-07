// Black-box test suite for change fail-closed-realtime-auth-flag.
// Drives PUBLIC exports only: `loadEnv` from env.mjs and
// `createValidateSubscriptionAuthAction` from validate-subscription-auth.mjs.
// No internal knowledge, no direct file inspection.
//
// Scenarios:
//   A  — loadEnv throws in production when REALTIME_AUTH_ENABLED=false  (MUST FAIL before fix)
//   A' — loadEnv succeeds in production when REALTIME_AUTH_ENABLED=true  (must pass always)
//   B  — dev-mode bypass returns non-empty subscriptionContext with tenantId (MUST FAIL before fix)
//   C  — no allowed path produces tenant-less empty subscriptionContext  (MUST FAIL before fix)
//   D  — normal auth path (REALTIME_AUTH_ENABLED=true) is fully unmodified  (must pass always)

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../../services/realtime-gateway/src/config/env.mjs';
import { createValidateSubscriptionAuthAction } from '../../services/realtime-gateway/src/actions/validate-subscription-auth.mjs';

// Minimal valid env vars required by loadEnv (string keys).
const REQUIRED_ENV = {
  KEYCLOAK_JWKS_URL: 'https://keycloak.example.com/realms/test/protocol/openid-connect/certs',
  KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example.com/realms/test/protocol/openid-connect/token/introspect',
  KEYCLOAK_INTROSPECTION_CLIENT_ID: 'realtime-client',
  KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'secret-value',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/testdb',
  KAFKA_BROKERS: 'kafka1:9092,kafka2:9092'
};

// ---------------------------------------------------------------------------
// Scenario A — loadEnv MUST throw when REALTIME_AUTH_ENABLED=false in production
// Pre-fix: loadEnv does not check NODE_ENV → returns successfully (test FAILS pre-fix).
// Post-fix: loadEnv throws a configuration error.
// ---------------------------------------------------------------------------
test('bbx-realtime-auth-A: loadEnv throws config error when REALTIME_AUTH_ENABLED=false in NODE_ENV=production', () => {
  const source = {
    ...REQUIRED_ENV,
    REALTIME_AUTH_ENABLED: 'false',
    NODE_ENV: 'production'
  };

  assert.throws(
    () => loadEnv(source),
    (err) => {
      assert.ok(err instanceof Error, 'must throw an Error instance');
      // The error message must be descriptive — mention the problematic config.
      assert.ok(
        /REALTIME_AUTH_ENABLED/i.test(err.message) || /production/i.test(err.message),
        `error message "${err.message}" must reference REALTIME_AUTH_ENABLED or production`
      );
      return true;
    },
    'loadEnv must throw a configuration error when REALTIME_AUTH_ENABLED=false in production'
  );
});

// ---------------------------------------------------------------------------
// Scenario A' — loadEnv succeeds normally in production when auth is enabled.
// Must pass before AND after fix.
// ---------------------------------------------------------------------------
test("bbx-realtime-auth-A': loadEnv succeeds when REALTIME_AUTH_ENABLED=true in NODE_ENV=production", () => {
  const source = {
    ...REQUIRED_ENV,
    REALTIME_AUTH_ENABLED: 'true',
    NODE_ENV: 'production'
  };

  let env;
  assert.doesNotThrow(
    () => { env = loadEnv(source); },
    'loadEnv must not throw when REALTIME_AUTH_ENABLED=true in production'
  );
  assert.equal(env.REALTIME_AUTH_ENABLED, true, 'REALTIME_AUTH_ENABLED must be boolean true');
});

// ---------------------------------------------------------------------------
// Scenario B — dev bypass returns non-empty subscriptionContext with tenantId.
// Pre-fix: returns { allowed: true, subscriptionContext: {} } → tenantId missing (FAILS).
// Post-fix: subscriptionContext contains at minimum a tenantId.
// ---------------------------------------------------------------------------
test('bbx-realtime-auth-B: dev bypass returns allowed=true with non-empty subscriptionContext containing tenantId', async () => {
  // envProvider returns dev env: auth disabled, not production.
  const envProvider = () => ({
    REALTIME_AUTH_ENABLED: false,
    NODE_ENV: 'development',
    MAX_FILTER_PREDICATES: 10,
    MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50
  });

  const action = createValidateSubscriptionAuthAction({ envProvider });

  const result = await action(
    { token: 'any-token', workspaceId: 'ws-1', channelType: 'table', filter: {} },
    { db: {}, kafka: {} }
  );

  assert.equal(result.allowed, true, 'dev bypass must set allowed=true');
  assert.ok(
    result.subscriptionContext !== null && typeof result.subscriptionContext === 'object',
    'subscriptionContext must be an object'
  );
  assert.ok(
    Object.keys(result.subscriptionContext).length > 0,
    'subscriptionContext must NOT be empty — it must carry at minimum a tenantId'
  );
  assert.ok(
    typeof result.subscriptionContext.tenantId === 'string' && result.subscriptionContext.tenantId.length > 0,
    `subscriptionContext.tenantId must be a non-empty string, got ${JSON.stringify(result.subscriptionContext.tenantId)}`
  );
});

// ---------------------------------------------------------------------------
// Scenario C — No allowed path emits a tenant-less empty subscriptionContext.
// Combines B's assertion: the same dev-bypass result must not be {}.
// Pre-fix: { subscriptionContext: {} } is returned (FAILS).
// Post-fix: subscriptionContext has tenantId.
// ---------------------------------------------------------------------------
test('bbx-realtime-auth-C: no allowed result has empty/tenant-less subscriptionContext', async () => {
  const envProvider = () => ({
    REALTIME_AUTH_ENABLED: false,
    NODE_ENV: 'development',
    MAX_FILTER_PREDICATES: 10,
    MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50
  });

  const action = createValidateSubscriptionAuthAction({ envProvider });

  const result = await action(
    { token: 'ignored', workspaceId: 'ws-dev', channelType: 'table', filter: null },
    { db: {}, kafka: {} }
  );

  if (result.allowed) {
    // Any allowed result must carry a tenantId in subscriptionContext.
    assert.ok(
      result.subscriptionContext && typeof result.subscriptionContext.tenantId === 'string',
      `allowed result subscriptionContext must have a string tenantId; got ${JSON.stringify(result.subscriptionContext)}`
    );
    assert.ok(
      result.subscriptionContext.tenantId.length > 0,
      'tenantId must not be empty string'
    );
  }
  // Denied result is fine (no subscriptionContext required).
});

// ---------------------------------------------------------------------------
// Scenario D — Normal auth path (REALTIME_AUTH_ENABLED=true) is fully unmodified.
// D1: valid token + scopes → allowed=true, populated subscriptionContext,
//     publishAuthDecisionFn was called.
// D2: invalid token → allowed=false, publishAuthDecisionFn was called.
// Must pass BEFORE and AFTER fix.
// ---------------------------------------------------------------------------

const DEV_TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeEnvProvider(overrides = {}) {
  return () => ({
    REALTIME_AUTH_ENABLED: true,
    NODE_ENV: 'production',
    MAX_FILTER_PREDICATES: 10,
    MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50,
    ...overrides
  });
}

// Stub database: countActiveSubscriptions returns 0.
function makeDb(count = 0) {
  return {
    query: async (_sql, _params) => ({ rows: [{ count }] })
  };
}

test('bbx-realtime-auth-D1: valid token with scopes → allowed=true, subscriptionContext populated, publishAuthDecisionFn called', async () => {
  const claims = {
    sub: 'user-a',
    tenant_id: DEV_TENANT,
    scopes: ['realtime:subscribe'],
    exp: Math.floor(Date.now() / 1000) + 3600
  };

  let publishCalled = false;

  const action = createValidateSubscriptionAuthAction({
    envProvider: makeEnvProvider(),
    validateTokenFn: async (_token) => claims,
    checkScopesFn: async (_claims, _workspaceId, _channelType, _db) => ({ allowed: true }),
    parseFilterFn: (_filter) => ({ type: 'match_all' }),
    checkComplexityFn: (_filterSpec, _max) => { /* no-op */ },
    publishAuthDecisionFn: async (_event, _ctx) => { publishCalled = true; },
    logger: { warn: () => {} }
  });

  const result = await action(
    { token: 'valid-token', workspaceId: 'ws-1', channelType: 'table', filter: {} },
    { db: makeDb(0), kafka: {} }
  );

  assert.equal(result.allowed, true, 'valid token must yield allowed=true');
  assert.ok(result.subscriptionContext, 'subscriptionContext must be present');
  assert.equal(result.subscriptionContext.tenantId, DEV_TENANT, 'tenantId must match claims.tenant_id');
  assert.equal(result.subscriptionContext.workspaceId, 'ws-1', 'workspaceId must be set');
  assert.equal(result.subscriptionContext.actorIdentity, 'user-a', 'actorIdentity must be set');
  assert.ok(publishCalled, 'publishAuthDecisionFn must have been called for granted auth');
});

test('bbx-realtime-auth-D2: invalid token → allowed=false, publishAuthDecisionFn called', async () => {
  let publishCalled = false;

  // Import AuthError from the module to throw the right type.
  const { AuthError } = await import('../../services/realtime-gateway/src/auth/token-validator.mjs');

  const action = createValidateSubscriptionAuthAction({
    envProvider: makeEnvProvider(),
    validateTokenFn: async (_token) => {
      throw new AuthError('TOKEN_INVALID', 'Signature verification failed');
    },
    checkScopesFn: async () => ({ allowed: true }),
    parseFilterFn: (_f) => ({}),
    checkComplexityFn: () => {},
    publishAuthDecisionFn: async (_event, _ctx) => { publishCalled = true; },
    logger: { warn: () => {} }
  });

  const result = await action(
    { token: 'bad-token', workspaceId: 'ws-2', channelType: 'table', filter: {} },
    { db: makeDb(0), kafka: {} }
  );

  assert.equal(result.allowed, false, 'invalid token must yield allowed=false');
  assert.ok(result.error, 'error info must be present');
  assert.ok(publishCalled, 'publishAuthDecisionFn must have been called for denied auth');
});
