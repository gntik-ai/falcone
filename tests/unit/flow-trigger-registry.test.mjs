// Unit tests for the flow trigger registry (change: add-flows-triggers).
//
// Drives the registry's pure helpers + the register/swap/deregister lifecycle against an injected
// fake Temporal ScheduleClient and the in-memory store. Covers the spec's structural-isolation
// invariants (schedule ID tenant prefix), the triggerType search-attribute stamping, and the
// in-place version-swap (no delete+create gap).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFlowTriggerRegistry,
  scheduleIdFor,
  physicalTopicForTrigger,
  triggerIdFor,
  TRIGGER_TYPES,
} from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

function makeFakeSchedule() {
  const schedules = new Map();
  const ops = [];
  return {
    schedules,
    ops,
    schedule: {
      async create(opts) {
        if (schedules.has(opts.scheduleId)) throw Object.assign(new Error('exists'), { name: 'ScheduleAlreadyRunning' });
        schedules.set(opts.scheduleId, { spec: opts.spec, action: opts.action, policies: opts.policies });
        ops.push({ op: 'create', id: opts.scheduleId });
        return { scheduleId: opts.scheduleId };
      },
      getHandle(id) {
        return {
          async update(fn) {
            const next = fn(schedules.get(id) ?? {});
            schedules.set(id, { spec: next.spec, action: next.action, policies: next.policies });
            ops.push({ op: 'update', id });
          },
          async delete() {
            if (!schedules.has(id)) throw Object.assign(new Error('absent'), { name: 'ScheduleNotFound' });
            schedules.delete(id);
            ops.push({ op: 'delete', id });
          },
        };
      },
    },
  };
}

const IDENTITY_A = { tenantId: 'ten_A', workspaceId: 'ws_A', actorId: 'svc' };
const IDENTITY_B = { tenantId: 'ten_B', workspaceId: 'ws_A', actorId: 'svc' };

// --- pure helpers ---

test('scheduleIdFor encodes tenant + workspace as the leading segments', () => {
  assert.equal(scheduleIdFor('ten_A', 'ws_A', 'flow1'), 'ten_A:ws_A:flow1');
});

test('cross-tenant schedule IDs are structurally distinct (task 3.2)', () => {
  const a = scheduleIdFor('ten_A', 'ws_A', 'flow1');
  const b = scheduleIdFor('ten_B', 'ws_A', 'flow1');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('ten_A:'));
  assert.ok(b.startsWith('ten_B:'));
  // A tenant-A prefix can never address a tenant-B schedule.
  assert.ok(!b.startsWith('ten_A:'));
});

test('physicalTopicForTrigger reuses producer naming (evt / pg-changes / mongo-changes)', () => {
  assert.equal(physicalTopicForTrigger('ten_A', 'ws_A', { eventType: 'order-placed' }), 'evt.ws_A.order-placed');
  assert.equal(physicalTopicForTrigger('ten_A', 'ws_A', { eventType: 'pg-changes' }), 'ten_A.ws_A.pg-changes');
  assert.equal(physicalTopicForTrigger('ten_A', 'ws_A', { eventType: 'mongo-changes' }), 'ten_A.ws_A.mongo-changes');
});

test('triggerId is stable across publishes for the same trigger', () => {
  const trig = { kind: 'webhook', path: 'orders' };
  assert.equal(triggerIdFor('flow1', trig), triggerIdFor('flow1', { ...trig }));
  assert.match(triggerIdFor('flow1', trig), /^flow1:webhook:orders$/);
});

// --- lifecycle ---

test('registerTriggers stamps triggerType=cron on the schedule action (task 6.3)', async () => {
  const fake = makeFakeSchedule();
  const reg = createFlowTriggerRegistry({ temporalClient: fake, logger: { error() {} } });
  await reg.registerTriggers('flow1', 1, [{ kind: 'cron', schedule: '0 * * * *', options: { overlap: 'skip', catchupWindow: '2m' } }], IDENTITY_A);
  const sched = fake.schedules.get('ten_A:ws_A:flow1');
  assert.deepEqual(sched.action.searchAttributes.triggerType, [TRIGGER_TYPES.CRON]);
  assert.deepEqual(sched.action.searchAttributes.tenantId, ['ten_A']);
  // DSL `overlap: 'skip'` maps to the Temporal SDK enum 'SKIP'.
  assert.equal(sched.policies.overlap, 'SKIP');
  assert.equal(sched.policies.catchupWindow, '2m');
});

test('swapTriggers UPDATES the schedule in place — no delete+create gap (task 7.1)', async () => {
  const fake = makeFakeSchedule();
  const reg = createFlowTriggerRegistry({ temporalClient: fake, logger: { error() {} } });
  await reg.registerTriggers('flow1', 1, [{ kind: 'cron', schedule: '0 * * * *' }], IDENTITY_A);
  await reg.swapTriggers('flow1', 1, 2, [{ kind: 'cron', schedule: '*/5 * * * *' }], IDENTITY_A);
  const ops = fake.ops.filter((o) => o.id === 'ten_A:ws_A:flow1');
  assert.deepEqual(ops.map((o) => o.op), ['create', 'update'], 'create then update, never delete');
  assert.deepEqual(fake.schedules.get('ten_A:ws_A:flow1').action.searchAttributes.flowVersion, ['2']);
});

test('deregisterTriggers deletes the schedule + revokes secrets + removes registrations', async () => {
  const fake = makeFakeSchedule();
  const reg = createFlowTriggerRegistry({ temporalClient: fake, logger: { error() {} } });
  await reg.registerTriggers('flow1', 1, [
    { kind: 'cron', schedule: '0 * * * *' },
    { kind: 'webhook', path: 'orders' },
    { kind: 'platform-event', eventType: 'order-placed' },
  ], IDENTITY_A);
  const out = await reg.deregisterTriggers('flow1', IDENTITY_A);
  assert.equal(out.scheduleDeleted, true);
  assert.equal(out.secretsRevoked, 1);
  assert.equal(out.registrationsRemoved, 1);
  assert.ok(!fake.schedules.has('ten_A:ws_A:flow1'));
});

test('webhook secret is verifiable and tenant-scoped (cross-tenant lookup returns nothing)', async () => {
  const fake = makeFakeSchedule();
  const reg = createFlowTriggerRegistry({ temporalClient: fake, logger: { error() {} } });
  const { webhooks } = await reg.registerTriggers('flow1', 1, [{ kind: 'webhook', path: 'orders' }], IDENTITY_A);
  const { triggerId, secret } = webhooks[0];
  const { computeSignature } = await import('../../packages/webhook-engine/src/webhook-signing.mjs');
  const body = JSON.stringify({ a: 1 });
  const sig = computeSignature(body, secret);
  // Same tenant + valid signature → accepted.
  assert.equal(await reg.verifyWebhook({ identity: IDENTITY_A, triggerId, rawBody: body, signatureHeader: sig }), true);
  // A different tenant id cannot load the secret → rejected (no cross-tenant secret disclosure).
  assert.equal(await reg.verifyWebhook({ identity: IDENTITY_B, triggerId, rawBody: body, signatureHeader: sig }), false);
  // A tampered signature → rejected.
  assert.equal(await reg.verifyWebhook({ identity: IDENTITY_A, triggerId, rawBody: body, signatureHeader: 'sha256=00' }), false);
});

test('platform-event registration is matched only by its own structural topic', async () => {
  const fake = makeFakeSchedule();
  const reg = createFlowTriggerRegistry({ temporalClient: fake, logger: { error() {} } });
  await reg.registerTriggers('flow1', 1, [{ kind: 'platform-event', eventType: 'order-placed' }], IDENTITY_A);
  const own = await reg.store.findRegistrationsByTopic({ topicRef: 'evt.ws_A.order-placed' });
  assert.equal(own.length, 1);
  // A foreign workspace topic matches nothing — structural cross-tenant denial.
  const foreign = await reg.store.findRegistrationsByTopic({ topicRef: 'evt.ws_OTHER.order-placed' });
  assert.equal(foreign.length, 0);
});
