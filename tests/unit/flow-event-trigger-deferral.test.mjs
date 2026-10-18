import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

const identity = { tenantId: 'tenant', workspaceId: 'workspace' };
const trigger = { kind: 'platform-event', eventType: 'orders' };
const quotaError = () => Object.assign(new Error('quota'), { code: 'QUOTA_EXCEEDED', dimension: 'flow_starts_per_minute', quota: { reason: 'metering_unavailable' } });

async function setup({ priorCommit, maxDeferMs = 86_400_000, timestamp = 1_000_000 } = {}) {
  let clock = 1_000_000;
  let eachMessage;
  let deny = true;
  let failure;
  let committed = priorCommit;
  let restarted = false;
  let commitFailure = false;
  const events = [];
  const logs = [];
  const delivered = new Set();
  const starts = [];
  const timers = new Map();
  const message = { offset: '7', timestamp: String(timestamp), value: Buffer.from('{"order":1}') };
  const topic = 'evt.workspace.orders';
  const consumer = {
    async subscribe({ topics }) { events.push(['subscribe', topics]); },
    async run(options) { eachMessage = options.eachMessage; events.push(['run']); },
    async stop() { restarted = true; events.push(['stop']); },
    async disconnect() {},
    async commitOffsets(offsets) {
      events.push(['commit', offsets[0].offset]);
      if (commitFailure) throw new Error('commit unavailable');
      committed = offsets[0].offset;
    },
    seek(position) { events.push(['seek', position.offset]); },
  };
  const registry = createFlowTriggerRegistry({
    kafkaConsumerFactory: async () => consumer,
    now: () => clock, maxDeferMs,
    timers: {
      setTimeout(callback, delay) { const id = {}; timers.set(id, { callback, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    logger: { error(...args) { logs.push(args); } },
    async startTriggeredExecution({ flowId, workflowIdOverride }) {
      if (flowId === 'denied') { if (failure) throw failure; if (deny) throw quotaError(); }
      if (delivered.has(workflowIdOverride)) { events.push(['deduplicated', flowId]); return { deduplicated: true }; }
      delivered.add(workflowIdOverride);
      starts.push(flowId);
    },
  });
  await registry.registerTriggers('denied', 1, [trigger], identity);
  await registry.registerTriggers('allowed', 1, [trigger], identity);
  async function deliver() {
    // A restarted, uncommitted fromBeginning:false partition resets to latest (8).
    const position = restarted ? (committed ?? '8') : '7';
    restarted = false;
    if (BigInt(position) > 7n) return false;
    await eachMessage({ topic, partition: 0, message, pause() { events.push(['pause']); return () => events.push(['resume']); } });
    return true;
  }
  return {
    registry, events, logs, starts, timers, deliver,
    allow() { deny = false; }, fail(error) { failure = error; },
    set commitFailure(value) { commitFailure = value; },
    advance(ms) { clock += ms; },
    fireTimer() { const [id, timer] = timers.entries().next().value; timers.delete(id); clock += timer.delay; timer.callback(); return timer.delay; },
    async resubscribe() { await registry.registerTriggers('new-topic', 1, [{ ...trigger, eventType: 'new-orders' }], identity); },
  };
}

test('quota deferral retains the denied offset, visits every registration and backs off to 15 minutes', async () => {
  const h = await setup();
  try {
    assert.equal(await h.deliver(), true);
    assert.deepEqual(h.starts, ['allowed'], 'denied registration cannot skip the next');
    assert.deepEqual(h.events.filter(e => ['commit', 'seek', 'pause'].includes(e[0])), [['commit', '7'], ['seek', '7'], ['pause']]);
    for (const delay of [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
      assert.equal(h.fireTimer(), delay);
      await h.deliver();
    }
    assert.equal(h.events.filter(e => e[0] === 'commit' && e[1] === '8').length, 0);
    h.allow();
    h.fireTimer();
    await h.deliver();
    assert.deepEqual(h.starts, ['allowed', 'denied']);
    assert.ok(h.events.some(e => e[0] === 'deduplicated' && e[1] === 'allowed'));
    assert.deepEqual(h.events.filter(e => e[0] === 'commit').at(-1), ['commit', '8']);
  } finally { await h.registry.close(); }
});

test('past the age bound, log one structured abandonment and acknowledge without holding', async () => {
  const h = await setup({ timestamp: 900_000, maxDeferMs: 99_999 });
  try {
    h.commitFailure = true;
    await h.deliver();
    h.commitFailure = false;
    await h.deliver();
    const abandoned = h.logs.filter(args => String(args[0]).includes('flow_event_trigger_quota_abandoned'));
    assert.equal(abandoned.length, 1);
    const row = JSON.parse(abandoned[0][0]);
    assert.deepEqual({ topic: row.topic, partition: row.partition, offset: row.offset, dimension: row.dimension, reason: row.reason }, { topic: 'evt.workspace.orders', partition: 0, offset: '7', dimension: 'flow_starts_per_minute', reason: 'metering_unavailable' });
    assert.deepEqual(row.registrationIds, ['denied:platform-event:orders']);
    assert.deepEqual(h.events.filter(e => e[0] === 'commit'), [['commit', '8'], ['commit', '8']]);
    assert.equal(h.events.some(e => ['seek', 'pause'].includes(e[0])), false);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.starts, ['allowed']);
  } finally { await h.registry.close(); }
});

for (const priorCommit of [undefined, '6']) {
  test(`stop/re-subscription retains denied delivery with prior commit ${priorCommit ?? 'absent'}`, async () => {
    const h = await setup({ priorCommit });
    try {
      await h.deliver();
      assert.equal(h.timers.size, 1);
      await h.resubscribe();
      assert.equal(h.timers.size, 0, 'stop clears old resume timers');
      h.allow();
      assert.equal(await h.deliver(), true, 'restart reads denied offset, including a new partition');
      assert.deepEqual(h.starts, ['allowed', 'denied']);
      assert.ok(h.events.some(e => e[0] === 'deduplicated' && e[1] === 'allowed'));
      assert.deepEqual(h.events.filter(e => e[0] === 'commit'), [['commit', '7'], ['commit', '8']]);
    } finally { await h.registry.close(); }
  });
}

test('close clears pending resume timers', async () => {
  const h = await setup();
  await h.deliver();
  await h.registry.close();
  assert.equal(h.timers.size, 0);
});

test('non-quota failure does not hold an event or skip the next registration', async () => {
  const h = await setup();
  try {
    h.fail(new Error('Temporal unavailable'));
    await h.deliver();
    assert.deepEqual(h.starts, ['allowed']);
    assert.deepEqual(h.events.filter(e => ['commit', 'seek', 'pause'].includes(e[0])), [['commit', '8']]);
    assert.equal(h.logs.length, 1);
  } finally { await h.registry.close(); }
});

test('a failed denied-offset commit stays held and retries the checkpoint on redelivery', async () => {
  const h = await setup();
  try {
    h.commitFailure = true;
    await h.deliver();
    assert.deepEqual(h.events.filter(e => ['seek', 'pause'].includes(e[0])), [['seek', '7'], ['pause']]);
    h.commitFailure = false;
    h.fireTimer();
    await h.deliver();
    assert.deepEqual(h.events.filter(e => e[0] === 'commit'), [['commit', '7'], ['commit', '7']]);
    await h.resubscribe();
    h.allow();
    assert.equal(await h.deliver(), true);
    assert.deepEqual(h.starts, ['allowed', 'denied']);
  } finally { await h.registry.close(); }
});

test('production consumer disables implicit commits and exposes offset controls', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../../apps/control-plane-executor/src/runtime/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /consumer\.run\(\{\s*autoCommit:\s*false,\s*eachMessage\s*\}\)/);
  assert.match(main, /seek:\s*\([^)]*\)\s*=>\s*consumer\.seek\(/);
  assert.match(main, /commitOffsets:\s*\([^)]*\)\s*=>\s*consumer\.commitOffsets\(/);
});

test('a failed handled-message commit logs and a restart deduplicates delivery', async () => {
  const h = await setup({ priorCommit: '7' });
  try {
    h.allow();
    h.commitFailure = true;
    await h.deliver();
    assert.deepEqual(h.starts, ['denied', 'allowed']);
    await h.resubscribe();
    h.commitFailure = false;
    assert.equal(await h.deliver(), true);
    assert.deepEqual(h.starts, ['denied', 'allowed']);
    assert.equal(h.events.filter(e => e[0] === 'deduplicated').length, 2);
    assert.deepEqual(h.events.filter(e => e[0] === 'commit'), [['commit', '8'], ['commit', '8']]);
    assert.equal(h.events.some(e => ['seek', 'pause'].includes(e[0])), false);
    assert.equal(h.logs.length, 1);
  } finally { await h.registry.close(); }
});
