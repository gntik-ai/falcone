// Real-Kafka proof for change add-flows-activity-catalog (#360): the events.publish
// activity lands messages on the WORKSPACE-PREFIXED physical topic (evt.<ws>.<topic>) and
// cannot publish into another workspace's stream. Drives the production `eventsPublish`
// activity over the real events executor (tests/env Redpanda). Self-skips when the broker
// is unreachable.
//
//   bash tests/env/executor/run-events.sh  (or any tests/env Redpanda bring-up)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Kafka, logLevel } from 'kafkajs';
import { createEventsExecutor } from '../../apps/control-plane/src/runtime/events-executor.mjs';
import { eventsPublish } from '../../services/workflow-worker/src/activities/events-publish.mjs';

const BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:19092';
const WS_A = 'wsactevta';
const WS_B = 'wsactevtb';
const TOPIC = 'orders';

let exec;
let raw;
let available = false;

const tenantA = { tenantId: 'ten_act_evt_a', workspaceId: WS_A };

before(async () => {
  raw = new Kafka({ clientId: 'flows-evt-test', brokers: BROKERS.split(','), logLevel: logLevel.NOTHING });
  const admin = raw.admin();
  try {
    await admin.connect();
    await admin.disconnect();
    available = true;
  } catch {
    available = false;
    return;
  }
  exec = createEventsExecutor({ brokers: BROKERS });
});

after(async () => {
  await exec?.close().catch(() => {});
  if (available) {
    const a = raw.admin();
    await a.connect().catch(() => {});
    await a.deleteTopics({ topics: [`evt.${WS_A}.${TOPIC}`, `evt.${WS_B}.${TOPIC}`] }).catch(() => {});
    await a.disconnect().catch(() => {});
  }
});

test('events.publish activity lands on the workspace physical topic evt.<ws>.<topic>', async (t) => {
  if (!available) return t.skip('Kafka broker not reachable');

  const out = await eventsPublish(
    { params: { topic: TOPIC, messages: [{ key: 'o1', value: { id: 1 } }, { key: 'o2', value: { id: 2 } }] }, tenant: tenantA, credential: {} },
    { executeEvents: exec.executeEvents },
  );
  assert.equal(out.status, 'success');
  assert.equal(out.topic, TOPIC, 'output carries the LOGICAL topic, not the physical prefix');
  assert.equal(out.published, 2);

  // Consume from the same workspace to confirm the messages physically landed.
  const consumed = await exec.executeEvents({
    identity: tenantA, workspaceId: WS_A, operation: 'consume', topic: TOPIC, payload: { maxMessages: 10, timeoutMs: 4000 },
  });
  assert.equal(consumed.messages.length, 2, 'both messages are on evt.<ws_a>.orders');
  assert.deepEqual(consumed.messages.map((m) => m.key).sort(), ['o1', 'o2']);

  // Workspace B's own orders stream is untouched (prefix isolation).
  const consumedB = await exec.executeEvents({
    identity: { tenantId: 'ten_act_evt_b', workspaceId: WS_B }, workspaceId: WS_B, operation: 'consume', topic: TOPIC, payload: { maxMessages: 10, timeoutMs: 2000 },
  });
  assert.equal(consumedB.messages.length, 0, 'workspace B never receives workspace A messages');
});

test('events.publish activity: empty messages → non-retryable EMPTY_PUBLISH, no broker call', async (t) => {
  if (!available) return t.skip('Kafka broker not reachable');
  let called = false;
  await assert.rejects(
    () => eventsPublish(
      { params: { topic: TOPIC, messages: [] }, tenant: tenantA, credential: {} },
      { executeEvents: async () => { called = true; return {}; } },
    ),
    (err) => err.type === 'EMPTY_PUBLISH' && err.nonRetryable === true,
  );
  assert.equal(called, false, 'no Kafka call for an empty publish');
});
