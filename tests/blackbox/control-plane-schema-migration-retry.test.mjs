/**
 * Black-box regression suite for spec change fix-control-plane-schema-migration-retry
 * (live E2E campaign 2026-06-17, finding D5).
 *
 * Drives the control-plane boot retry helper through its public interface
 * (deploy/kind/control-plane/schema-retry.mjs). Deterministic: the clock and sleep are injected,
 * so no real timers or database are involved.
 *
 * Defect: the control-plane ran ensureSchema -> ensureSagaSchema -> recoverSagas exactly once on
 * boot and only logged on failure, so a startup ECONNREFUSED (Postgres not ready) left the
 * `tenants`/saga tables uncreated and every tenant op 500'd until a manual pod restart.
 *
 * Fix: retry with exponential backoff until success or a configurable timeout; then rethrow so
 * the caller exits non-zero (pod restarts and retries).
 *
 * Scenario coverage (capability: tenant-lifecycle / spec.md):
 *   bbx-d5-01  transient ECONNREFUSED on the first 2 attempts → succeeds on the 3rd
 *   bbx-d5-02  persistent failure past the timeout → rejects (caller exits non-zero), bounded attempts
 *   bbx-d5-03  backoff is exponential and capped at maxDelayMs
 *   bbx-d5-04  migrationRetryConfig defaults and env overrides
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithRetry, migrationRetryConfig } from '../../deploy/kind/control-plane/schema-retry.mjs';

const SILENT = { log() {}, error() {} };

/** Virtual clock: sleep() advances now() so deadline logic is deterministic. */
function fakeClock(start = 0) {
  let t = start;
  const waits = [];
  return {
    now: () => t,
    sleep: async (ms) => { waits.push(ms); t += ms; },
    waits,
  };
}

function econnrefused() {
  const e = new Error('connect ECONNREFUSED 10.96.0.5:5432');
  e.code = 'ECONNREFUSED';
  return e;
}

// -------------------------------------------------------------------------
// bbx-d5-01: transient failures then success
// -------------------------------------------------------------------------
test('bbx-d5-01: ECONNREFUSED on first 2 attempts → migration succeeds on the 3rd', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await runWithRetry(
    async (attempt) => {
      calls += 1;
      if (calls <= 2) throw econnrefused();
      return `recovered:${attempt}`;
    },
    { initialDelayMs: 1000, maxDelayMs: 30000, timeoutMs: 300000, now: clock.now, sleep: clock.sleep, log: SILENT },
  );
  assert.equal(result, 'recovered:3');
  assert.equal(calls, 3, 'task must run exactly 3 times');
  assert.deepEqual(clock.waits, [1000, 2000], 'backoff before attempts 2 and 3');
});

// -------------------------------------------------------------------------
// bbx-d5-02: persistent failure past the timeout rejects (caller exits non-zero)
// -------------------------------------------------------------------------
test('bbx-d5-02: persistent failure past the timeout rejects after bounded attempts', async () => {
  const clock = fakeClock();
  let calls = 0;
  await assert.rejects(
    runWithRetry(
      async () => { calls += 1; throw econnrefused(); },
      { initialDelayMs: 1000, maxDelayMs: 30000, timeoutMs: 5000, now: clock.now, sleep: clock.sleep, log: SILENT },
    ),
    /ECONNREFUSED/,
  );
  // deadline=5000: attempts at t=0,1000,3000,5000 → 4 attempts, last has remaining<=0 → throw
  assert.equal(calls, 4, 'must stop retrying once the deadline passes (no infinite loop)');
  assert.deepEqual(clock.waits, [1000, 2000, 2000], 'final wait is clamped to the remaining budget');
});

// -------------------------------------------------------------------------
// bbx-d5-03: exponential backoff capped at maxDelayMs
// -------------------------------------------------------------------------
test('bbx-d5-03: backoff doubles and is capped at maxDelayMs', async () => {
  const clock = fakeClock();
  let calls = 0;
  await runWithRetry(
    async () => { calls += 1; if (calls < 6) throw econnrefused(); return 'ok'; },
    { initialDelayMs: 1000, maxDelayMs: 4000, timeoutMs: 1_000_000_000, now: clock.now, sleep: clock.sleep, log: SILENT },
  );
  assert.deepEqual(clock.waits, [1000, 2000, 4000, 4000, 4000], 'doubles to the cap then holds');
});

// -------------------------------------------------------------------------
// bbx-d5-04: configuration defaults and env overrides
// -------------------------------------------------------------------------
test('bbx-d5-04: migrationRetryConfig defaults and env overrides', () => {
  assert.deepEqual(migrationRetryConfig({}), {
    timeoutMs: 300_000,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
  });
  assert.deepEqual(
    migrationRetryConfig({
      SCHEMA_MIGRATION_TIMEOUT_MS: '60000',
      SCHEMA_MIGRATION_INITIAL_DELAY_MS: '500',
      SCHEMA_MIGRATION_MAX_DELAY_MS: '10000',
    }),
    { timeoutMs: 60_000, initialDelayMs: 500, maxDelayMs: 10_000 },
  );
  // garbage / negative values fall back to the defaults
  assert.deepEqual(migrationRetryConfig({ SCHEMA_MIGRATION_TIMEOUT_MS: 'nope', SCHEMA_MIGRATION_MAX_DELAY_MS: '-5' }), {
    timeoutMs: 300_000,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
  });
});
