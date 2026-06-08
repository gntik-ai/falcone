import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthError, createTokenValidator } from '../../../services/realtime-gateway/src/auth/token-validator.mjs';
import { loadEnv } from '../../../services/realtime-gateway/src/config/env.mjs';

const env = () => ({
  KEYCLOAK_JWKS_URL: 'https://keycloak.example/certs',
  KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example/introspect',
  KEYCLOAK_INTROSPECTION_CLIENT_ID: 'client-id',
  KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'client-secret',
  KEYCLOAK_ISSUER: 'https://keycloak.example/realms/falcone',
  KEYCLOAK_AUDIENCE: 'realtime-client',
  DATABASE_URL: 'postgres://example',
  KAFKA_BROKERS: ['broker:9092'],
  JWKS_CACHE_TTL_SECONDS: 300,
  SCOPE_REVALIDATION_INTERVAL_SECONDS: 30,
  TOKEN_EXPIRY_GRACE_SECONDS: 30,
  MAX_FILTER_PREDICATES: 10,
  MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50,
  AUDIT_KAFKA_TOPIC_AUTH_GRANTED: 'granted',
  AUDIT_KAFKA_TOPIC_AUTH_DENIED: 'denied',
  AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED: 'suspended',
  AUDIT_KAFKA_TOPIC_SESSION_RESUMED: 'resumed',
  REALTIME_AUTH_ENABLED: true
});

test('validateToken returns normalized claims for a valid JWT', async () => {
  const validateToken = createTokenValidator({
    envProvider: env,
    decodeHeaderFn: () => ({ kid: 'kid-1' }),
    jwksClientFactory: () => ({
      getSigningKey: async () => ({
        getPublicKey: () => 'PUBLIC KEY'
      })
    }),
    createPublicKeyFn: (value) => value,
    jwtVerifyFn: async () => ({
      payload: {
        sub: 'user-1',
        tenant_id: 'tenant-1',
        scope: 'realtime:read workspace:read',
        workspace_ids: ['workspace-1'],
        exp: 4102444800,
        jti: 'jti-1'
      }
    })
  });

  const claims = await validateToken('Bearer token-value');
  assert.equal(claims.sub, 'user-1');
  assert.equal(claims.tenant_id, 'tenant-1');
  assert.deepEqual(claims.scopes, ['realtime:read', 'workspace:read']);
  assert.deepEqual(claims.authorizedWorkspaces, ['workspace-1']);
  assert.equal(claims.jti, 'jti-1');
});

test('validateToken throws TOKEN_EXPIRED for expired JWTs', async () => {
  const validateToken = createTokenValidator({
    envProvider: env,
    decodeHeaderFn: () => ({ kid: 'kid-1' }),
    jwksClientFactory: () => ({
      getSigningKey: async () => ({
        getPublicKey: () => 'PUBLIC KEY'
      })
    }),
    createPublicKeyFn: (value) => value,
    jwtVerifyFn: async () => {
      const error = new Error('jwt expired');
      error.code = 'ERR_JWT_EXPIRED';
      throw error;
    }
  });

  await assert.rejects(() => validateToken('expired-token'), (error) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, 'TOKEN_EXPIRED');
    return true;
  });
});

test('validateToken throws TOKEN_INVALID for tampered signatures', async () => {
  const validateToken = createTokenValidator({
    envProvider: env,
    decodeHeaderFn: () => ({ kid: 'kid-1' }),
    jwksClientFactory: () => ({
      getSigningKey: async () => ({
        getPublicKey: () => 'PUBLIC KEY'
      })
    }),
    createPublicKeyFn: (value) => value,
    jwtVerifyFn: async () => {
      throw new Error('signature verification failed');
    }
  });

  await assert.rejects(() => validateToken('tampered-token'), (error) => {
    assert.equal(error.code, 'TOKEN_INVALID');
    return true;
  });
});

test('validateToken falls back to introspection when kid lookup fails twice', async () => {
  const requests = [];
  let getSigningKeyCalls = 0;
  const validateToken = createTokenValidator({
    envProvider: env,
    decodeHeaderFn: () => ({ kid: 'missing-kid' }),
    jwksClientFactory: () => ({
      getSigningKey: async () => {
        getSigningKeyCalls += 1;
        const error = new Error('Unable to find a signing key that matches');
        error.code = 'ERR_JWKS_NO_MATCHING_KEY';
        throw error;
      }
    }),
    jwtVerifyFn: async () => {
      throw new Error('should not verify');
    },
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          active: true,
          sub: 'user-1',
          tenant_id: 'tenant-1',
          scope: 'realtime:read',
          workspace_ids: ['workspace-1'],
          exp: 4102444800,
          jti: 'jti-introspected'
        })
      };
    }
  });

  const claims = await validateToken('token-with-missing-kid');
  assert.equal(getSigningKeyCalls, 2);
  assert.equal(requests.length, 1);
  assert.equal(claims.jti, 'jti-introspected');
});

test('validateToken throws TOKEN_REVOKED when introspection reports an inactive token', async () => {
  const validateToken = createTokenValidator({
    envProvider: env,
    decodeHeaderFn: () => ({ kid: 'missing-kid' }),
    jwksClientFactory: () => ({
      getSigningKey: async () => {
        const error = new Error('No matching key');
        error.code = 'ERR_JWKS_NO_MATCHING_KEY';
        throw error;
      }
    }),
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ active: false })
    })
  });

  await assert.rejects(() => validateToken('revoked-token'), (error) => {
    assert.equal(error.code, 'TOKEN_REVOKED');
    return true;
  });
});

// ---------------------------------------------------------------------------
// fix-realtime-token-issuer-audience reproduction tests (RED before fix)
// ---------------------------------------------------------------------------

// loadEnv must require KEYCLOAK_ISSUER
test('loadEnv throws when KEYCLOAK_ISSUER is missing', () => {
  const source = {
    KEYCLOAK_JWKS_URL: 'https://keycloak.example/certs',
    KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example/introspect',
    KEYCLOAK_INTROSPECTION_CLIENT_ID: 'client-id',
    KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'client-secret',
    // KEYCLOAK_ISSUER intentionally omitted
    KEYCLOAK_AUDIENCE: 'realtime-client',
    DATABASE_URL: 'postgres://example',
    KAFKA_BROKERS: 'broker:9092',
    NODE_ENV: 'development'
  };
  assert.throws(
    () => loadEnv(source),
    (err) => {
      assert.ok(err instanceof Error, 'must throw an Error instance');
      assert.ok(/KEYCLOAK_ISSUER/i.test(err.message),
        `error message "${err.message}" must reference KEYCLOAK_ISSUER`);
      return true;
    },
    'loadEnv must throw when KEYCLOAK_ISSUER is absent'
  );
});

// loadEnv must require KEYCLOAK_AUDIENCE
test('loadEnv throws when KEYCLOAK_AUDIENCE is missing', () => {
  const source = {
    KEYCLOAK_JWKS_URL: 'https://keycloak.example/certs',
    KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example/introspect',
    KEYCLOAK_INTROSPECTION_CLIENT_ID: 'client-id',
    KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'client-secret',
    KEYCLOAK_ISSUER: 'https://keycloak.example/realms/falcone',
    // KEYCLOAK_AUDIENCE intentionally omitted
    DATABASE_URL: 'postgres://example',
    KAFKA_BROKERS: 'broker:9092',
    NODE_ENV: 'development'
  };
  assert.throws(
    () => loadEnv(source),
    (err) => {
      assert.ok(err instanceof Error, 'must throw an Error instance');
      assert.ok(/KEYCLOAK_AUDIENCE/i.test(err.message),
        `error message "${err.message}" must reference KEYCLOAK_AUDIENCE`);
      return true;
    },
    'loadEnv must throw when KEYCLOAK_AUDIENCE is absent'
  );
});

// loadEnv must return KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE when both are provided
test('loadEnv returns KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE when present', () => {
  const source = {
    KEYCLOAK_JWKS_URL: 'https://keycloak.example/certs',
    KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example/introspect',
    KEYCLOAK_INTROSPECTION_CLIENT_ID: 'client-id',
    KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'client-secret',
    KEYCLOAK_ISSUER: 'https://keycloak.example/realms/falcone',
    KEYCLOAK_AUDIENCE: 'realtime-client',
    DATABASE_URL: 'postgres://example',
    KAFKA_BROKERS: 'broker:9092',
    NODE_ENV: 'development'
  };
  const result = loadEnv(source);
  assert.equal(result.KEYCLOAK_ISSUER, 'https://keycloak.example/realms/falcone',
    'KEYCLOAK_ISSUER must be returned by loadEnv');
  assert.equal(result.KEYCLOAK_AUDIENCE, 'realtime-client',
    'KEYCLOAK_AUDIENCE must be returned by loadEnv');
});

// verifyLocally must pass issuer and audience to jwtVerifyFn
// RED: currently only clockTolerance is passed — issuer/audience are absent
test('verifyLocally passes issuer and audience options to jwtVerifyFn', async () => {
  let capturedOptions;
  const validateToken = createTokenValidator({
    envProvider: env,
    decodeHeaderFn: () => ({ kid: 'kid-1' }),
    jwksClientFactory: () => ({
      getSigningKey: async () => ({ getPublicKey: () => 'PUBLIC KEY' })
    }),
    createPublicKeyFn: (value) => value,
    jwtVerifyFn: async (_token, _key, options) => {
      capturedOptions = options;
      return {
        payload: {
          sub: 'user-1',
          tenant_id: 'tenant-1',
          scope: 'realtime:read',
          workspace_ids: ['ws-1'],
          exp: 4102444800,
          jti: 'jti-1'
        }
      };
    }
  });

  await validateToken('Bearer token-value');

  assert.ok(capturedOptions !== undefined, 'jwtVerifyFn must receive an options object');
  assert.equal(capturedOptions.issuer, 'https://keycloak.example/realms/falcone',
    `options.issuer must equal KEYCLOAK_ISSUER; got ${JSON.stringify(capturedOptions.issuer)}`);
  assert.equal(capturedOptions.audience, 'realtime-client',
    `options.audience must equal KEYCLOAK_AUDIENCE; got ${JSON.stringify(capturedOptions.audience)}`);
  assert.equal(capturedOptions.clockTolerance, '5 seconds',
    'options.clockTolerance must still be present');
});

// A token with wrong audience/issuer must be rejected with TOKEN_INVALID
// and must NOT fall through to introspection (claim errors are not "unknown kid" errors)
test('verifyLocally rejects wrong-audience token with TOKEN_INVALID without introspection fallback', async () => {
  let introspectCalled = false;
  const validateToken = createTokenValidator({
    envProvider: env,
    decodeHeaderFn: () => ({ kid: 'kid-1' }),
    jwksClientFactory: () => ({
      getSigningKey: async () => ({ getPublicKey: () => 'PUBLIC KEY' })
    }),
    createPublicKeyFn: (value) => value,
    jwtVerifyFn: async (_token, _key, options) => {
      // Emulate jose's claim-validation error when audience doesn't match
      const err = new Error('unexpected "aud" claim value');
      err.code = 'ERR_JWT_CLAIM_VALIDATION_FAILED';
      throw err;
    },
    fetchFn: async (url, opts) => {
      introspectCalled = true;
      return { ok: true, json: async () => ({ active: true, sub: 'x', tenant_id: 't', scope: '', exp: 9999999999, jti: 'j' }) };
    }
  });

  await assert.rejects(
    () => validateToken('Bearer wrong-aud-token'),
    (error) => {
      assert.ok(error instanceof AuthError,
        `expected AuthError, got ${error?.constructor?.name}`);
      assert.equal(error.code, 'TOKEN_INVALID',
        `expected TOKEN_INVALID, got ${error.code}`);
      return true;
    },
    'wrong-audience token must be rejected with TOKEN_INVALID'
  );

  assert.equal(introspectCalled, false,
    'introspection must NOT be called for a claim-validation error (not an unknown-kid error)');
});
