// Unit tests for the flow-monitoring executor (change: add-console-flow-monitoring / #366).
//
// Covers the PURE history→SSE-frame mapping, the #359 node-ID convention, the fail-closed
// tenant-isolation check (foreign workflow id → 403 before any history is fetched), terminal-state
// replay + stream-end, and Last-Event-ID resume. No Temporal infra: a fake workflowHistoryProvider
// supplies the history snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  historyToFrames,
  nodeIdFromActivityId,
  createFlowMonitoringExecutor,
  isTerminalStatus,
} from '../../apps/control-plane/src/runtime/flow-monitoring-executor.mjs';
import { buildWorkflowId } from '../../apps/control-plane/src/runtime/flow-executor.mjs';

// ---- node-ID convention (#359) -------------------------------------------------------------

test('flw-mon-unit-01: nodeIdFromActivityId strips the #<loop> suffix', () => {
  assert.equal(nodeIdFromActivityId('step-1'), 'step-1');
  assert.equal(nodeIdFromActivityId('step-2#3'), 'step-2');
  assert.equal(nodeIdFromActivityId('loop-node#0'), 'loop-node');
});

// ---- pure history → frames mapping ---------------------------------------------------------

const HISTORY = [
  { eventId: 5, eventTime: '2026-01-01T00:00:01Z', activityTaskScheduledEventAttributes: { activityId: 'a' } },
  { eventId: 6, eventTime: '2026-01-01T00:00:02Z', activityTaskStartedEventAttributes: { scheduledEventId: 5, attempt: 1 } },
  { eventId: 7, eventTime: '2026-01-01T00:00:03Z', activityTaskCompletedEventAttributes: { scheduledEventId: 5 } },
  { eventId: 8, eventTime: '2026-01-01T00:00:04Z', activityTaskScheduledEventAttributes: { activityId: 'b#2' } },
  { eventId: 9, eventTime: '2026-01-01T00:00:05Z', activityTaskStartedEventAttributes: { scheduledEventId: 8, attempt: 2 } },
  { eventId: 10, eventTime: '2026-01-01T00:00:06Z', activityTaskFailedEventAttributes: { scheduledEventId: 8, failure: { message: 'boom', stackTrace: 'at x' } } },
  { eventId: 11, eventTime: '2026-01-01T00:00:07Z', timerStartedEventAttributes: { timerId: 'wait-1' } },
  { eventId: 12, eventTime: '2026-01-01T00:00:08Z', timerFiredEventAttributes: { timerId: 'wait-1', startedEventId: 11 } },
  { eventId: 13, eventTime: '2026-01-01T00:00:09Z', markerRecordedEventAttributes: { markerName: 'node-status', details: { nodeId: [{ data: 'c' }], status: [{ data: 'skipped' }] } } },
  { eventId: 14, eventTime: '2026-01-01T00:00:10Z', markerRecordedEventAttributes: { markerName: 'log-line', details: { nodeId: [{ data: 'a' }], level: [{ data: 'warn' }], message: [{ data: 'slow' }] } } },
];

test('flw-mon-unit-02: maps the activity lifecycle to node-status frames', () => {
  const frames = historyToFrames(HISTORY);
  const ns = frames.filter((f) => f.kind === 'node-status').map((f) => f.payload);
  // a: scheduled → started → completed
  assert.deepEqual(ns.filter((p) => p.nodeId === 'a').map((p) => p.status), ['scheduled', 'started', 'completed']);
  // b: scheduled (attempt 2 → retrying on started), then a failed attempt with the error
  const b = ns.filter((p) => p.nodeId === 'b');
  assert.equal(b[0].status, 'scheduled');
  assert.equal(b[1].status, 'retrying', 'attempt>1 surfaces as retrying');
  assert.equal(b[1].attemptNumber, 2);
  const failed = b.find((p) => p.error);
  assert.ok(failed, 'a failed frame carries the error');
  assert.equal(failed.error.message, 'boom');
  assert.equal(failed.error.stack, 'at x');
});

test('flw-mon-unit-03: timer + marker events map to node-status (wait completed, node skipped)', () => {
  const frames = historyToFrames(HISTORY);
  const ns = frames.filter((f) => f.kind === 'node-status').map((f) => f.payload);
  assert.ok(ns.some((p) => p.nodeId === 'wait-1' && p.status === 'started'));
  assert.ok(ns.some((p) => p.nodeId === 'wait-1' && p.status === 'completed'));
  assert.ok(ns.some((p) => p.nodeId === 'c' && p.status === 'skipped'), 'marker-driven skipped status');
});

test('flw-mon-unit-04: log-line markers map to log-line frames', () => {
  const frames = historyToFrames(HISTORY);
  const logs = frames.filter((f) => f.kind === 'log-line').map((f) => f.payload);
  assert.equal(logs.length, 1);
  assert.deepEqual({ nodeId: logs[0].nodeId, level: logs[0].level, message: logs[0].message }, { nodeId: 'a', level: 'warn', message: 'slow' });
});

test('flw-mon-unit-05: every frame carries a monotonic seq derived from eventId', () => {
  const frames = historyToFrames(HISTORY);
  const seqs = frames.map((f) => f.seq);
  for (let i = 1; i < seqs.length; i += 1) assert.ok(seqs[i] >= seqs[i - 1], 'seq is non-decreasing');
});

// ---- tenant isolation (fail-closed) --------------------------------------------------------

function provider(events, status = 'Completed') {
  let described = 0;
  let fetched = 0;
  return {
    counters: () => ({ described, fetched }),
    async describe() { described += 1; return { status: { name: status } }; },
    async fetchHistory() { fetched += 1; return { events }; },
    isTerminal: isTerminalStatus,
  };
}

async function collect(sub) {
  const events = [];
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  return { events, done, resolveDone };
}

test('flw-mon-unit-06: foreign workflow id is rejected with 403 BEFORE any history access', async () => {
  const p = provider(HISTORY);
  const exec = createFlowMonitoringExecutor({ workflowHistoryProvider: p, pollIntervalMs: 1 });
  const foreignId = buildWorkflowId('ten-OTHER', 'ws-OTHER', 'f', 'r1');
  await assert.rejects(
    () => exec.subscribe({
      executionId: foreignId,
      identity: { tenantId: 'ten-A', workspaceId: 'ws-A' },
      onEvent() {}, onError() {},
    }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  // No provider call happened — the prefix check short-circuits.
  assert.deepEqual(p.counters(), { described: 0, fetched: 0 }, 'no history fetched for a foreign id');
});

test('flw-mon-unit-07: terminal execution replays history then emits stream-end', async () => {
  const p = provider(HISTORY, 'Completed');
  const exec = createFlowMonitoringExecutor({ workflowHistoryProvider: p, pollIntervalMs: 1 });
  const ownedId = buildWorkflowId('ten-A', 'ws-A', 'f', 'r1');
  const out = [];
  await new Promise((resolve) => {
    void exec.subscribe({
      executionId: ownedId,
      identity: { tenantId: 'ten-A', workspaceId: 'ws-A' },
      onEvent: (e) => { out.push(e); if (e.type === 'stream-end') resolve(); },
      onError: () => {},
    });
  });
  assert.equal(out.at(-1).type, 'stream-end', 'stream-end is the last frame');
  const nodeStatus = out.filter((e) => e.type === 'node-status');
  assert.ok(nodeStatus.length > 0, 'history replayed as node-status frames');
});

test('flw-mon-unit-08: Last-Event-ID resume skips frames with seq <= the supplied id', async () => {
  const p = provider(HISTORY, 'Completed');
  const exec = createFlowMonitoringExecutor({ workflowHistoryProvider: p, pollIntervalMs: 1 });
  const ownedId = buildWorkflowId('ten-A', 'ws-A', 'f', 'r1');
  const out = [];
  await new Promise((resolve) => {
    void exec.subscribe({
      executionId: ownedId,
      identity: { tenantId: 'ten-A', workspaceId: 'ws-A' },
      lastEventId: '8', // resume after eventId 8
      onEvent: (e) => { out.push(e); if (e.type === 'stream-end') resolve(); },
      onError: () => {},
    });
  });
  const ids = out.filter((e) => e.id).map((e) => Number(e.id));
  assert.ok(ids.every((id) => id > 8), 'no frame with seq <= 8 re-emitted');
});
