/**
 * REAL-STACK integration test for issue #214 — bind-event-publish-topic-to-tenant.
 *
 * The event-gateway ships as pure validation logic with no in-repo HTTP server or
 * UI, so a user-facing Playwright E2E is not applicable. Instead this exercises the
 * fix against the REAL backing stack the system actually uses (tests/env):
 *   - Keycloak (internal IdP) : realm name == tenantId. We provision a per-tenant
 *     service-account client, mint a REAL OIDC token from each tenant realm, and
 *     DERIVE context.tenantId from the token's `iss` claim (token -> identity).
 *   - Redpanda (Kafka)        : we produce to a REAL topic ONLY when the gateway
 *     accepts the publish, then assert the topic's message count via real broker
 *     offsets. A blocked (403) publish must leave the topic empty.
 *
 * Tenant identity is real (Keycloak realm via token). Workspace is a logical
 * sub-scope attached to the caller context — Keycloak models tenants as realms;
 * per-workspace scoping is exactly what the validator under test enforces.
 *
 * Gated on the test environment:
 *   bash tests/e2e/stack.sh up && source tests/env/env.sh \
 *     && node --test tests/e2e/issues/bind-event-publish-topic-to-tenant.realstack.test.mjs
 *
 * Acceptance scenarios (issue #214 / spec bind-event-publish-topic-to-tenant):
 *   S1 cross-tenant topic            -> 403 EVT_GATEWAY_FORBIDDEN, 0 messages
 *   S2 cross-workspace topic         -> 403 EVT_GATEWAY_FORBIDDEN, 0 messages
 *   S3 spoofed request-body tenantId -> 403 EVT_GATEWAY_FORBIDDEN, 0 messages
 *   S4 same-tenant same-workspace    -> 202 accepted, 1 message produced
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { Kafka, logLevel } from 'kafkajs';

import {
  buildEventGatewayPublishRequest,
  normalizeEventGatewayError
} from '../../../packages/event-gateway/src/runtime.mjs';

const KC = process.env.KEYCLOAK_BASE_URL;
const ADMIN_CLIENT = process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'falcone-admin';
const ADMIN_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || 'falcone-admin-secret';
const TENANT_A = process.env.TESTENV_TENANT_A;
const TENANT_B = process.env.TESTENV_TENANT_B;
const BROKERS = process.env.KAFKA_BROKERS;

const RUN = process.env.FALCONE_TESTENV === '1' && !!KC && !!BROKERS && !!TENANT_A && !!TENANT_B;

// Unique per-run suffix so topics never collide across reruns (idempotent).
const RUN_ID = `r${Date.now().toString(36)}`;
const EVENTS_CLIENT_ID = 'falcone-events';

function decodeJwtPayload(token) {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function getServiceAccountToken(realm, clientId, clientSecret) {
  const res = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  });
  if (!res.ok) throw new Error(`token request failed for realm ${realm}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// Ensure a confidential service-account client exists in the tenant realm and
// return its (real) secret, so we can mint a genuine per-tenant token.
async function ensureEventsClient(adminToken, realm) {
  const base = `${KC}/admin/realms/${realm}/clients`;
  const auth = { Authorization: `Bearer ${adminToken}` };

  let list = await (await fetch(`${base}?clientId=${EVENTS_CLIENT_ID}`, { headers: auth })).json();
  if (!Array.isArray(list) || list.length === 0) {
    const res = await fetch(base, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: EVENTS_CLIENT_ID,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        serviceAccountsEnabled: true,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: false
      })
    });
    if (!res.ok && res.status !== 409) throw new Error(`create client failed in ${realm}: ${res.status} ${await res.text()}`);
    list = await (await fetch(`${base}?clientId=${EVENTS_CLIENT_ID}`, { headers: auth })).json();
  }
  const clientUuid = list[0].id;

  let secret = (await (await fetch(`${base}/${clientUuid}/client-secret`, { headers: auth })).json()).value;
  if (!secret) {
    secret = (await (await fetch(`${base}/${clientUuid}/client-secret`, { method: 'POST', headers: auth })).json()).value;
  }
  return secret;
}

function validRequest(overrides = {}) {
  return {
    tenantId: TENANT_A,
    workspaceId: 'ws-1',
    channel: 'orders.placed',
    eventType: 'orders.placed',
    contentType: 'application/json',
    payloadEncoding: 'json',
    payload: { orderId: 'ord-001' },
    key: 'ord-001',
    ...overrides
  };
}

function topicDescriptor({ resourceId, tenantId, workspaceId }) {
  return {
    resourceId,
    tenantId,
    workspaceId,
    allowedTransports: ['http_publish', 'sse', 'websocket'],
    partitionStrategy: 'producer_key',
    partitionCount: 1,
    replayWindowHours: 24,
    partitionSelectionPolicy: 'caller_hint'
  };
}

describe('issue #214 bind-event-publish-topic-to-tenant — REAL stack (Keycloak + Redpanda)', { skip: !RUN ? 'tests/env not running (set FALCONE_TESTENV=1 via source tests/env/env.sh)' : false }, () => {
  let kafka;
  let admin;
  let producer;
  let ctxA; // caller context derived from a REAL tenant-A token
  let tenantAFromToken;
  let tenantBFromToken;

  // Distinct physical topics per scenario so message counts are unambiguous.
  const phys = {
    s1_otherTenant: `evt.${TENANT_B}.ws-2.s1.${RUN_ID}`,
    s2_otherWs: `evt.${TENANT_A}.ws-2.s2.${RUN_ID}`,
    s3_spoof: `evt.${TENANT_A}.ws-1.s3.${RUN_ID}`,
    s4_happy: `evt.${TENANT_A}.ws-1.s4.${RUN_ID}`
  };

  // Attempt a publish through the gateway; produce to the real topic ONLY if accepted.
  async function attemptPublish({ context, topic, request, physicalTopic }) {
    const result = buildEventGatewayPublishRequest({ context, topic, request });
    if (result.ok) {
      await producer.send({
        topic: physicalTopic,
        messages: [{ key: String(result.request.key ?? ''), value: JSON.stringify(result.request) }]
      });
      return { httpStatus: 202, ok: true };
    }
    const mapped = normalizeEventGatewayError({ errorClass: result.errorClass });
    return { httpStatus: mapped.status, code: mapped.code, ok: false, errorClass: result.errorClass };
  }

  async function topicMessageCount(topic) {
    const offsets = await admin.fetchTopicOffsets(topic);
    return offsets.reduce((sum, p) => sum + (Number(p.high) - Number(p.low)), 0);
  }

  before(async () => {
    // 1) Real admin token from the master realm.
    const adminToken = await getServiceAccountToken('master', ADMIN_CLIENT, ADMIN_SECRET);

    // 2) Provision per-tenant clients and mint REAL per-tenant tokens.
    const secretA = await ensureEventsClient(adminToken, TENANT_A);
    const secretB = await ensureEventsClient(adminToken, TENANT_B);
    const tokenA = await getServiceAccountToken(TENANT_A, EVENTS_CLIENT_ID, secretA);
    const tokenB = await getServiceAccountToken(TENANT_B, EVENTS_CLIENT_ID, secretB);

    // 3) DERIVE tenant identity from the real token's issuer (token -> identity).
    tenantAFromToken = decodeJwtPayload(tokenA).iss.split('/realms/')[1];
    tenantBFromToken = decodeJwtPayload(tokenB).iss.split('/realms/')[1];
    assert.equal(tenantAFromToken, TENANT_A, 'tenant A identity must come from the real token issuer');
    assert.equal(tenantBFromToken, TENANT_B, 'tenant B identity must come from the real token issuer');

    // Caller context for all scenarios: authenticated as tenant A, workspace ws-1.
    ctxA = { tenantId: tenantAFromToken, workspaceId: 'ws-1', planId: 'pln_01growth', token: tokenA };

    // 4) Real Redpanda: connect and create the per-scenario topics.
    kafka = new Kafka({ clientId: 'evt-gateway-e2e-214', brokers: BROKERS.split(','), logLevel: logLevel.NOTHING });
    admin = kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: Object.values(phys).map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })),
      waitForLeaders: true
    });
    producer = kafka.producer();
    await producer.connect();
  });

  after(async () => {
    try { if (admin) await admin.deleteTopics({ topics: Object.values(phys) }); } catch { /* delete.topic.enable may be off; harmless */ }
    try { if (producer) await producer.disconnect(); } catch { /* noop */ }
    try { if (admin) await admin.disconnect(); } catch { /* noop */ }
  });

  it('S1: publish to a topic owned by ANOTHER tenant -> 403 EVT_GATEWAY_FORBIDDEN and 0 messages on real topic', async () => {
    const topic = topicDescriptor({ resourceId: phys.s1_otherTenant, tenantId: tenantBFromToken, workspaceId: 'ws-2' });
    const res = await attemptPublish({ context: ctxA, topic, request: validRequest(), physicalTopic: phys.s1_otherTenant });
    assert.equal(res.ok, false, 'cross-tenant publish must be rejected');
    assert.equal(res.httpStatus, 403, 'expected HTTP 403');
    assert.equal(res.code, 'EVT_GATEWAY_FORBIDDEN', 'expected EVT_GATEWAY_FORBIDDEN');
    assert.equal(await topicMessageCount(phys.s1_otherTenant), 0, "tenant B's topic must have received no event");
  });

  it('S2: publish to a topic in ANOTHER workspace (same tenant) -> 403 and 0 messages', async () => {
    const topic = topicDescriptor({ resourceId: phys.s2_otherWs, tenantId: tenantAFromToken, workspaceId: 'ws-2' });
    const res = await attemptPublish({ context: ctxA, topic, request: validRequest(), physicalTopic: phys.s2_otherWs });
    assert.equal(res.ok, false, 'cross-workspace publish must be rejected');
    assert.equal(res.httpStatus, 403, 'expected HTTP 403');
    assert.equal(res.code, 'EVT_GATEWAY_FORBIDDEN', 'expected EVT_GATEWAY_FORBIDDEN');
    assert.equal(await topicMessageCount(phys.s2_otherWs), 0, 'cross-workspace topic must have received no event');
  });

  it('S3: spoofed request-body tenantId (another tenant) -> 403 and 0 messages', async () => {
    const topic = topicDescriptor({ resourceId: phys.s3_spoof, tenantId: tenantAFromToken, workspaceId: 'ws-1' });
    const res = await attemptPublish({
      context: ctxA,
      topic,
      request: validRequest({ tenantId: tenantBFromToken }), // body claims tenant B; context is tenant A
      physicalTopic: phys.s3_spoof
    });
    assert.equal(res.ok, false, 'spoofed-body publish must be rejected');
    assert.equal(res.httpStatus, 403, 'expected HTTP 403');
    assert.equal(res.code, 'EVT_GATEWAY_FORBIDDEN', 'expected EVT_GATEWAY_FORBIDDEN');
    assert.equal(await topicMessageCount(phys.s3_spoof), 0, 'spoofed-body request must not produce any event');
  });

  it('S4: same-tenant same-workspace publish -> 202 accepted and exactly 1 message on real topic', async () => {
    const topic = topicDescriptor({ resourceId: phys.s4_happy, tenantId: tenantAFromToken, workspaceId: 'ws-1' });
    const res = await attemptPublish({ context: ctxA, topic, request: validRequest(), physicalTopic: phys.s4_happy });
    assert.equal(res.ok, true, 'legitimate same-tenant publish must be accepted');
    assert.equal(res.httpStatus, 202, 'expected HTTP 202');
    assert.equal(await topicMessageCount(phys.s4_happy), 1, 'accepted event must land on the tenant/workspace topic exactly once');
  });
});
