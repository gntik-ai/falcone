import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

test('schedule connect failures are classified and each later request retries', async () => {
  let attempts = 0;
  const original = new Error('connect deadline exceeded');
  const logged = [];
  const { scheduleGateway } = createFlowTriggerRegistry({
    getTemporalClient: async () => { attempts += 1; throw original; },
    logger: { error: (...args) => logged.push(args) },
  });

  for (let request = 1; request <= 3; request += 1) {
    await assert.rejects(scheduleGateway.describeSchedule({ scheduleId: 'tenant:workspace:flow' }), {
      message: 'Temporal is unavailable', statusCode: 503, code: 'TEMPORAL_UNAVAILABLE',
    });
    assert.equal(attempts, request, 'a rejected connection is never reused');
    assert.equal(logged.at(-1).at(-1), original, 'the original error stays in server logs');
  }
});

test('concurrent schedule requests share one pending connect and reuse the connected client', async () => {
  let attempts = 0;
  let resolveConnect;
  const pending = new Promise((resolve) => { resolveConnect = resolve; });
  const description = { scheduleId: 'tenant:workspace:flow', state: { paused: false } };
  const connected = {
    schedule: {
      getHandle: () => ({ describe: async () => description }),
      async *list() { yield description; },
    },
  };
  const { scheduleGateway } = createFlowTriggerRegistry({
    getTemporalClient: () => { attempts += 1; return pending; },
    logger: { error() {} },
  });

  const first = scheduleGateway.describeSchedule({ scheduleId: description.scheduleId });
  const second = scheduleGateway.listSchedulesByPrefix({ prefix: 'tenant:workspace:' });
  await Promise.resolve();
  const inFlightAttempts = attempts;
  resolveConnect(connected);
  assert.deepEqual(await Promise.all([first, second]), [description, [description]]);
  assert.equal(inFlightAttempts, 1, 'concurrent callers share one connection attempt');
  assert.deepEqual(await scheduleGateway.describeSchedule({ scheduleId: description.scheduleId }), description);
  assert.equal(attempts, 1, 'a successful connection is reused');
});

test('the next schedule call connects successfully after the first connect rejects', async () => {
  let attempts = 0;
  const description = { scheduleId: 'tenant:workspace:flow', state: { paused: false } };
  const { scheduleGateway } = createFlowTriggerRegistry({
    getTemporalClient: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('connect deadline exceeded');
      return { schedule: { getHandle: () => ({ describe: async () => description }) } };
    },
    logger: { error() {} },
  });

  await assert.rejects(scheduleGateway.describeSchedule({ scheduleId: description.scheduleId }), {
    statusCode: 503, code: 'TEMPORAL_UNAVAILABLE',
  });
  assert.deepEqual(await scheduleGateway.describeSchedule({ scheduleId: description.scheduleId }), description);
  assert.equal(attempts, 2, 'recovery dials a fresh connection on the same registry');
  await scheduleGateway.describeSchedule({ scheduleId: description.scheduleId });
  assert.equal(attempts, 2, 'later schedule calls reuse the healthy connection');
});
