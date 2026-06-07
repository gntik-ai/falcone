/**
 * REAL-STACK regression test for GitHub issue #221 —
 * fail-closed-realtime-auth-flag.
 *
 * This codebase ships pure-logic libraries with no in-repo HTTP server or UI,
 * so a user-facing Playwright E2E is not applicable here. Instead this test
 * exercises the fix directly against the REAL backing stack the system uses
 * (tests/env):
 *
 *   - Postgres (pg)   : real schema migrations applied idempotently, real
 *                       scope-mapping rows seeded and cleaned up per run.
 *   - Keycloak        : per-tenant service-account clients provisioned with
 *                       protocol-mapper claims (tenant_id, workspace_ids, scopes)
 *                       so that minted tokens carry the correct custom claims.
 *                       Tokens are validated against the REAL per-tenant JWKS —
 *                       this is the "preferred high-fidelity" approach described
 *                       in the task spec.  The injected-claims fallback was NOT
 *                       used because protocol-mapper wiring proved stable.
 *   - Redpanda/Kafka  : real audit messages are asserted by comparing broker
 *                       offsets before and after the action, matching the
 *                       pattern established in bind-event-publish-topic-to-tenant.
 *
 * Token approach: REAL protocol-mapper tokens.
 *   Three hardcoded-claim mappers are added to the per-tenant service-account
 *   client (tenant-id-mapper → tenant_id, workspace-ids-mapper → workspace_ids,
 *   realtime-scopes-array-mapper → scopes). These are idempotent (409 on a
 *   second run is swallowed). The token is then validated through
 *   createTokenValidator against the tenant realm's real JWKS endpoint.
 *   checkScopes and publishAuthDecision are also constructed with the injected
 *   envProvider so their internal loadEnv() calls use the same env object.
 *
 * Run (stack must already be up):
 *   source tests/env/env.sh && \
 *     node --test tests/e2e/issues/fail-closed-realtime-auth-flag.realstack.test.mjs
 *
 * OpenSpec change: fail-closed-realtime-auth-flag  (GitHub issue #221)
 * Scenarios covered:
 *   S-A    loadEnv throws when REALTIME_AUTH_ENABLED=false + NODE_ENV=production
 *   S-A'   loadEnv succeeds with REALTIME_AUTH_ENABLED=true + NODE_ENV=production
 *   S-D    Normal path (auth enabled, real token+DB+Kafka) → allowed:true,
 *          non-bypass tenantId, audit GRANTED message in Redpanda
 *   S-D2   Invalid/garbage token + auth enabled → allowed:false, DENIED audit
 *   S-ISO  Cross-tenant probe: tenant-A token → tenant-B workspace → allowed:false
 *   S-DEV  Dev bypass (auth disabled, NODE_ENV=development) → allowed:true,
 *          subscriptionContext.tenantId is the dev sentinel (not empty, not {})
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

// CJS packages (kafkajs, pg) loaded via createRequire — both are CommonJS
// modules without named ESM exports.
const require = createRequire(import.meta.url);
const { Pool } = require('../../../services/realtime-gateway/node_modules/pg/lib/index.js');
const { Kafka, logLevel } = require('kafkajs');

// Pure-ESM realtime-gateway modules imported directly by absolute-style relative path.
import { loadEnv } from '../../../services/realtime-gateway/src/config/env.mjs';
import { createValidateSubscriptionAuthAction } from '../../../services/realtime-gateway/src/actions/validate-subscription-auth.mjs';
import { createAuditPublisher } from '../../../services/realtime-gateway/src/audit/audit-publisher.mjs';
import { createTokenValidator } from '../../../services/realtime-gateway/src/auth/token-validator.mjs';
import { createScopeChecker } from '../../../services/realtime-gateway/src/auth/scope-checker.mjs';
import { upsertScopeMapping } from '../../../services/realtime-gateway/src/repositories/scope-mapping-repository.mjs';

// ---------------------------------------------------------------------------
// Gate: skip the whole suite if the test environment is not running.
// ---------------------------------------------------------------------------
const KC = process.env.KEYCLOAK_BASE_URL;
const ADMIN_CLIENT = process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'falcone-admin';
const ADMIN_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || 'falcone-admin-secret';
const TENANT_A = process.env.TESTENV_TENANT_A;
const TENANT_B = process.env.TESTENV_TENANT_B;
const BROKERS = process.env.KAFKA_BROKERS;
const DB_URL = process.env.DB_URL; // env.sh exports DB_URL

const RUN = process.env.FALCONE_TESTENV === '1' && !!KC && !!BROKERS && !!TENANT_A && !!TENANT_B && !!DB_URL;

// Unique suffix per run so seeded rows and workspace IDs never clash across reruns.
const RUN_ID = `r${Date.now().toString(36)}`;
const REALTIME_CLIENT_ID = 'falcone-realtime';
const WS_A = `ws-a-${RUN_ID}`; // workspace owned by tenant A
const WS_B = `ws-b-${RUN_ID}`; // workspace owned by tenant B (not in tenant-A token)

const MIG_DIR = new URL('../../../services/realtime-gateway/src/migrations/', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function decodeJwtPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

async function getAdminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: ADMIN_CLIENT,
      client_secret: ADMIN_SECRET
    })
  });
  if (!res.ok) throw new Error(`Admin token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

/**
 * Ensure a confidential service-account client exists in `realm` with
 * hardcoded-claim mappers for tenant_id, workspace_ids, and scopes.
 * Returns the client secret.
 *
 * The workspace-ids-mapper is ALWAYS deleted and recreated so that a fresh
 * per-run workspace ID is reflected in the minted token (idempotent across
 * reruns: old mapper deleted, new one created with current workspace).
 */
async function ensureRealtimeClient(adminToken, realm, tenantId, workspaceId) {
  const base = `${KC}/admin/realms/${realm}/clients`;
  const auth = { Authorization: `Bearer ${adminToken}` };

  // Create client if missing (409 = already exists, both are fine).
  let list = await (await fetch(`${base}?clientId=${REALTIME_CLIENT_ID}`, { headers: auth })).json();
  if (!Array.isArray(list) || list.length === 0) {
    const r = await fetch(base, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: REALTIME_CLIENT_ID,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        serviceAccountsEnabled: true,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: false
      })
    });
    if (!r.ok && r.status !== 409) throw new Error(`Create client failed in ${realm}: ${r.status} ${await r.text()}`);
    list = await (await fetch(`${base}?clientId=${REALTIME_CLIENT_ID}`, { headers: auth })).json();
  }
  const clientUuid = list[0].id;
  const mappersBase = `${base}/${clientUuid}/protocol-mappers/models`;

  // Fetch existing mappers.
  const existingMappers = await (await fetch(mappersBase, { headers: auth })).json();
  const existingByName = Object.fromEntries((existingMappers ?? []).map((m) => [m.name, m]));

  // The workspace-ids-mapper must always reflect the current per-run workspace.
  // Delete it if it exists so we can recreate with the fresh value.
  if (existingByName['workspace-ids-mapper']) {
    const mapperId = existingByName['workspace-ids-mapper'].id;
    await fetch(`${mappersBase}/${mapperId}`, { method: 'DELETE', headers: auth });
    delete existingByName['workspace-ids-mapper'];
  }

  const desiredMappers = [
    {
      name: 'tenant-id-mapper',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.name': 'tenant_id',
        'claim.value': tenantId,
        'jsonType.label': 'String',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
        'userinfo.token.claim': 'false'
      }
    },
    {
      name: 'workspace-ids-mapper',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.name': 'workspace_ids',
        'claim.value': JSON.stringify([workspaceId]),
        'jsonType.label': 'JSON',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
        'userinfo.token.claim': 'false'
      }
    },
    {
      name: 'realtime-scopes-array-mapper',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.name': 'scopes',
        'claim.value': '["realtime:read"]',
        'jsonType.label': 'JSON',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
        'userinfo.token.claim': 'false'
      }
    }
  ];

  for (const mapper of desiredMappers) {
    if (existingByName[mapper.name]) continue; // already present and not stale
    const r = await fetch(mappersBase, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(mapper)
    });
    if (!r.ok && r.status !== 409) {
      throw new Error(`Mapper ${mapper.name} in ${realm} failed: ${r.status} ${await r.text()}`);
    }
  }

  // Get or generate client secret.
  let { value: secret } = await (await fetch(`${base}/${clientUuid}/client-secret`, { headers: auth })).json();
  if (!secret) {
    const gen = await (await fetch(`${base}/${clientUuid}/client-secret`, { method: 'POST', headers: auth })).json();
    secret = gen.value;
  }
  return secret;
}

async function mintToken(realm, secret) {
  const res = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: REALTIME_CLIENT_ID,
      client_secret: secret
    })
  });
  if (!res.ok) throw new Error(`Token mint failed for realm ${realm}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Fetch the current high-water offset for partition 0 of a topic. */
async function topicHighOffset(kafkaAdmin, topic) {
  try {
    const offsets = await kafkaAdmin.fetchTopicOffsets(topic);
    return Number(offsets[0]?.high ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Poll until the high-water offset of `topic` exceeds `startOffset`,
 * asserting that at least one new message was produced.
 * Uses simple offset polling — no consumer group / seek required.
 */
async function waitForOffsetAdvance(kafkaAdmin, topic, startOffset, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const high = await topicHighOffset(kafkaAdmin, topic);
    if (high > startOffset) return high;
    await new Promise((r) => setTimeout(r, 200));
  }
  const finalOffset = await topicHighOffset(kafkaAdmin, topic);
  if (finalOffset > startOffset) return finalOffset;
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for offset on ${topic} to advance past ${startOffset} (current: ${finalOffset})`
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe(
  'issue #221 fail-closed-realtime-auth-flag — REAL stack (Postgres + Keycloak + Redpanda)',
  { skip: !RUN ? 'tests/env not running (set FALCONE_TESTENV=1 via source tests/env/env.sh)' : false },
  () => {
    let pool;
    let kafka;
    let kafkaAdmin;
    let producer;

    // Env objects built from real stack values (auth enabled / disabled variants).
    let envAuthEnabled;  // REALTIME_AUTH_ENABLED=true, NODE_ENV=development
    let envDevBypass;    // REALTIME_AUTH_ENABLED=false, NODE_ENV=development

    // Real Keycloak tokens and actors.
    let tokenA;        // real JWT from tenant-A realm, carrying custom claims
    let tenantAId;     // tenant_id from the real token's claims (= TENANT_A)
    let actorA;        // sub from the real token

    // Seeded scope-mapping IDs (for cleanup).
    const seededMappingIds = [];

    before(async () => {
      // 1. Apply realtime-gateway migrations (idempotent: CREATE TABLE IF NOT EXISTS).
      pool = new Pool({ connectionString: DB_URL });
      for (const mig of [
        '001-create-realtime-scope-channel-mappings.sql',
        '002-create-realtime-subscription-auth-records.sql',
        '003-create-realtime-sessions.sql'
      ]) {
        const sql = await readFile(`${MIG_DIR}${mig}`, 'utf8');
        await pool.query(sql);
      }

      // 2. Provision tenant-A client in Keycloak with custom-claim mappers and mint token.
      const adminToken = await getAdminToken();
      const secretA = await ensureRealtimeClient(adminToken, TENANT_A, TENANT_A, WS_A);
      tokenA = await mintToken(TENANT_A, secretA);

      // Derive tenant identity from the REAL token's issuer (token → identity pattern).
      const payloadA = decodeJwtPayload(tokenA);
      tenantAId = payloadA.iss.split('/realms/')[1];
      actorA = payloadA.sub;
      assert.equal(tenantAId, TENANT_A, 'real token issuer must resolve to tenant A');

      // 3. Seed scope mapping for tenant A / WS_A (so checkScopes passes).
      const mappingA = await upsertScopeMapping(pool, {
        tenantId: TENANT_A,
        workspaceId: WS_A,
        scopeName: 'realtime:read',
        channelType: '*',
        createdBy: 'e2e-221'
      });
      seededMappingIds.push(mappingA.id);

      // 4. Connect Kafka / Redpanda.
      kafka = new Kafka({ clientId: `rta-e2e-221-${RUN_ID}`, brokers: BROKERS.split(','), logLevel: logLevel.NOTHING });
      kafkaAdmin = kafka.admin();
      await kafkaAdmin.connect();

      // Ensure audit topics exist (createTopics is idempotent when topic already exists).
      await kafkaAdmin.createTopics({
        topics: [
          { topic: 'console.realtime.auth-granted', numPartitions: 1, replicationFactor: 1 },
          { topic: 'console.realtime.auth-denied', numPartitions: 1, replicationFactor: 1 }
        ],
        waitForLeaders: true
      });

      producer = kafka.producer();
      await producer.connect();

      // 5. Build env objects from the live stack values.
      const baseEnvSource = {
        KEYCLOAK_JWKS_URL: `${KC}/realms/${TENANT_A}/protocol/openid-connect/certs`,
        KEYCLOAK_INTROSPECTION_URL: `${KC}/realms/${TENANT_A}/protocol/openid-connect/token/introspect`,
        KEYCLOAK_INTROSPECTION_CLIENT_ID: ADMIN_CLIENT,
        KEYCLOAK_INTROSPECTION_CLIENT_SECRET: ADMIN_SECRET,
        DATABASE_URL: DB_URL,
        KAFKA_BROKERS: BROKERS
      };
      envAuthEnabled = loadEnv({ ...baseEnvSource, REALTIME_AUTH_ENABLED: 'true', NODE_ENV: 'development' });
      envDevBypass = loadEnv({ ...baseEnvSource, REALTIME_AUTH_ENABLED: 'false', NODE_ENV: 'development' });
    });

    after(async () => {
      // Best-effort cleanup: delete seeded scope mappings and any test sessions.
      try {
        if (pool && seededMappingIds.length > 0) {
          await pool.query(
            `DELETE FROM realtime_scope_channel_mappings WHERE id = ANY($1::uuid[])`,
            [seededMappingIds]
          );
        }
        if (pool) {
          await pool.query(
            `DELETE FROM realtime_sessions WHERE actor_identity = $1`,
            [actorA]
          );
        }
      } catch { /* non-fatal */ }
      try { if (producer) await producer.disconnect(); } catch { /* noop */ }
      try { if (kafkaAdmin) await kafkaAdmin.disconnect(); } catch { /* noop */ }
      try { if (pool) await pool.end(); } catch { /* noop */ }
    });

    // -----------------------------------------------------------------------
    // S-A: loadEnv MUST throw when REALTIME_AUTH_ENABLED=false + NODE_ENV=production
    // -----------------------------------------------------------------------
    it('S-A: loadEnv throws config error when REALTIME_AUTH_ENABLED=false and NODE_ENV=production', () => {
      const source = {
        KEYCLOAK_JWKS_URL: `${KC}/realms/master/protocol/openid-connect/certs`,
        KEYCLOAK_INTROSPECTION_URL: `${KC}/realms/master/protocol/openid-connect/token/introspect`,
        KEYCLOAK_INTROSPECTION_CLIENT_ID: ADMIN_CLIENT,
        KEYCLOAK_INTROSPECTION_CLIENT_SECRET: ADMIN_SECRET,
        DATABASE_URL: DB_URL,
        KAFKA_BROKERS: BROKERS,
        REALTIME_AUTH_ENABLED: 'false',
        NODE_ENV: 'production'
      };
      assert.throws(
        () => loadEnv(source),
        (err) => {
          assert.ok(err instanceof Error, 'must throw an Error');
          assert.ok(
            err.message.includes('REALTIME_AUTH_ENABLED=false') &&
            err.message.toLowerCase().includes('production'),
            `error message must mention REALTIME_AUTH_ENABLED=false and production, got: ${err.message}`
          );
          return true;
        }
      );
    });

    // -----------------------------------------------------------------------
    // S-A': loadEnv succeeds when auth is enabled in production
    // -----------------------------------------------------------------------
    it("S-A': loadEnv returns successfully with REALTIME_AUTH_ENABLED=true and NODE_ENV=production", () => {
      const source = {
        KEYCLOAK_JWKS_URL: `${KC}/realms/master/protocol/openid-connect/certs`,
        KEYCLOAK_INTROSPECTION_URL: `${KC}/realms/master/protocol/openid-connect/token/introspect`,
        KEYCLOAK_INTROSPECTION_CLIENT_ID: ADMIN_CLIENT,
        KEYCLOAK_INTROSPECTION_CLIENT_SECRET: ADMIN_SECRET,
        DATABASE_URL: DB_URL,
        KAFKA_BROKERS: BROKERS,
        REALTIME_AUTH_ENABLED: 'true',
        NODE_ENV: 'production'
      };
      const env = loadEnv(source);
      assert.equal(env.REALTIME_AUTH_ENABLED, true, 'REALTIME_AUTH_ENABLED must be parsed as boolean true');
      assert.equal(env.NODE_ENV, 'production', 'NODE_ENV must be preserved as "production"');
    });

    // -----------------------------------------------------------------------
    // S-D: normal path — auth enabled, real token, real DB, real Kafka
    // -----------------------------------------------------------------------
    it('S-D: valid tenant-A token + seeded scope mapping → allowed:true with populated tenantId and GRANTED audit in Redpanda', async () => {
      const grantedTopic = 'console.realtime.auth-granted';
      const offsetBefore = await topicHighOffset(kafkaAdmin, grantedTopic);

      const envProvider = () => envAuthEnabled;
      const validateToken = createTokenValidator({ envProvider });
      const checkScopes = createScopeChecker({ envProvider });
      const publishAuthDecision = createAuditPublisher({ envProvider });
      const action = createValidateSubscriptionAuthAction({
        envProvider,
        validateTokenFn: validateToken,
        checkScopesFn: checkScopes,
        publishAuthDecisionFn: publishAuthDecision
      });

      const result = await action(
        { token: tokenA, workspaceId: WS_A, channelType: 'events', filter: null },
        { db: pool, kafka: { producer } }
      );

      // Functional assertions.
      assert.equal(result.allowed, true, 'action must allow a valid authenticated subscription');
      assert.ok(result.subscriptionContext, 'subscriptionContext must be present');
      assert.equal(
        result.subscriptionContext.tenantId,
        TENANT_A,
        'tenantId in subscriptionContext must be the real tenant A (not the dev-bypass sentinel)'
      );
      assert.notEqual(
        result.subscriptionContext.tenantId,
        'dev-bypass-tenant',
        'tenantId must not be the dev-bypass sentinel when auth is enabled'
      );
      assert.equal(result.subscriptionContext.workspaceId, WS_A, 'workspaceId must match the request');
      assert.ok(
        typeof result.subscriptionContext.actorIdentity === 'string' &&
        result.subscriptionContext.actorIdentity.length > 0,
        'actorIdentity must be a non-empty string'
      );

      // Kafka audit assertion: the granted-topic offset must advance (one new message produced).
      const offsetAfter = await waitForOffsetAdvance(kafkaAdmin, grantedTopic, offsetBefore);
      assert.ok(offsetAfter > offsetBefore, `realtime.auth-granted topic must have received a new audit message (before=${offsetBefore}, after=${offsetAfter})`);
    });

    // -----------------------------------------------------------------------
    // S-D2: invalid token → deny with no bypass, DENIED audit produced
    // -----------------------------------------------------------------------
    it('S-D2: garbage token + auth enabled → allowed:false and realtime.auth-denied audit in Redpanda', async () => {
      const deniedTopic = 'console.realtime.auth-denied';
      const offsetBefore = await topicHighOffset(kafkaAdmin, deniedTopic);

      const envProvider = () => envAuthEnabled;
      const validateToken = createTokenValidator({ envProvider });
      const checkScopes = createScopeChecker({ envProvider });
      const publishAuthDecision = createAuditPublisher({ envProvider });
      const action = createValidateSubscriptionAuthAction({
        envProvider,
        validateTokenFn: validateToken,
        checkScopesFn: checkScopes,
        publishAuthDecisionFn: publishAuthDecision
      });

      const result = await action(
        { token: 'garbage.invalid.token', workspaceId: WS_A, channelType: 'events', filter: null },
        { db: pool, kafka: { producer } }
      );

      assert.equal(result.allowed, false, 'invalid token must be denied');
      assert.ok(result.error?.code, 'a denial error code must be present');
      // Ensure the action did not accidentally return allowed:true via any bypass path.
      assert.notEqual(result.allowed, true, 'allowed must not be true for a garbage token');

      // DENIED audit message must have been produced (offset must advance).
      const offsetAfter = await waitForOffsetAdvance(kafkaAdmin, deniedTopic, offsetBefore);
      assert.ok(offsetAfter > offsetBefore, `realtime.auth-denied topic must have received a new audit message (before=${offsetBefore}, after=${offsetAfter})`);
    });

    // -----------------------------------------------------------------------
    // S-ISO: cross-tenant probe — tenant-A token must not reach tenant-B workspace
    // -----------------------------------------------------------------------
    it('S-ISO: tenant-A token requesting tenant-B workspace → allowed:false (workspace-access denial)', async () => {
      // WS_B is suffixed with the run ID but registered in the token as WS_A only.
      // tenant-A token's authorized workspaces = [WS_A]; WS_B is not included.
      const envProvider = () => envAuthEnabled;
      const validateToken = createTokenValidator({ envProvider });
      const checkScopes = createScopeChecker({ envProvider });
      const publishAuthDecision = createAuditPublisher({ envProvider });
      const action = createValidateSubscriptionAuthAction({
        envProvider,
        validateTokenFn: validateToken,
        checkScopesFn: checkScopes,
        publishAuthDecisionFn: publishAuthDecision
      });

      // WS_B is a workspace that belongs to tenant B — tenant A's token does not
      // list it in workspace_ids, so checkScopes must deny workspace access.
      const result = await action(
        { token: tokenA, workspaceId: WS_B, channelType: 'events', filter: null },
        { db: pool, kafka: { producer } }
      );

      assert.equal(result.allowed, false, 'tenant-A token must be denied access to tenant-B workspace');
      assert.ok(result.error?.code, 'a denial error code must be present');
      // Ensure no cross-tenant data leaks via subscriptionContext.
      assert.ok(!result.subscriptionContext, 'subscriptionContext must not be set on denial');
    });

    // -----------------------------------------------------------------------
    // S-DEV: dev-bypass path — auth disabled, development env
    // -----------------------------------------------------------------------
    it('S-DEV: auth disabled in development → allowed:true with non-empty dev-sentinel subscriptionContext (not {})', async () => {
      const envProvider = () => envDevBypass;
      // In dev bypass the token is ignored, but we still need db/kafka for the
      // action signature — we pass them even though the bypass exits early.
      const action = createValidateSubscriptionAuthAction({ envProvider });

      const result = await action(
        { token: 'does-not-matter', workspaceId: WS_A, channelType: 'events', filter: null },
        { db: pool, kafka: { producer } }
      );

      assert.equal(result.allowed, true, 'dev bypass must allow the subscription');
      assert.ok(result.subscriptionContext, 'subscriptionContext must be present (not missing)');
      assert.notDeepEqual(result.subscriptionContext, {}, 'subscriptionContext must not be an empty object (regression: old code returned {})');
      assert.ok(
        typeof result.subscriptionContext.tenantId === 'string' &&
        result.subscriptionContext.tenantId.length > 0,
        'subscriptionContext.tenantId must be a non-empty string in dev bypass'
      );
      assert.equal(
        result.subscriptionContext.tenantId,
        'dev-bypass-tenant',
        'dev bypass tenantId must be the labelled sentinel "dev-bypass-tenant"'
      );
      assert.ok(
        typeof result.subscriptionContext.actorIdentity === 'string' &&
        result.subscriptionContext.actorIdentity.length > 0,
        'dev bypass actorIdentity must be a non-empty string'
      );
    });
  }
);
