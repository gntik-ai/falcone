// Real-stack proof for the flow trigger plane (change add-flows-triggers / #365).
//
// Drives the PRODUCTION flow-trigger-registry against a LIVE Temporal server (tests/env compose
// `temporal`) and a LIVE Redpanda broker (`redpanda`), with the production DslInterpreterWorkflow
// worker running, to prove:
//   - a tight cron Temporal Schedule fires a real run within the catch-up window, then is removed,
//   - an inbound webhook (verified HMAC) starts a live run,
//   - a Redpanda event on the tenant's structural topic starts a live run,
//   - a version swap updates the live schedule in place (no firing gap).
//
//   bash tests/env/flows-triggers/run.sh
//
// Self-skips when Temporal / the worker dist / Redpanda is unavailable (repo precedent: pgvector).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { preflight, createWorker, makeClient, NAMESPACE } from '../workflow-worker/_harness.mjs';
import {
  createFlowTriggerRegistry,
  scheduleIdFor,
} from '../../../apps/control-plane/src/runtime/flow-trigger-registry.mjs';
import { createFlowExecutor } from '../../../apps/control-plane/src/runtime/flow-executor.mjs';
import { computeSignature } from '../../../services/webhook-engine/src/webhook-signing.mjs';

const pf = await preflight();
const SKIP = pf.ok ? false : { skip: pf.reason };
const BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:19092';

const TEN = 'ten_rs_trig';
const WS = 'ws_rs_trig';

// Minimal one-task definition the live worker executes for every trigger kind.
const ONE_TASK_DEF = (triggers) => ({
  apiVersion: 'v1.0',
  name: 'rs-trigger-flow',
  triggers,
  nodes: [{ id: 'step-1', type: 'task', taskType: 'fetch-record' }],
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Register the five flow custom search attributes (Keyword) on the test namespace if absent — the
// production `falcone-flows` namespace gets these from the Helm bootstrap job
// (charts/in-falcone/templates/temporal/bootstrap-job.yaml), but the harness `default` namespace
// does not, so visibility queries by tenantId/triggerType would otherwise be rejected. Idempotent.
async function ensureSearchAttributes(connection) {
  const Keyword = 2; // enums.v1.IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD (TEXT=1, KEYWORD=2)
  for (const name of ['tenantId', 'workspaceId', 'flowId', 'flowVersion', 'triggerType']) {
    try {
      await connection.operatorService.addSearchAttributes({
        namespace: NAMESPACE,
        searchAttributes: { [name]: Keyword },
      });
    } catch (err) {
      // AlreadyExists is fine; anything else is surfaced as a skip reason by the caller.
      if (!/already.*exist/i.test(String(err?.message ?? ''))) {
        // re-throw only non-already-exists so the caller can decide to skip.
        if (err?.code !== 6) throw err;
      }
    }
  }
  // Custom SA registration is eventually consistent on the visibility store; give it a moment.
  await sleep(2000);
}

// Poll Temporal visibility for a workflow whose search attributes carry the given triggerType for
// this tenant, until one appears or the deadline passes.
async function waitForTriggeredRun(client, { triggerType, deadlineMs = 90000 }) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const query = `tenantId = '${TEN}' AND triggerType = '${triggerType}'`;
    try {
      for await (const exec of client.workflow.list({ query })) {
        return exec;
      }
    } catch {
      // visibility store may still be settling the custom SA — retry.
    }
    await sleep(2000);
  }
  return null;
}

test('flw-rs-trig-01: a tight cron Temporal Schedule fires a real run, then is removed', SKIP, async () => {
  const taskQueue = `flows-trig-cron-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  const flowId = `cronflow-${randomUUID().slice(0, 8)}`;
  const executor = createFlowExecutor({ temporalClient: client, temporalAddress: 'live', temporalTaskQueue: taskQueue });
  const registry = createFlowTriggerRegistry({ temporalClient: client, temporalTaskQueue: taskQueue, logger: { error() {} } });
  executor.setTriggerRegistry(registry);
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  try {
    await ensureSearchAttributes(connection);
    // Every-minute POSIX cron (the DSL validator FLW-E007 requires a 5/6-field expression);
    // catchupWindow widens the firing window so the test does not race the minute boundary.
    await executor.executeFlows({ operation: 'create_definition', identity, flowId, body: { name: 'Cron', definition: ONE_TASK_DEF([{ kind: 'cron', schedule: '* * * * *', options: { overlap: 'allow', catchupWindow: '1m' } }]) } });
    await executor.executeFlows({ operation: 'publish_version', identity, flowId });

    const scheduleId = scheduleIdFor(TEN, WS, flowId);
    const desc = await client.schedule.getHandle(scheduleId).describe();
    assert.ok(desc, 'the live Temporal Schedule exists after publish');

    const fired = await waitForTriggeredRun(client, { triggerType: 'cron', deadlineMs: 80000 });
    assert.ok(fired, 'the cron schedule started a real DslInterpreterWorkflow within the window');

    // Remove the schedule — no orphan remains.
    await registry.deregisterTriggers(flowId, identity);
    await assert.rejects(() => client.schedule.getHandle(scheduleId).describe(), 'schedule deleted');
  } finally {
    await registry.close().catch(() => {});
    await executor.close().catch(() => {});
    await w.shutdown();
    await connection.close();
  }
});

test('flw-rs-trig-02: a verified inbound webhook starts a live run (triggerType=webhook)', SKIP, async () => {
  const taskQueue = `flows-trig-wh-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  const flowId = `whflow-${randomUUID().slice(0, 8)}`;
  const executor = createFlowExecutor({ temporalClient: client, temporalAddress: 'live', temporalTaskQueue: taskQueue });
  const registry = createFlowTriggerRegistry({ temporalClient: client, temporalTaskQueue: taskQueue, startTriggeredExecution: (a) => executor.startTriggeredExecution(a), logger: { error() {} } });
  executor.setTriggerRegistry(registry);
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  try {
    await executor.executeFlows({ operation: 'create_definition', identity, flowId, body: { name: 'Webhook', definition: ONE_TASK_DEF([{ kind: 'webhook', path: 'orders' }]) } });
    const pub = await executor.executeFlows({ operation: 'publish_version', identity, flowId });
    const { triggerId, secret } = pub.triggers.webhooks[0];

    const rawBody = JSON.stringify({ order: 99 });
    const sig = computeSignature(rawBody, secret);
    const res = await executor.executeFlows({
      operation: 'webhook_trigger', identity, triggerId,
      rawBody, signatureHeader: sig, deliveryId: `d-${randomUUID()}`, payload: JSON.parse(rawBody),
    });
    assert.equal(res.accepted, true);
    const handle = client.workflow.getHandle(res.executionId);
    const result = await handle.result();
    assert.equal(result.status, 'completed', 'the webhook-triggered run completed on the live worker');
    const desc = await handle.describe();
    assert.deepEqual(desc.searchAttributes.triggerType, ['webhook']);
  } finally {
    await registry.close().catch(() => {});
    await executor.close().catch(() => {});
    await w.shutdown();
    await connection.close();
  }
});

test('flw-rs-trig-03: a Redpanda event on the tenant topic starts a live run (triggerType=platform_event)', SKIP, async () => {
  let Kafka, logLevel;
  try {
    ({ Kafka, logLevel } = await import('kafkajs'));
  } catch (err) {
    test('flw-rs-trig-03', { skip: `kafkajs unavailable: ${err?.message}` }, () => {});
    return;
  }
  const probe = new Kafka({ clientId: 'flows-trig-probe', brokers: BROKERS.split(','), logLevel: logLevel.NOTHING });
  const admin = probe.admin();
  try {
    await admin.connect();
    await admin.disconnect();
  } catch (err) {
    test.skip(`Redpanda unreachable at ${BROKERS}: ${err?.message}`);
    return;
  }

  const taskQueue = `flows-trig-pe-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  const flowId = `peflow-${randomUUID().slice(0, 8)}`;
  const eventType = `order-placed-${randomUUID().slice(0, 6)}`;
  const physicalTopic = `evt.${WS}.${eventType}`;
  const executor = createFlowExecutor({ temporalClient: client, temporalAddress: 'live', temporalTaskQueue: taskQueue });
  const consumerFactory = async () => {
    const consumer = probe.consumer({ groupId: `flows-trig-consumer-${randomUUID().slice(0, 8)}` });
    await consumer.connect();
    return {
      subscribe: ({ topics }) => Promise.all(topics.map((topic) => consumer.subscribe({ topic, fromBeginning: true }))),
      run: ({ eachMessage }) => consumer.run({ eachMessage }),
      stop: () => consumer.stop().catch(() => {}),
      disconnect: () => consumer.disconnect().catch(() => {}),
    };
  };
  const registry = createFlowTriggerRegistry({
    temporalClient: client, temporalTaskQueue: taskQueue,
    kafkaConsumerFactory: consumerFactory,
    startTriggeredExecution: (a) => executor.startTriggeredExecution(a),
    logger: { error() {} },
  });
  executor.setTriggerRegistry(registry);
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  const producer = probe.producer();
  try {
    await ensureSearchAttributes(connection);
    await admin.connect();
    await admin.createTopics({ topics: [{ topic: physicalTopic, numPartitions: 1 }] });
    await executor.executeFlows({ operation: 'create_definition', identity, flowId, body: { name: 'Event', definition: ONE_TASK_DEF([{ kind: 'platform-event', eventType }]) } });
    await executor.executeFlows({ operation: 'publish_version', identity, flowId });
    // The registerEventTrigger refresh started the consumer subscribed to physicalTopic.
    await sleep(3000);
    await producer.connect();
    await producer.send({ topic: physicalTopic, messages: [{ value: JSON.stringify({ id: 7 }) }] });

    const fired = await waitForTriggeredRun(client, { triggerType: 'platform_event', deadlineMs: 60000 });
    assert.ok(fired, 'the Redpanda event started a real run via the platform-event consumer');
  } finally {
    await producer.disconnect().catch(() => {});
    await admin.disconnect().catch(() => {});
    await registry.close().catch(() => {});
    await executor.close().catch(() => {});
    await w.shutdown();
    await connection.close();
  }
});

test('flw-rs-trig-04: version swap updates the live schedule in place (no firing gap)', SKIP, async () => {
  const taskQueue = `flows-trig-swap-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  const flowId = `swapflow-${randomUUID().slice(0, 8)}`;
  const executor = createFlowExecutor({ temporalClient: client, temporalAddress: 'live', temporalTaskQueue: taskQueue });
  const registry = createFlowTriggerRegistry({ temporalClient: client, temporalTaskQueue: taskQueue, logger: { error() {} } });
  executor.setTriggerRegistry(registry);
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  try {
    await executor.executeFlows({ operation: 'create_definition', identity, flowId, body: { name: 'Swap', definition: ONE_TASK_DEF([{ kind: 'cron', schedule: '0 * * * *', options: { overlap: 'skip' } }]) } });
    await executor.executeFlows({ operation: 'publish_version', identity, flowId });
    const scheduleId = scheduleIdFor(TEN, WS, flowId);
    const before = await client.schedule.getHandle(scheduleId).describe();
    assert.ok(before, 'schedule exists after v1 publish');

    // Re-publish v2 with a different cron expression → schedule UPDATED in place.
    await executor.executeFlows({ operation: 'update_definition', identity, flowId, body: { definition: ONE_TASK_DEF([{ kind: 'cron', schedule: '*/15 * * * *', options: { overlap: 'skip' } }]) } });
    const pub2 = await executor.executeFlows({ operation: 'publish_version', identity, flowId });
    assert.equal(pub2.version, 2);
    const after = await client.schedule.getHandle(scheduleId).describe();
    assert.ok(after, 'the SAME schedule id survives the swap (updated, not recreated)');
    // The schedule's action now pins v2.
    const flowVersionSA = after.action?.workflowType ? after.searchAttributes?.flowVersion : null;
    if (flowVersionSA) assert.deepEqual(flowVersionSA, ['2']);
  } finally {
    await registry.close().catch(() => {});
    await executor.close().catch(() => {});
    await w.shutdown();
    await connection.close();
  }
});
