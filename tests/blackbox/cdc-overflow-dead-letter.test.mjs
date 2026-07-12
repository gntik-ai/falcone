/**
 * Black-box tests for CDC overflow buffer + dead-letter routing
 * (add-cdc-overflow-dead-letter, issue #270).
 *
 * Tests drive the public exported API of KafkaChangePublisher (pg-cdc-bridge only)
 * via a fake kafka producer that RECORDS send() calls by topic, and a fake
 * metricsCollector recording increment()/set(). No internal knowledge is assumed
 * beyond observing publisher.overflowBuffers depth, recorded sends, and metrics.
 *
 * bbx-cdc-overflow-no-silent-drop: with maxEventsPerSecond=1 and overflowBufferSize=1,
 *   publishing 3 events for one (tenant,workspace) accounts for every event — 1 to the
 *   primary topic, 1 in the overflow buffer, 1 to the DLQ topic; none silently dropped.
 * bbx-cdc-dlq-tenant-namespace: the DLQ topic name is exactly
 *   `${prefix}.${tenantId}.${workspaceId}.pg-changes.dlq` and never omits tenant/workspace.
 * bbx-cdc-overflow-drain: a buffered event is drained to the PRIMARY topic BEFORE the
 *   live event once rate capacity recovers (deterministic via Date.now monkey-patch).
 * bbx-cdc-overflow-metrics: pg_cdc_events_overflow_buffered_total set on enqueue;
 *   pg_cdc_events_dlq_total incremented on DLQ publish.
 * bbx-cdc-overflow-audit-event: a `console.pg-cdc.overflow` audit message with the
 *   correct tenantId/workspaceId is emitted when an event reaches the DLQ.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KafkaChangePublisher,
} from '../../packages/pg-cdc-bridge/src/KafkaChangePublisher.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake kafka object that records sent messages (by topic). */
function fakeKafka() {
  const sent = [];
  return {
    sent,
    producerObj: {
      connect: async () => {},
      send: async (payload) => { sent.push(payload); },
      disconnect: async () => {},
    },
  };
}

/** Fake metricsCollector recording increment()/set() calls. */
function fakeMetrics() {
  const increments = [];
  const sets = [];
  return {
    increments,
    sets,
    increment: (name, labels) => { increments.push({ name, labels }); },
    set: (name, labels, value) => { sets.push({ name, labels, value }); },
  };
}

/** Minimal valid decoded event. */
function fakeEvent() {
  return {
    type: 'insert',
    relation: { namespace: 'public', relationName: 'items' },
    newRow: { id: '1' },
    sequence: 0,
  };
}

/** Publish one event for the given tenant+workspace; returns the result. */
async function pub(publisher, tenantId, workspaceId) {
  return publisher.publish(
    { id: `cfg-${tenantId}-${workspaceId}`, tenant_id: tenantId, workspace_id: workspaceId, data_source_ref: 'db-test' },
    fakeEvent(),
    '0/1',
    new Date().toISOString()
  );
}

/** Count recorded sends to a given topic. */
function sendsTo(fk, topic) {
  return fk.sent.filter((p) => p.topic === topic);
}

/** Current overflow-buffer depth for a composite key. */
function bufDepth(publisher, key) {
  const arr = publisher.overflowBuffers?.get(key);
  return arr ? arr.length : 0;
}

// ===========================================================================
// bbx-cdc-overflow-no-silent-drop
// ===========================================================================
test('bbx-cdc-overflow-no-silent-drop: 3 events → 1 primary, 1 buffered, 1 DLQ — none dropped', async () => {
  const fk = fakeKafka();
  const prevPrefix = process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
  delete process.env.PG_CDC_KAFKA_TOPIC_PREFIX;

  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 1, overflowBufferSize: 1 });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 5_000_000;
  Date.now = () => fakeNow;

  try {
    const tenant = 'ten_A';
    const workspace = 'wrk_A';
    const primaryTopic = 'ten_A.wrk_A.pg-changes';
    const dlqTopic = 'ten_A.wrk_A.pg-changes.dlq';
    const compositeKey = `${tenant}:${workspace}`;

    // Event 1: allowed → primary topic.
    await pub(publisher, tenant, workspace);
    // Event 2: rate-limited, buffer has capacity (size 1) → buffered.
    await pub(publisher, tenant, workspace);
    // Event 3: rate-limited, buffer full → DLQ.
    await pub(publisher, tenant, workspace);

    const primarySends = sendsTo(fk, primaryTopic);
    const dlqSends = sendsTo(fk, dlqTopic);

    assert.equal(primarySends.length, 1, `expected exactly 1 primary send; got ${primarySends.length}`);
    assert.equal(bufDepth(publisher, compositeKey), 1, `expected exactly 1 buffered event; got ${bufDepth(publisher, compositeKey)}`);
    assert.equal(dlqSends.length, 1, `expected exactly 1 DLQ send; got ${dlqSends.length}`);

    // Accounting: every one of the 3 events landed somewhere observable.
    const accounted = primarySends.length + bufDepth(publisher, compositeKey) + dlqSends.length;
    assert.equal(accounted, 3, `all 3 events must be accounted for; got ${accounted}`);
  } finally {
    Date.now = prevDateNow;
    if (prevPrefix !== undefined) process.env.PG_CDC_KAFKA_TOPIC_PREFIX = prevPrefix;
    await publisher.disconnect();
  }
});

// ===========================================================================
// bbx-cdc-dlq-tenant-namespace
// ===========================================================================
test('bbx-cdc-dlq-tenant-namespace: DLQ topic is `${prefix}.${tenant}.${workspace}.pg-changes.dlq`', async () => {
  const fk = fakeKafka();
  const prevPrefix = process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
  process.env.PG_CDC_KAFKA_TOPIC_PREFIX = 'console';

  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 1, overflowBufferSize: 0 });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 6_000_000;
  Date.now = () => fakeNow;

  try {
    const tenant = 'ten_A';
    const workspace = 'wrk_A';
    const expectedDlq = 'console.ten_A.wrk_A.pg-changes.dlq';

    // Event 1: allowed → primary. Event 2: rate-limited, bufferSize 0 → DLQ immediately.
    await pub(publisher, tenant, workspace);
    await pub(publisher, tenant, workspace);

    const dlqSends = sendsTo(fk, expectedDlq);
    assert.equal(dlqSends.length, 1, `expected DLQ topic "${expectedDlq}"; sent topics: ${fk.sent.map((p) => p.topic).join(', ')}`);

    // The DLQ topic must never omit tenant or workspace segments.
    assert.ok(expectedDlq.includes(tenant), 'DLQ topic must include tenantId');
    assert.ok(expectedDlq.includes(workspace), 'DLQ topic must include workspaceId');
    // No variant omitting tenant or workspace was used.
    for (const p of fk.sent) {
      if (p.topic.endsWith('.pg-changes.dlq')) {
        assert.ok(p.topic.includes(tenant), `DLQ send topic "${p.topic}" must include tenantId`);
        assert.ok(p.topic.includes(workspace), `DLQ send topic "${p.topic}" must include workspaceId`);
      }
    }
  } finally {
    Date.now = prevDateNow;
    if (prevPrefix !== undefined) process.env.PG_CDC_KAFKA_TOPIC_PREFIX = prevPrefix;
    else delete process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
    await publisher.disconnect();
  }
});

// ===========================================================================
// bbx-cdc-overflow-drain
// ===========================================================================
test('bbx-cdc-overflow-drain: buffered event drains to PRIMARY before the live event when capacity recovers', async () => {
  const fk = fakeKafka();
  const prevPrefix = process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
  delete process.env.PG_CDC_KAFKA_TOPIC_PREFIX;

  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 1, overflowBufferSize: 4 });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 7_000_000;
  Date.now = () => fakeNow;

  try {
    const tenant = 'ten_A';
    const workspace = 'wrk_A';
    const primaryTopic = 'ten_A.wrk_A.pg-changes';
    const compositeKey = `${tenant}:${workspace}`;

    // t0: event 1 allowed → primary (the "first" live event).
    await publisher.publish(
      { id: 'cfg-first', tenant_id: tenant, workspace_id: workspace, data_source_ref: 'db-test' },
      { type: 'insert', relation: { namespace: 'public', relationName: 'first' }, newRow: { id: '1' }, sequence: 1 },
      '0/1',
      new Date(fakeNow).toISOString()
    );
    // t0: event 2 rate-limited → buffered (the "buffered" event).
    await publisher.publish(
      { id: 'cfg-buffered', tenant_id: tenant, workspace_id: workspace, data_source_ref: 'db-test' },
      { type: 'insert', relation: { namespace: 'public', relationName: 'buffered' }, newRow: { id: '2' }, sequence: 2 },
      '0/2',
      new Date(fakeNow).toISOString()
    );
    assert.equal(bufDepth(publisher, compositeKey), 1, 'one event must be buffered after rate-limit');

    // Advance time past the 1s window so capacity recovers.
    fakeNow += 1100;

    // Next live event passes _allow → must drain the buffered event FIRST, then live.
    await publisher.publish(
      { id: 'cfg-live', tenant_id: tenant, workspace_id: workspace, data_source_ref: 'db-test' },
      { type: 'insert', relation: { namespace: 'public', relationName: 'live' }, newRow: { id: '3' }, sequence: 3 },
      '0/3',
      new Date(fakeNow).toISOString()
    );

    // Buffer must be drained.
    assert.equal(bufDepth(publisher, compositeKey), 0, 'buffer must be drained after capacity recovers');

    // Inspect the ORDER of primary-topic sends.
    const primarySends = sendsTo(fk, primaryTopic);
    assert.equal(primarySends.length, 3, `expected 3 primary sends (first, buffered, live); got ${primarySends.length}`);

    const tableOf = (p) => JSON.parse(p.messages[0].value).data.table;
    assert.equal(tableOf(primarySends[0]), 'first', 'send[0] must be the first live event');
    assert.equal(tableOf(primarySends[1]), 'buffered', 'send[1] must be the drained buffered event (before live)');
    assert.equal(tableOf(primarySends[2]), 'live', 'send[2] must be the new live event (after drain)');
  } finally {
    Date.now = prevDateNow;
    if (prevPrefix !== undefined) process.env.PG_CDC_KAFKA_TOPIC_PREFIX = prevPrefix;
    await publisher.disconnect();
  }
});

// ===========================================================================
// bbx-cdc-overflow-metrics
// ===========================================================================
test('bbx-cdc-overflow-metrics: overflow_buffered set on enqueue, dlq_total incremented on DLQ', async () => {
  const fk = fakeKafka();
  const metrics = fakeMetrics();
  const prevPrefix = process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
  delete process.env.PG_CDC_KAFKA_TOPIC_PREFIX;

  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 1, overflowBufferSize: 1, metricsCollector: metrics });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 8_000_000;
  Date.now = () => fakeNow;

  try {
    const tenant = 'ten_A';
    const workspace = 'wrk_A';

    await pub(publisher, tenant, workspace); // allowed → primary
    await pub(publisher, tenant, workspace); // rate-limited → buffered
    await pub(publisher, tenant, workspace); // rate-limited, buffer full → DLQ

    const buffered = metrics.sets.filter((s) => s.name === 'pg_cdc_events_overflow_buffered_total');
    assert.ok(buffered.length >= 1, 'pg_cdc_events_overflow_buffered_total must be set on enqueue');
    const bufferedSet = buffered[buffered.length - 1];
    assert.equal(bufferedSet.labels.tenant_id, tenant);
    assert.equal(bufferedSet.labels.workspace_id, workspace);
    assert.equal(bufferedSet.value, 1, 'overflow gauge must report current buffer depth (1)');

    const dlq = metrics.increments.filter((i) => i.name === 'pg_cdc_events_dlq_total');
    assert.equal(dlq.length, 1, 'pg_cdc_events_dlq_total must be incremented exactly once');
    assert.equal(dlq[0].labels.tenant_id, tenant);
    assert.equal(dlq[0].labels.workspace_id, workspace);

    // Existing rate-limit metric/behavior preserved.
    const rl = metrics.increments.filter((i) => i.name === 'pg_cdc_events_rate_limited_total');
    assert.ok(rl.length >= 2, 'pg_cdc_events_rate_limited_total must still increment for rate-limited events');
  } finally {
    Date.now = prevDateNow;
    if (prevPrefix !== undefined) process.env.PG_CDC_KAFKA_TOPIC_PREFIX = prevPrefix;
    await publisher.disconnect();
  }
});

// ===========================================================================
// bbx-cdc-overflow-audit-event
// ===========================================================================
test('bbx-cdc-overflow-audit-event: console.pg-cdc.overflow audit event emitted on DLQ with correct scope', async () => {
  const fk = fakeKafka();
  const prevPrefix = process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
  delete process.env.PG_CDC_KAFKA_TOPIC_PREFIX;

  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 1, overflowBufferSize: 0 });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 9_000_000;
  Date.now = () => fakeNow;

  try {
    const tenant = 'ten_A';
    const workspace = 'wrk_A';

    await pub(publisher, tenant, workspace); // allowed → primary
    await pub(publisher, tenant, workspace); // rate-limited, buffer 0 → DLQ + audit

    const auditSends = sendsTo(fk, 'console.pg-cdc.overflow');
    assert.equal(auditSends.length, 1, 'exactly one console.pg-cdc.overflow audit message must be sent');

    const msg = auditSends[0].messages[0];
    const payload = JSON.parse(msg.value);
    assert.equal(payload.type, 'console.pg-cdc.overflow');
    assert.equal(payload.tenantId, tenant);
    assert.equal(payload.workspaceId, workspace);
    assert.equal(msg.key, `${tenant}:${workspace}`, 'audit message key must be the composite tenant:workspace key');
  } finally {
    Date.now = prevDateNow;
    if (prevPrefix !== undefined) process.env.PG_CDC_KAFKA_TOPIC_PREFIX = prevPrefix;
    await publisher.disconnect();
  }
});
