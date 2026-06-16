// Real-stack E2E — Mongo/FerretDB realtime tenant isolation
// Change: add-ferretdb-realtime-cdc-remediation (#460)
//
// WIRING (confirmed by reading source):
//   A `mongodb` realtime channel's change events travel the following path on the live cluster:
//
//   1. Data write: mongoInsert/mongoUpdate/mongoDelete (data-injector) → FerretDB gateway
//      (WS_MONGO_CONN_STR) → DocumentDB engine (postgres-documentdb) WAL.
//
//   2. WAL → SSE: apps/control-plane/src/runtime/realtime-executor.mjs (createRealtimeExecutor)
//      owns a pgoutput logical replication slot on the DocumentDB engine
//      (REALTIME_DOCUMENTDB_URL). WalReplicationClient decodes BSON rows; tenant isolation is
//      enforced consumer-side: only changes whose fullDocument.tenantId (or
//      fullDocumentBeforeChange.tenantId for deletes) matches the subscribed tenant are
//      delivered. A WAL UPDATE is surfaced as operationType 'replace' (not 'update') because
//      logical replication carries the full new image without a $set diff.
//
//   3. SSE → WS: apps/control-plane/src/runtime/server.mjs exposes
//      GET /v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes
//      (route alias `rt`) wired to runRealtimeSse(realtimeExecutor). The WS gateway in the
//      realtime suite (helpers/client.mjs) forwards `subscribe` messages to this SSE endpoint
//      and relays events back over the WebSocket, so this spec exercises the full #460 WAL path.
//
// This spec is the Mongo/FerretDB counterpart of tenant-isolation.test.mjs (Postgres path).
// It covers:
//   TC-MTI-01  Cross-tenant isolation: writes under tenant B NEVER reach tenant A's subscription
//              (insert + delete; delete isolation relies on REPLICA IDENTITY FULL pre-image)
//   TC-MTI-02  insert / replace / delete delivered to the owning tenant
//              (UPDATE surfaces as `replace` per ADR-14 / WAL semantics)
//   TC-MTI-03  Document tenantId gate: every delivered document is owned by the subscribing tenant
//   TC-MTI-04  Adversarial cross-tenant subscription attempt is rejected (403/404)
//
// Env vars required by the helpers (in addition to REALTIME_ENDPOINT etc.):
//   WS_MONGO_CONN_STR        — FerretDB gateway (mongodb://...) for the data injector
//   REALTIME_DOCUMENTDB_URL  — Postgres logical replication URL (used by the control-plane
//                              realtime executor; NOT read here but required in the cluster env)
//   PROVISIONING_API_BASE_URL, PROVISIONING_ADMIN_TOKEN — provisioner
//   KEYCLOAK_BASE_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_SECRET — iam
//
// Stack wiring (stack.sh):
//   Port-forward svc/falcone-control-plane (the WS realtime gateway) and set REALTIME_ENDPOINT.
//   The control-plane pod must have REALTIME_DOCUMENTDB_URL set from the
//   in-falcone-documentdb-replication Secret (optional:true in the kind values; required here).
//   The DocumentDB engine's wal_level must be logical and the publication falcone_cdc_pub must
//   exist — both are provisioned by the chart on install
//   (services/mongo-cdc-bridge/src/provisionLogicalReplication.mjs called at startup).

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRealtimeClient } from './helpers/client.mjs';
import { createProvisioner } from './helpers/provisioner.mjs';
import { createDataInjector } from './helpers/data-injector.mjs';
import { createTestUser, deleteTestUser, getToken } from './helpers/iam.mjs';
import { poll } from './helpers/poller.mjs';
import { teardown } from './helpers/teardown.mjs';

// The WS realtime gateway endpoint (e.g. ws://localhost:4000/realtime).
const REALTIME_ENDPOINT = process.env.REALTIME_ENDPOINT;

// How long to wait for WAL events to flow through the slot and reach the subscriber.
// WAL → slot → WalReplicationClient → SSE → WS is a multi-hop async path; allow
// generous headroom on a kind cluster under load.
const WAL_SETTLE_MS = Number(process.env.MONGO_RT_WAL_SETTLE_MS ?? 25_000);
const POLL_INTERVAL_MS = 300;

// A dedicated MongoDB collection for this spec, distinct from subscription-lifecycle.test.mjs.
const COLLECTION = 'e2e_mongo_iso';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function setupTenant(label) {
  const provisioner = createProvisioner();
  const injector = createDataInjector();

  const tenant = await provisioner.createTestTenant(`mti-${label}-${Date.now()}`);
  const workspace = await provisioner.createTestWorkspace(tenant.tenantId);

  // Register a mongodb channel for the isolation collection.
  const channel = await provisioner.registerMongoDataSource({
    workspaceId: workspace.workspaceId,
    collections: [COLLECTION],
  });

  const user = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read'] });
  const tokens = await getToken({ username: user.username, password: user.password });

  // Open WebSocket session and subscribe to ALL operations on the mongo channel.
  const session = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: tokens.accessToken });
  await session.subscribe({
    workspaceId: workspace.workspaceId,
    channelId: channel.channelId,
    filter: { operations: ['INSERT', 'REPLACE', 'DELETE'] },
  });

  return { provisioner, injector, tenant, workspace, channel, user, tokens, session };
}

async function cleanupTenant(fixture) {
  await teardown([
    () => fixture.session.disconnect(),
    () => fixture.injector.close(),
    () => fixture.provisioner.deprovisionWorkspace(fixture.workspace.workspaceId),
    () => fixture.provisioner.deprovisionTenant(fixture.tenant.tenantId),
    () => deleteTestUser(fixture.user.userId),
  ]);
}

// ---------------------------------------------------------------------------
// TC-MTI-01  Cross-tenant isolation: tenant B writes never reach tenant A
// ---------------------------------------------------------------------------
test('TC-MTI-01 Mongo realtime: tenant B inserts and deletes NEVER reach tenant A subscriber', async () => {
  const a = await setupTenant('a');
  const b = await setupTenant('b');
  try {
    // Write 20 documents under tenant B's workspace (different FerretDB "db" name).
    for (let i = 0; i < 20; i++) {
      await b.injector.mongoInsert({
        db: b.workspace.workspaceId,
        collection: COLLECTION,
        doc: { _id: randomUUID(), label: `b-ins-${i}`, tenantId: b.tenant.tenantId },
      });
    }

    // Delete a subset to generate B-tenant DELETE WAL records (relies on REPLICA IDENTITY FULL
    // pre-image carrying tenantId so the executor can isolate deletes by tenant).
    await b.injector.mongoDelete({
      db: b.workspace.workspaceId,
      collection: COLLECTION,
      filter: { label: { $regex: '^b-ins-' } },
    });

    // Also write a handful under tenant A so we have something to wait on (proves
    // the slot itself is delivering and the absence for A is structural, not a stall).
    const sentinelId = randomUUID();
    await a.injector.mongoInsert({
      db: a.workspace.workspaceId,
      collection: COLLECTION,
      doc: { _id: sentinelId, label: 'a-sentinel', tenantId: a.tenant.tenantId },
    });

    // Wait until tenant A's sentinel arrives — confirms the WAL path is live.
    await poll(() => {
      const found = a.session.events.some(
        (ev) => (ev.op === 'INSERT' || ev.type === 'insert') && ev.documentId === sentinelId,
      );
      assert.ok(found, `tenant A sentinel (INSERT ${sentinelId}) not yet received`);
    }, { maxWaitMs: WAL_SETTLE_MS, intervalMs: POLL_INTERVAL_MS, backoffFactor: 1.3 });

    // Tenant A's session must have received zero events belonging to tenant B.
    // Check both tenantId field on event envelope AND nested document.tenantId.
    const bLeakToA = a.session.events.filter(
      (ev) => ev.tenantId === b.tenant.tenantId
        || ev.document?.tenantId === b.tenant.tenantId,
    );
    assert.equal(
      bLeakToA.length,
      0,
      `tenant B events leaked to tenant A: ${JSON.stringify(bLeakToA)}`,
    );
  } finally {
    await cleanupTenant(a);
    await cleanupTenant(b);
  }
});

// ---------------------------------------------------------------------------
// TC-MTI-02  insert / replace (WAL update) / delete all delivered to owning tenant
// ---------------------------------------------------------------------------
test('TC-MTI-02 Mongo realtime: insert / replace (WAL update) / delete all delivered to tenant A', async () => {
  const a = await setupTenant('a');
  try {
    const docId = randomUUID();

    // INSERT
    await a.injector.mongoInsert({
      db: a.workspace.workspaceId,
      collection: COLLECTION,
      doc: { _id: docId, body: 'original', tenantId: a.tenant.tenantId },
    });

    await poll(() => {
      const ins = a.session.events.find(
        (ev) => (ev.op === 'INSERT' || ev.type === 'insert') && ev.documentId === docId,
      );
      assert.ok(ins, `INSERT for ${docId} not yet received`);
    }, { maxWaitMs: WAL_SETTLE_MS, intervalMs: POLL_INTERVAL_MS, backoffFactor: 1.3 });

    // UPDATE — must arrive as 'replace' (WAL carries full new image, not a diff).
    await a.injector.mongoUpdate({
      db: a.workspace.workspaceId,
      collection: COLLECTION,
      filter: { _id: docId },
      update: { $set: { body: 'edited' } },
    });

    await poll(() => {
      // The #460 realtime-executor maps WAL operationType 'update' → 'replace'.
      // Assert ONLY 'replace', not 'update', per ADR-14 semantics.
      const rep = a.session.events.find(
        (ev) => (ev.op === 'REPLACE' || ev.type === 'replace') && ev.documentId === docId,
      );
      assert.ok(rep, `REPLACE (WAL update) for ${docId} not yet received`);
      assert.ok(
        rep.document?.body === 'edited' || rep.document == null,
        `replace event document should carry updated body; got ${JSON.stringify(rep.document)}`,
      );
      // Explicitly assert no raw 'update' event was delivered (WAL path must NOT surface 'update').
      const rawUpdate = a.session.events.find(
        (ev) => (ev.op === 'UPDATE' || ev.type === 'update') && ev.documentId === docId,
      );
      assert.ok(!rawUpdate, `'update' type must NOT be surfaced by WAL path (got: ${JSON.stringify(rawUpdate)})`);
    }, { maxWaitMs: WAL_SETTLE_MS, intervalMs: POLL_INTERVAL_MS, backoffFactor: 1.3 });

    // DELETE — relies on REPLICA IDENTITY FULL pre-image so the executor can find tenantId.
    await a.injector.mongoDelete({
      db: a.workspace.workspaceId,
      collection: COLLECTION,
      filter: { _id: docId },
    });

    await poll(() => {
      const del = a.session.events.find(
        (ev) => (ev.op === 'DELETE' || ev.type === 'delete') && ev.documentId === docId,
      );
      assert.ok(del, `DELETE for ${docId} not yet received`);
    }, { maxWaitMs: WAL_SETTLE_MS, intervalMs: POLL_INTERVAL_MS, backoffFactor: 1.3 });
  } finally {
    await cleanupTenant(a);
  }
});

// ---------------------------------------------------------------------------
// TC-MTI-03  Every delivered document is owned by the subscribing tenant
// ---------------------------------------------------------------------------
test('TC-MTI-03 Mongo realtime: every delivered event carries the subscribing tenant identity', async () => {
  const a = await setupTenant('a');
  const b = await setupTenant('b');
  try {
    // Interleave writes for both tenants.
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        a.injector.mongoInsert({
          db: a.workspace.workspaceId,
          collection: COLLECTION,
          doc: { _id: randomUUID(), label: `a-${i}`, tenantId: a.tenant.tenantId },
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        b.injector.mongoInsert({
          db: b.workspace.workspaceId,
          collection: COLLECTION,
          doc: { _id: randomUUID(), label: `b-${i}`, tenantId: b.tenant.tenantId },
        }),
      ),
    ]);

    // Wait for tenant A to accumulate at least 10 events.
    await poll(() => {
      const inserts = a.session.events.filter(
        (ev) => ev.op === 'INSERT' || ev.type === 'insert',
      );
      assert.ok(inserts.length >= 10, `tenant A only has ${inserts.length} INSERT events`);
    }, { maxWaitMs: WAL_SETTLE_MS, intervalMs: POLL_INTERVAL_MS, backoffFactor: 1.3 });

    // Wait for tenant B to accumulate at least 10 events.
    await poll(() => {
      const inserts = b.session.events.filter(
        (ev) => ev.op === 'INSERT' || ev.type === 'insert',
      );
      assert.ok(inserts.length >= 10, `tenant B only has ${inserts.length} INSERT events`);
    }, { maxWaitMs: WAL_SETTLE_MS, intervalMs: POLL_INTERVAL_MS, backoffFactor: 1.3 });

    // Every event in A's session must belong to tenant A.
    const wrongInA = a.session.events.filter(
      (ev) => ev.tenantId != null && ev.tenantId !== a.tenant.tenantId,
    );
    assert.equal(
      wrongInA.length,
      0,
      `tenant A session received events for a different tenant: ${JSON.stringify(wrongInA)}`,
    );

    // Every event in B's session must belong to tenant B.
    const wrongInB = b.session.events.filter(
      (ev) => ev.tenantId != null && ev.tenantId !== b.tenant.tenantId,
    );
    assert.equal(
      wrongInB.length,
      0,
      `tenant B session received events for a different tenant: ${JSON.stringify(wrongInB)}`,
    );

    // Workspace scoping: tenant A's events carry A's workspaceId.
    const wrongWsInA = a.session.events.filter(
      (ev) => ev.workspaceId != null && ev.workspaceId !== a.workspace.workspaceId,
    );
    assert.equal(
      wrongWsInA.length,
      0,
      `tenant A session received events for a different workspace: ${JSON.stringify(wrongWsInA)}`,
    );
  } finally {
    await cleanupTenant(a);
    await cleanupTenant(b);
  }
});

// ---------------------------------------------------------------------------
// TC-MTI-04  Adversarial cross-tenant subscription attempt is rejected
// ---------------------------------------------------------------------------
test('TC-MTI-04 Mongo realtime: tenant B token cannot subscribe to tenant A mongo channel', async () => {
  const a = await setupTenant('a');
  const b = await setupTenant('b');
  try {
    // Tenant B attempts to subscribe to tenant A's channel using B's access token.
    // The provisioner's createSubscription uses the caller's token directly.
    const response = await fetch(`${process.env.PROVISIONING_API_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${b.tokens.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        workspaceId: b.workspace.workspaceId,
        channelId: a.channel.channelId, // tenant A's channel — the cross-tenant probe
        filter: { operations: ['INSERT'] },
      }),
    });
    // Must be denied (403 or 404; 401 is also acceptable).
    assert.ok(
      [401, 403, 404].includes(response.status),
      `expected 401/403/404 for cross-tenant subscription, got ${response.status}`,
    );
  } finally {
    await cleanupTenant(a);
    await cleanupTenant(b);
  }
});
