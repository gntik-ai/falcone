// Black-box test suite for change add-event-trigger-integration (#564, epic #543).
//
// The live 2-tenant E2E campaign (2026-06-18, audit/live-campaign/evidence/23-events-functions.md)
// found that a published Kafka event matching a bound platform-event flow trigger started NO flow
// execution. Two gaps were diagnosed:
//
//   (1) NO event-trigger CONSUMER wired a published Kafka event to the bound flow execution at the
//       deployed seam. The registry's `onConsumerMessage` -> `startTriggeredExecution` path exists,
//       but it is only reached through the KafkaJS `kafkaConsumerFactory`, and the consumer is only
//       (re)subscribed when a NEW trigger is registered IN THIS PROCESS. On a fresh process boot
//       with PRE-EXISTING registrations (publish a flow, restart, publish an event), the consumer
//       never starts -> the event is silently dropped. No existing test injects a consumer factory,
//       so the real Kafka-message -> execution path was untested.
//
//   (2) the dev/kind Temporal lacked the 5 custom search attributes the chart's temporal-bootstrap
//       Job registers (tenantId/workspaceId/flowId/flowVersion/triggerType); the quota pre-flight
//       `client.workflow.list({ query })` 500s without them, blocking EVERY start.
//
// This suite drives the PUBLIC surface ONLY:
//   - the flow executor + trigger registry factories with an INJECTED fake Temporal client and an
//     INJECTED fake Kafka consumer factory (the no-infra mode the blackbox suite stays green in),
//     exercising the REAL consumer message handler end-to-end;
//   - the deploy surface via `helm template` (self-skips when `helm` is absent), asserting the kind
//     ADVANCED overlay (the live-failing config) still registers all 5 Temporal search attributes.
//
// Live-only portion (documented, not asserted here): a real Kafka broker + a real Temporal with the
// SAs registered. A reviewer's kind probe is in the change report.
//
// Tests: bbx-evt-trig-int-01 .. bbx-evt-trig-int-06
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlowExecutor, createFlowStore } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowTriggerRegistry, wireFlowTriggers } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone');
const KIND_BASE = resolve(REPO_ROOT, '..', 'falcone-charts', 'deploy', 'kind', 'values-kind.yaml');
const KIND_ADVANCED = resolve(REPO_ROOT, '..', 'falcone-charts', 'deploy', 'kind', 'values-kind-advanced.yaml');

const TEN = 'ten_evt_int';
const WS = 'ws_evt_int';
const EVENT_TYPE = 'order-placed';
const TOPIC = `evt.${WS}.${EVENT_TYPE}`;

const EVENT_DEF = {
  apiVersion: 'v1.0',
  name: 'event-flow',
  triggers: [{ kind: 'platform-event', eventType: EVENT_TYPE }],
  nodes: [{ id: 'step-1', type: 'task', taskType: 'fetch-record' }],
};

// A fake @temporalio/client-shaped object: workflow start/list (for the quota pre-flight) + the
// `.schedule` ScheduleClient the registry touches. Records every start so the test can assert that a
// consumed Kafka message resolved to exactly one StartWorkflowExecution for the bound flow.
function makeFakeTemporal() {
  const handles = new Map();
  const started = [];
  const schedules = new Map();
  return {
    started,
    schedules,
    workflow: {
      async start(type, opts) {
        if (handles.has(opts.workflowId)) {
          throw Object.assign(new Error('already started'), { name: 'WorkflowExecutionAlreadyStartedError' });
        }
        const h = { workflowId: opts.workflowId, _status: 'Running' };
        handles.set(opts.workflowId, h);
        started.push({ type, workflowId: opts.workflowId, opts });
        return { workflowId: opts.workflowId, firstExecutionRunId: 'run-1' };
      },
      getHandle(id) { return handles.get(id) ?? { workflowId: id }; },
      // The quota pre-flight (countRunningExecutions) iterates this. A real dev Temporal WITHOUT the
      // custom search attributes would 500 here; the chart bootstrap-job registers them so the call
      // succeeds (see the helm-render test below).
      async *list() { for (const h of handles.values()) yield { workflowId: h.workflowId, status: { name: h._status } }; },
    },
    schedule: {
      async create(opts) { schedules.set(opts.scheduleId, opts); return { scheduleId: opts.scheduleId }; },
      getHandle(id) { return { async update() {}, async delete() { schedules.delete(id); } }; },
    },
  };
}

// A fake Kafka consumer factory. Captures the subscribed topics and the `eachMessage` handler the
// registry wires (consumer.run({ eachMessage: onConsumerMessage })) so the test can deliver a
// message exactly as a real broker would, driving the REAL onConsumerMessage -> startTriggeredExecution
// path. Modelled on the production KafkaJS adapter shape in main.mjs.
function makeFakeKafka() {
  const calls = { factory: 0, subscriptions: [], runs: 0, stopped: 0 };
  let eachMessage = null;
  return {
    calls,
    async deliver({ topic, partition = 0, offset = '0', value }) {
      assert.ok(eachMessage, 'consumer.run({ eachMessage }) must be wired before a message is delivered');
      const payload = value === undefined ? undefined : Buffer.from(JSON.stringify(value));
      await eachMessage({ topic, partition, message: { offset: String(offset), value: payload } });
    },
    factory: async () => {
      calls.factory += 1;
      return {
        subscribe: async ({ topics }) => { for (const t of topics) calls.subscriptions.push(t); },
        run: async ({ eachMessage: em }) => { calls.runs += 1; eachMessage = em; },
        stop: async () => { calls.stopped += 1; },
        disconnect: async () => {},
      };
    },
  };
}

function wire({ temporal, kafka }) {
  const flowExecutor = createFlowExecutor({ temporalClient: temporal, temporalAddress: 'fake:7233' });
  const registry = createFlowTriggerRegistry({
    temporalClient: temporal,
    kafkaConsumerFactory: kafka.factory,
    startTriggeredExecution: (args) => flowExecutor.startTriggeredExecution(args),
    logger: { error() {} },
  });
  flowExecutor.setTriggerRegistry(registry);
  return { flowExecutor, registry };
}

async function publishEventFlow(flowExecutor, flowId = 'evflow') {
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  await flowExecutor.executeFlows({ operation: 'create_definition', identity, flowId, body: { name: 'Ev', definition: EVENT_DEF } });
  await flowExecutor.executeFlows({ operation: 'publish_version', identity, flowId });
  return identity;
}

// -------------------------------------------------------------------------
// bbx-evt-trig-int-01: a consumed Kafka message on the bound topic starts the flow (CORE gap).
// Drives the REAL consumer handler (onConsumerMessage), not a direct startTriggeredExecution call.
// -------------------------------------------------------------------------
test('bbx-evt-trig-int-01: a published event consumed off the bound topic starts the bound flow', async () => {
  const temporal = makeFakeTemporal();
  const kafka = makeFakeKafka();
  const { flowExecutor, registry } = wire({ temporal, kafka });
  await publishEventFlow(flowExecutor);

  // Publishing the event flow subscribed the consumer to the per-workspace physical topic and
  // started the run loop. A matching event is now delivered exactly as a broker would.
  assert.ok(kafka.calls.subscriptions.includes(TOPIC), 'consumer subscribed to the bound physical topic');
  assert.ok(kafka.calls.runs >= 1, 'consumer.run was started');

  assert.equal(temporal.started.length, 0, 'no execution before the event is delivered');
  await kafka.deliver({ topic: TOPIC, value: { order: 42 } });

  assert.equal(temporal.started.length, 1, 'the consumed event started exactly one bound-flow execution');
  const start = temporal.started[0];
  assert.deepEqual(start.opts.searchAttributes.triggerType, ['platform_event'], 'stamped triggerType=platform_event');
  assert.deepEqual(start.opts.searchAttributes.tenantId, [TEN], 'execution scoped to the bound tenant');
  await flowExecutor.close();
});

// -------------------------------------------------------------------------
// bbx-evt-trig-int-02: a fresh boot with a PRE-EXISTING registration subscribes + consumes (gap 1).
// This is the live scenario: the flow was published in a PRIOR process; on restart the consumer must
// pick up the existing registration WITHOUT a new publish, else the event is silently dropped.
// -------------------------------------------------------------------------
test('bbx-evt-trig-int-02: a process boot wires the consumer to pre-existing registrations', async () => {
  const temporal = makeFakeTemporal();
  // Both "processes" share the SAME flow store + trigger store (production: one Postgres `keyPool`).
  const sharedFlowStore = createFlowStore();

  // Process #1 publishes the event flow (writes the flow version + a trigger registration).
  const kafka1 = makeFakeKafka();
  const flowExecutor1 = createFlowExecutor({ store: sharedFlowStore, temporalClient: temporal, temporalAddress: 'fake:7233' });
  const registry1 = createFlowTriggerRegistry({
    temporalClient: temporal,
    kafkaConsumerFactory: kafka1.factory,
    startTriggeredExecution: (args) => flowExecutor1.startTriggeredExecution(args),
    logger: { error() {} },
  });
  flowExecutor1.setTriggerRegistry(registry1);
  await publishEventFlow(flowExecutor1);
  const sharedTriggerStore = registry1.store;
  await flowExecutor1.close();

  // Process #2 (a restart) reuses the SAME stores. The boot wiring helper (the fix, mirrored in
  // main.mjs) must START the consumer for the existing registration WITHOUT a new publish, else a
  // post-restart event is silently dropped (the live-campaign gap).
  const kafka2 = makeFakeKafka();
  const flowExecutor2 = createFlowExecutor({ store: sharedFlowStore, temporalClient: temporal, temporalAddress: 'fake:7233' });
  const registry2 = await wireFlowTriggers({
    flowExecutor: flowExecutor2,
    store: sharedTriggerStore,
    temporalClient: temporal,
    kafkaConsumerFactory: kafka2.factory,
    logger: { error() {} },
  });

  // The boot wiring subscribed to the union of existing registrations and started the run loop,
  // without any new publish in process #2.
  assert.ok(kafka2.calls.subscriptions.includes(TOPIC), 'boot wiring subscribed to the existing registration topic');
  assert.ok(kafka2.calls.runs >= 1, 'boot wiring started the consumer run loop');

  const before = temporal.started.length;
  await kafka2.deliver({ topic: TOPIC, value: { order: 7 } });
  assert.equal(temporal.started.length, before + 1, 'an event after a restart starts the bound flow');
  assert.ok(registry2, 'wireFlowTriggers returns the wired registry');
  await flowExecutor2.close();
});

// -------------------------------------------------------------------------
// bbx-evt-trig-int-03: a redelivered Kafka offset starts only ONE execution (idempotent dedup key).
// -------------------------------------------------------------------------
test('bbx-evt-trig-int-03: a redelivered offset starts only one execution', async () => {
  const temporal = makeFakeTemporal();
  const kafka = makeFakeKafka();
  const { flowExecutor } = wire({ temporal, kafka });
  await publishEventFlow(flowExecutor);

  await kafka.deliver({ topic: TOPIC, partition: 0, offset: '5', value: { n: 1 } });
  await kafka.deliver({ topic: TOPIC, partition: 0, offset: '5', value: { n: 1 } }); // redelivery
  assert.equal(temporal.started.length, 1, 'the redelivered offset is deduplicated to one start');
  await flowExecutor.close();
});

// -------------------------------------------------------------------------
// bbx-evt-trig-int-04: an event on a FOREIGN-tenant workspace topic starts nothing (isolation).
// -------------------------------------------------------------------------
test('bbx-evt-trig-int-04: an event on a foreign workspace topic starts no execution', async () => {
  const temporal = makeFakeTemporal();
  const kafka = makeFakeKafka();
  const { flowExecutor } = wire({ temporal, kafka });
  await publishEventFlow(flowExecutor);

  await kafka.deliver({ topic: 'evt.ws_OTHER.order-placed', value: { intruder: true } });
  assert.equal(temporal.started.length, 0, 'a foreign workspace topic matches no registration → no cross-tenant trigger');
  await flowExecutor.close();
});

// -------------------------------------------------------------------------
// Deploy surface: the kind ADVANCED overlay (the live-failing config) must register the 5 Temporal
// search attributes via the chart bootstrap-job, so the quota-preflight workflow.list does not 500.
// Self-skips when `helm` is unavailable (repo precedent: flows-temporal-helm.test.mjs).
// -------------------------------------------------------------------------
function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const HELM = helmAvailable();
const SKIP = HELM ? false : { skip: 'helm binary not available on PATH' };

function renderBootstrap(valuesFiles) {
  const args = ['template', 'falcone', CHART_PATH, '--skip-schema-validation'];
  for (const f of valuesFiles) args.push('-f', f);
  args.push('--show-only', 'templates/temporal/bootstrap-job.yaml');
  return spawnSync('helm', args, { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 });
}

// bbx-evt-trig-int-05: the kind ADVANCED overlay renders the bootstrap-job with all 5 SAs.
test('bbx-evt-trig-int-05: kind advanced overlay registers all 5 Temporal search attributes', SKIP, () => {
  const r = renderBootstrap([KIND_BASE, KIND_ADVANCED]);
  assert.equal(r.status, 0, `helm template (kind advanced) must exit 0.\nstderr: ${r.stderr}`);
  const out = r.stdout;
  for (const attr of ['tenantId', 'workspaceId', 'flowId', 'flowVersion', 'triggerType']) {
    assert.match(out, new RegExp(`register_sa\\s+"${attr}"\\s+"Keyword"`),
      `bootstrap-job under the kind advanced overlay must register search attribute ${attr} (Keyword)`);
  }
  // The bootstrap is a post-install,post-upgrade hook so a helm upgrade re-runs it.
  assert.match(out, /helm\.sh\/hook:\s*post-install,post-upgrade/, 'bootstrap-job must be a post-install,post-upgrade hook');
});

// bbx-evt-trig-int-06: the chart values carry the 5 search attributes the bootstrap-job ranges over.
test('bbx-evt-trig-int-06: the kind advanced overlay does not drop the search-attribute set', SKIP, () => {
  // The overlay sets a PARTIAL temporal.bootstrap (namespace + retentionDays). Helm deep-merges
  // maps, so the chart default searchAttributes must survive — assert the rendered job proves it
  // (exactly the 5, no more, no fewer).
  const r = renderBootstrap([KIND_BASE, KIND_ADVANCED]);
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const regs = [...r.stdout.matchAll(/register_sa\s+"([^"]+)"\s+"Keyword"/g)].map((m) => m[1]).sort();
  assert.deepEqual(regs, ['flowId', 'flowVersion', 'tenantId', 'triggerType', 'workspaceId'],
    'exactly the 5 chart-default search attributes are registered under the kind overlay');
});

// -------------------------------------------------------------------------
// bbx-evt-trig-int-07: adding a trigger topic to an ALREADY-RUNNING consumer must
// stop -> subscribe -> re-run. KafkaJS FORBIDS subscribe() while running, so a publish
// after the boot-time wiring (bootFlowTriggers already started the consumer) regressed
// to 502 TRIGGER_REGISTRATION_FAILED. (live campaign 2026-06-18, #564 consumer-lifecycle.)
// The prior fakes never enforced the constraint, so the bug slipped past them; this fake
// throws exactly as the real KafkaJS consumer does.
// -------------------------------------------------------------------------
test('bbx-evt-trig-int-07: subscribing a new topic on a running consumer stops then re-runs (no subscribe-while-running 502)', async () => {
  const calls = { subscriptions: [], runs: 0, stopped: 0 };
  let running = false;
  const kafka = {
    calls,
    factory: async () => ({
      subscribe: async ({ topics }) => {
        if (running) throw new Error('Cannot subscribe to topic while consumer is running'); // KafkaJS contract
        for (const t of topics) calls.subscriptions.push(t);
      },
      run: async () => { calls.runs += 1; running = true; },
      stop: async () => { calls.stopped += 1; running = false; },
      disconnect: async () => {},
    }),
  };
  const { flowExecutor } = wire({ temporal: makeFakeTemporal(), kafka });
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };

  // First publish: subscribe(order-placed) + run() -> consumer now RUNNING.
  await flowExecutor.executeFlows({ operation: 'create_definition', identity, flowId: 'f1', body: { name: 'A', definition: EVENT_DEF } });
  await flowExecutor.executeFlows({ operation: 'publish_version', identity, flowId: 'f1' });
  assert.equal(calls.runs, 1, 'consumer started after the first registration');

  // Second publish adds a NEW topic while the consumer is running. With the fix this stops,
  // re-subscribes to the union, and re-runs — WITHOUT the fix it throws subscribe-while-running.
  const def2 = { ...EVENT_DEF, name: 'B', triggers: [{ kind: 'platform-event', eventType: 'order-shipped' }] };
  await flowExecutor.executeFlows({ operation: 'create_definition', identity, flowId: 'f2', body: { name: 'B', definition: def2 } });
  await flowExecutor.executeFlows({ operation: 'publish_version', identity, flowId: 'f2' });

  assert.ok(calls.stopped >= 1, 'the running consumer was stopped before re-subscribing');
  assert.ok(calls.runs >= 2, 'the consumer run loop was restarted after re-subscribing');
  assert.ok(calls.subscriptions.includes(`evt.${WS}.order-shipped`), 'the new trigger topic was subscribed');
});
