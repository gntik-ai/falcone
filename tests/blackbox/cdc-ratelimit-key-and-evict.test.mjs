/**
 * Black-box tests for CDC rate-limit key isolation and map eviction
 * (fix-cdc-ratelimit-key-and-evict).
 *
 * Tests drive the public exported API of KafkaChangePublisher (pg-cdc-bridge only).
 * No internal knowledge assumed beyond observing publisher.windows.size and the
 * return value of publish() / the 'rate-limited' event.
 *
 * bbx-cdc-ratelimit-key-01: CROSS-TENANT NO-ALIASING — tenant A exhausting its budget
 *   for a given workspace_id MUST NOT block tenant B using the same workspace_id.
 * bbx-cdc-ratelimit-evict-01: EVICTION/BOUNDED MAP — idle entries are removed after
 *   the 1-second window expires; the map does not grow unboundedly.
 * bbx-cdc-ratelimit-key-02: composite key shape — publisher.windows keys use the
 *   `${tenantId}:${workspaceId}` format after a publish.
 * bbx-cdc-ratelimit-active-01: ACTIVE ENTRY NOT PREMATURELY EVICTED — entries in the
 *   current window survive until a new eviction cycle.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KafkaChangePublisher,
} from '../../services/pg-cdc-bridge/src/KafkaChangePublisher.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake kafka object that records sent messages. */
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

/** Minimal valid decoded event. */
function fakeEvent() {
  return {
    type: 'insert',
    relation: { namespace: 'public', relationName: 'items' },
    newRow: { id: '1' },
    sequence: 0,
  };
}

/**
 * Create a publisher with a controlled Date.now via monkey-patch.
 * Returns { publisher, setNow }.
 */
function publisherWithFakeClock(maxEventsPerSecond = 2) {
  const { kafka } = { kafka: fakeKafka() };
  const fk = fakeKafka();
  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond });
  let fakeNow = Date.now();
  const origDateNow = Date.now.bind(Date);
  // Patch Date.now globally for this publisher's lifetime.
  // We restore it after the test.
  return {
    publisher,
    fk,
    setNow: (ms) => { fakeNow = ms; },
    getNow: () => fakeNow,
    install: () => {
      Date.now = () => fakeNow;
    },
    uninstall: () => {
      Date.now = origDateNow;
    },
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

// ===========================================================================
// bbx-cdc-ratelimit-key-01: CROSS-TENANT NO-ALIASING
// ===========================================================================
test('bbx-cdc-ratelimit-key-01: exhausting tenant A budget for workspace wrk_SAME does NOT block tenant B', async () => {
  const fk = fakeKafka();
  // maxEventsPerSecond=2 so 3rd event for same window is rate-limited
  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 2 });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 1_000_000;
  Date.now = () => fakeNow;

  try {
    // Exhaust tenant-a's budget for wrk_SAME within the same window
    const r1 = await pub(publisher, 'tenant-a', 'wrk_SAME');
    const r2 = await pub(publisher, 'tenant-a', 'wrk_SAME');
    // third call for tenant-a should be rate-limited (count > maxEventsPerSecond)
    const r3 = await pub(publisher, 'tenant-a', 'wrk_SAME');

    // r3 must be null (rate-limited) — tenant A is at the limit
    assert.equal(r3, null, 'tenant-a 3rd event must be rate-limited (null)');

    // Now publish for tenant-b with the SAME workspace_id — must NOT be blocked
    const rB = await pub(publisher, 'tenant-b', 'wrk_SAME');
    assert.notEqual(rB, null, 'tenant-b must NOT be rate-limited by tenant-a\'s counter (cross-tenant aliasing bug)');
  } finally {
    Date.now = prevDateNow;
    await publisher.disconnect();
  }
});

// ===========================================================================
// bbx-cdc-ratelimit-key-02: composite key shape
// ===========================================================================
test('bbx-cdc-ratelimit-key-02: windows map uses composite tenantId:workspaceId key', async () => {
  const fk = fakeKafka();
  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 100 });
  await publisher.initialize();

  await pub(publisher, 'tenant-x', 'wrk-42');

  // The map must contain the composite key, not just the bare workspaceId
  const compositeKey = 'tenant-x:wrk-42';
  assert.ok(
    publisher.windows.has(compositeKey),
    `Expected composite key "${compositeKey}" in windows map; keys found: ${[...publisher.windows.keys()].join(', ')}`
  );
  // And must NOT contain the bare workspaceId as a standalone key
  assert.ok(
    !publisher.windows.has('wrk-42'),
    'windows map must NOT contain bare workspaceId as a key (missing tenantId prefix)'
  );

  await publisher.disconnect();
});

// ===========================================================================
// bbx-cdc-ratelimit-evict-01: EVICTION / BOUNDED MAP
// ===========================================================================
test('bbx-cdc-ratelimit-evict-01: idle entries are evicted after the window expires', async () => {
  const fk = fakeKafka();
  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 100 });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 2_000_000;
  Date.now = () => fakeNow;

  try {
    // Publish for several distinct tenant:workspace pairs at t=0
    const pairs = [
      ['tenant-a', 'wrk-1'],
      ['tenant-b', 'wrk-2'],
      ['tenant-c', 'wrk-3'],
    ];
    for (const [tid, wid] of pairs) {
      await pub(publisher, tid, wid);
    }

    // Map should have 3 entries now
    assert.equal(publisher.windows.size, 3, `Expected 3 entries before eviction; got ${publisher.windows.size}`);

    // Advance time by >1000ms so all existing entries are considered idle
    fakeNow += 1100;

    // Publish for a NEW pair — this triggers the throttled eviction sweep
    await pub(publisher, 'tenant-new', 'wrk-new');

    // After the sweep, only the freshly-added 'tenant-new:wrk-new' entry should survive;
    // the 3 idle entries (windowStart is 1100ms old) must have been evicted.
    const compositeNewKey = 'tenant-new:wrk-new';
    assert.ok(
      publisher.windows.has(compositeNewKey),
      `Active key "${compositeNewKey}" must remain after eviction`
    );

    // The 3 old entries must be gone
    for (const [tid, wid] of pairs) {
      const k = `${tid}:${wid}`;
      assert.ok(
        !publisher.windows.has(k),
        `Idle key "${k}" must have been evicted but is still present`
      );
    }

    // Total map size must be 1 (only the active entry survives)
    assert.equal(
      publisher.windows.size,
      1,
      `Map must contain exactly 1 active entry after eviction; got ${publisher.windows.size}`
    );
  } finally {
    Date.now = prevDateNow;
    await publisher.disconnect();
  }
});

// ===========================================================================
// bbx-cdc-ratelimit-active-01: ACTIVE ENTRIES NOT PREMATURELY EVICTED
// ===========================================================================
test('bbx-cdc-ratelimit-active-01: active entry within current window is not evicted prematurely', async () => {
  const fk = fakeKafka();
  const publisher = new KafkaChangePublisher({ kafka: fk, maxEventsPerSecond: 100 });
  await publisher.initialize();

  const prevDateNow = Date.now;
  let fakeNow = 3_000_000;
  Date.now = () => fakeNow;

  try {
    // Publish for two pairs — one that will be kept active, one that will go idle
    await pub(publisher, 'tenant-keep', 'wrk-keep');
    await pub(publisher, 'tenant-idle', 'wrk-idle');

    // Advance time >1s so both are old
    fakeNow += 1100;

    // Publish again for tenant-keep:wrk-keep — this resets its windowStart to fakeNow
    await pub(publisher, 'tenant-keep', 'wrk-keep');

    // Now advance a tiny bit more and trigger another eviction via a new pair
    fakeNow += 10;
    await pub(publisher, 'tenant-trigger', 'wrk-trigger');

    // tenant-idle:wrk-idle must be gone (idle for >1s)
    assert.ok(
      !publisher.windows.has('tenant-idle:wrk-idle'),
      'Idle entry tenant-idle:wrk-idle must be evicted'
    );

    // tenant-keep:wrk-keep must still be present (freshly updated windowStart)
    assert.ok(
      publisher.windows.has('tenant-keep:wrk-keep'),
      'Active entry tenant-keep:wrk-keep must NOT be evicted'
    );
  } finally {
    Date.now = prevDateNow;
    await publisher.disconnect();
  }
});
