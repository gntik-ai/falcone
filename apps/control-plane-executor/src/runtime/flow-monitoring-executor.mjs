// Flow-monitoring executor (change: add-console-flow-monitoring / #366).
//
// The execution-observability sibling of flow-executor.mjs: it follows a single Temporal
// workflow execution's history and translates it to typed SSE frames (node-status / log-line)
// for the console run view. It mirrors realtime-executor.mjs's `subscribe(...)` shape so
// server.mjs::runRealtimeSse can drive it verbatim:
//
//   subscribe({ workspaceId, executionId, identity, signal, lastEventId, onEvent, onError })
//     -> { close }
//
// Tenant isolation is STRUCTURAL and fail-closed (design.md D2, shared with flow-executor.mjs):
// every Temporal workflow id is `{tenantId}:{workspaceId}:{flowId}:{runUuid}` minted server-side.
// BEFORE any history is accessed, the executor verifies the workflow-id prefix matches the
// caller's `{identity.tenantId}:{identity.workspaceId}`. A foreign prefix throws
// { statusCode: 403, code: 'FORBIDDEN' } so the route rejects the stream before opening it — the
// streaming endpoint is the classic cross-tenant leakage vector and never touches foreign history.
//
// History → SSE mapping uses the #359 node-ID naming convention: ActivityTaskScheduled.activityId
// IS the DSL node id (verbatim, with an optional `#<loop>` suffix stripped). The history poll is
// long-poll-ish: it re-fetches at `pollIntervalMs` until the execution reaches a terminal state,
// emitting only NEW frames each pass. A `Last-Event-ID` resume skips frames whose sequence id is
// <= the supplied value. A terminal execution replays persisted history then emits `stream-end`.
//
// Temporal access is abstracted behind a `workflowHistoryProvider` ({ describe, fetchHistory,
// isTerminal }) so the module is unit-testable WITHOUT @temporalio/client. main.mjs builds a
// real provider over the flow-executor's Temporal client (lazy connect); the blackbox suite
// injects a fake provider. When neither is available the executor is `undefined` and the SSE
// route falls through to the 501 guard.

import { parseWorkflowId } from './flow-executor.mjs';
import { clientError } from './errors.mjs';

// Terminal Temporal execution statuses. The SDK surfaces TWO casings for the same state:
//   - describe().status.name → the protobuf ENUM name, e.g. 'COMPLETED' / 'WORKFLOW_EXECUTION_STATUS_COMPLETED'
//   - workflow.list()        → the visibility/search-attribute form, e.g. 'Completed'
// We normalise (strip the WORKFLOW_EXECUTION_STATUS_ prefix, drop separators, lowercase) so the
// terminal check is robust across both — a real-stack mismatch here would hang the live follow.
const TERMINAL_STATUS_KEYS = new Set([
  'completed', 'failed', 'canceled', 'cancelled', 'terminated', 'timedout', 'continuedasnew',
]);

function normaliseStatusKey(status) {
  if (status == null) return '';
  return String(status)
    .replace(/^WORKFLOW_EXECUTION_STATUS_/i, '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();
}

const NODE_ID_LOOP_SEPARATOR = '#';

// Recover the DSL node id from a Temporal activityId (drops any `#<loop>` suffix) — the #359
// naming convention. Kept local (a 2-line pure function) so this module has no worker dependency.
export function nodeIdFromActivityId(activityId) {
  if (typeof activityId !== 'string') return activityId;
  const idx = activityId.indexOf(NODE_ID_LOOP_SEPARATOR);
  return idx === -1 ? activityId : activityId.slice(0, idx);
}

function isTerminalStatus(status) {
  return TERMINAL_STATUS_KEYS.has(normaliseStatusKey(status));
}

// Normalise a Temporal history event time (Long | {seconds,nanos} | ISO string | Date) to an ISO
// string, best-effort. The fake provider and the real SDK both surface `eventTime`.
function toIso(eventTime) {
  if (!eventTime) return null;
  if (typeof eventTime === 'string') return eventTime;
  if (eventTime instanceof Date) return eventTime.toISOString();
  // protobuf Timestamp { seconds, nanos }
  if (typeof eventTime === 'object' && eventTime.seconds !== undefined) {
    const ms = Number(eventTime.seconds) * 1000 + Math.floor(Number(eventTime.nanos ?? 0) / 1e6);
    return new Date(ms).toISOString();
  }
  return null;
}

// Pull a string from a Temporal marker `details` payload-list entry ({ data } | string | object).
function markerString(entry) {
  if (entry == null) return undefined;
  const first = Array.isArray(entry) ? entry[0] : entry;
  if (first == null) return undefined;
  if (typeof first === 'string') return first;
  if (typeof first.data === 'string') return first.data;
  if (first.data != null && typeof first.data === 'object') return undefined;
  return undefined;
}

// Translate a raw Temporal history event list into an ORDERED list of monitoring frames
// (node-status + log-line). Each frame is { kind, seq, payload } where seq is a monotonic
// sequence id derived from the source eventId so Last-Event-ID resume is stable across reconnects.
//
// The mapping is pure (no I/O) so it is unit-tested directly:
//   ActivityTaskScheduled  -> node-status scheduled
//   ActivityTaskStarted    -> node-status started (attemptNumber)   [a retry attempt>1 → retrying]
//   ActivityTaskCompleted  -> node-status completed
//   ActivityTaskFailed     -> node-status failed/retrying (+ error)
//   ActivityTaskTimedOut   -> node-status failed (+ error)
//   TimerFired             -> node-status completed for the timer's wait node
//   MarkerRecorded(node-status) -> node-status with the marker's explicit status (e.g. skipped)
//   MarkerRecorded(log-line)    -> log-line
export function historyToFrames(events = []) {
  // Map scheduledEventId -> { nodeId, attemptNumber } so Started/Completed/Failed events (which
  // reference the scheduled event, not the activityId) resolve back to the DSL node id.
  const scheduledById = new Map();
  const timerById = new Map();
  const frames = [];

  for (const ev of events) {
    const seq = Number(ev?.eventId ?? frames.length + 1);
    const at = toIso(ev?.eventTime);

    const sched = ev?.activityTaskScheduledEventAttributes;
    if (sched?.activityId != null) {
      const rawId = String(sched.activityId);
      const nodeId = nodeIdFromActivityId(rawId);
      const loopIdx = rawId.indexOf(NODE_ID_LOOP_SEPARATOR);
      const attemptNumber = loopIdx === -1 ? 1 : Number(rawId.slice(loopIdx + 1)) || 1;
      scheduledById.set(seq, { nodeId, attemptNumber });
      frames.push(frame('node-status', seq, { nodeId, status: 'scheduled', attemptNumber, startedAt: null, completedAt: null }));
      continue;
    }

    const started = ev?.activityTaskStartedEventAttributes;
    if (started) {
      const ref = scheduledById.get(Number(started.scheduledEventId));
      if (ref) {
        const attemptNumber = Number(started.attempt ?? ref.attemptNumber ?? 1) || 1;
        const status = attemptNumber > 1 ? 'retrying' : 'started';
        frames.push(frame('node-status', seq, { nodeId: ref.nodeId, status, attemptNumber, startedAt: at, completedAt: null }));
      }
      continue;
    }

    const completed = ev?.activityTaskCompletedEventAttributes;
    if (completed) {
      const ref = scheduledById.get(Number(completed.scheduledEventId));
      if (ref) frames.push(frame('node-status', seq, { nodeId: ref.nodeId, status: 'completed', attemptNumber: ref.attemptNumber, startedAt: null, completedAt: at }));
      continue;
    }

    const failed = ev?.activityTaskFailedEventAttributes;
    if (failed) {
      const ref = scheduledById.get(Number(failed.scheduledEventId));
      if (ref) {
        // A failed attempt that is followed by a re-schedule is a retry; we surface `retrying`
        // when Temporal will retry (retryState RETRY) and `failed` when it is terminal. Without
        // explicit retryState we conservatively mark `retrying` (a re-scheduled attempt overwrites
        // it on the badge if the next attempt starts) but always carry the error.
        const willRetry = failed.retryState === undefined || failed.retryState === 'RETRY_STATE_IN_PROGRESS' || failed.retryState === 1;
        frames.push(frame('node-status', seq, {
          nodeId: ref.nodeId, status: willRetry ? 'retrying' : 'failed', attemptNumber: ref.attemptNumber,
          startedAt: null, completedAt: at, error: errorFromFailure(failed.failure),
        }));
      }
      continue;
    }

    const timedOut = ev?.activityTaskTimedOutEventAttributes;
    if (timedOut) {
      const ref = scheduledById.get(Number(timedOut.scheduledEventId));
      if (ref) frames.push(frame('node-status', seq, { nodeId: ref.nodeId, status: 'failed', attemptNumber: ref.attemptNumber, startedAt: null, completedAt: at, error: { message: 'Activity timed out' } }));
      continue;
    }

    const timerStarted = ev?.timerStartedEventAttributes;
    if (timerStarted?.timerId != null) {
      const nodeId = nodeIdFromActivityId(String(timerStarted.timerId));
      timerById.set(seq, nodeId);
      frames.push(frame('node-status', seq, { nodeId, status: 'started', attemptNumber: 1, startedAt: at, completedAt: null }));
      continue;
    }

    const timerFired = ev?.timerFiredEventAttributes;
    if (timerFired) {
      const nodeId = timerById.get(Number(timerFired.startedEventId)) ?? nodeIdFromActivityId(String(timerFired.timerId ?? ''));
      if (nodeId) frames.push(frame('node-status', seq, { nodeId, status: 'completed', attemptNumber: 1, startedAt: null, completedAt: at }));
      continue;
    }

    const marker = ev?.markerRecordedEventAttributes;
    if (marker?.markerName === 'node-status') {
      const d = marker.details ?? {};
      const nodeId = markerString(d.nodeId);
      const status = markerString(d.status);
      if (nodeId && status) {
        frames.push(frame('node-status', seq, { nodeId, status, attemptNumber: 1, startedAt: at, completedAt: at }));
      }
      continue;
    }
    if (marker?.markerName === 'log-line') {
      const d = marker.details ?? {};
      const nodeId = markerString(d.nodeId);
      const level = markerString(d.level) ?? 'info';
      const message = markerString(d.message) ?? '';
      frames.push(frame('log-line', seq, { nodeId, level, message, timestamp: at }));
      continue;
    }
  }
  return frames;
}

function frame(kind, seq, payload) {
  return { kind, seq, payload };
}

function errorFromFailure(failure) {
  if (!failure) return undefined;
  const message = typeof failure === 'string' ? failure : (failure.message ?? 'Activity failed');
  const stack = failure.stackTrace ?? failure.stack ?? undefined;
  return stack ? { message, stack } : { message };
}

// Build a workflowHistoryProvider over a Temporal client (the flow-executor's lazy-connect client).
// `getClient()` returns a connected @temporalio/client `Client`. Used by main.mjs; never imported
// in the no-infra blackbox path (which injects a fake provider).
export function createTemporalHistoryProvider({ getClient }) {
  return {
    async describe(workflowId) {
      const client = await getClient();
      const handle = client.workflow.getHandle(workflowId);
      const described = await handle.describe();
      return { status: { name: described.status?.name ?? described.status ?? null }, workflowId };
    },
    async fetchHistory(workflowId) {
      const client = await getClient();
      const handle = client.workflow.getHandle(workflowId);
      return handle.fetchHistory();
    },
    isTerminal(status) {
      return isTerminalStatus(status);
    },
  };
}

export function createFlowMonitoringExecutor({
  workflowHistoryProvider,
  pollIntervalMs = 1000,
  // Maximum number of poll passes for a live (non-terminal) follow before the executor gives up
  // and closes the stream cleanly (the browser EventSource will reconnect with Last-Event-ID).
  maxLivePolls = 600,
  logger = console,
} = {}) {
  if (!workflowHistoryProvider) {
    throw new TypeError('createFlowMonitoringExecutor requires a workflowHistoryProvider');
  }

  // Verify the caller owns the workflow id BEFORE any history is fetched (fail-closed, 403). The
  // workspaceId path segment is the public address; the AUTHORITATIVE tenant/workspace come from
  // the verified identity (resolveIdentity), never the URL.
  function assertOwned(executionId, identity) {
    const parsed = parseWorkflowId(executionId);
    const owned =
      parsed &&
      parsed.tenantId === identity?.tenantId &&
      parsed.workspaceId === identity?.workspaceId;
    if (!owned) {
      // 403 (not 404): a streaming mutation-adjacent path; never reveal whether the run exists.
      throw clientError('Forbidden', 403, 'FORBIDDEN');
    }
    return parsed;
  }

  async function describeStatus(executionId) {
    const described = await workflowHistoryProvider.describe(executionId);
    return described?.status?.name ?? described?.status ?? null;
  }

  // The realtime-executor-shaped subscribe entrypoint. Emits ordered frames via onEvent and a
  // single terminal `stream-end` via onEvent({ type: 'stream-end' }) when the run is closed.
  // Returns { close } and stops when params.signal aborts.
  async function subscribe(params) {
    const { executionId, identity, lastEventId, onEvent, onError, signal } = params;
    if (!identity?.tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING');
    // Fail-closed tenant check FIRST — before any provider call. Throws 403 on a foreign prefix.
    assertOwned(executionId, identity);

    let closed = false;
    let resumeSeq = lastEventId != null && lastEventId !== '' ? Number(lastEventId) : 0;
    if (!Number.isFinite(resumeSeq)) resumeSeq = 0;

    const onAbort = () => { closed = true; };
    signal?.addEventListener?.('abort', onAbort, { once: true });

    const close = () => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener?.('abort', onAbort);
    };

    // Emit every NOT-yet-delivered frame (seq > resumeSeq) for the supplied history snapshot,
    // advancing resumeSeq so subsequent passes never re-emit. Skips frames with no new sequence.
    function emitNewFrames(events) {
      const frames = historyToFrames(events);
      for (const f of frames) {
        if (closed) return;
        if (f.seq <= resumeSeq) continue;
        resumeSeq = f.seq;
        onEvent?.({ type: f.kind, id: String(f.seq), ...f.payload });
      }
    }

    // Run the follow loop in the background; do NOT block subscribe() (the route already wrote the
    // SSE preamble). Errors are surfaced via onError so the route can emit an `error` frame.
    (async () => {
      try {
        let status = await describeStatus(executionId);
        // Terminal already → replay persisted history then stream-end and close.
        if (workflowHistoryProvider.isTerminal(status)) {
          const { events } = await workflowHistoryProvider.fetchHistory(executionId);
          emitNewFrames(events ?? []);
          if (!closed) onEvent?.({ type: 'stream-end', status });
          close();
          return;
        }
        // Live follow: poll the history, emitting only new frames, until terminal or capped.
        for (let pass = 0; pass < maxLivePolls && !closed; pass += 1) {
          const { events } = await workflowHistoryProvider.fetchHistory(executionId);
          emitNewFrames(events ?? []);
          status = await describeStatus(executionId);
          if (workflowHistoryProvider.isTerminal(status)) {
            // Final fetch to capture the closing events, then stream-end.
            const final = await workflowHistoryProvider.fetchHistory(executionId);
            emitNewFrames(final.events ?? []);
            if (!closed) onEvent?.({ type: 'stream-end', status });
            close();
            return;
          }
          if (closed) return;
          await delay(pollIntervalMs, signal);
        }
      } catch (err) {
        // A 403 thrown synchronously is handled before this loop; here we surface poll/transport
        // failures as a stream error (fail-closed: never leak partial foreign history).
        onError?.(err);
        close();
      }
    })().catch((err) => logger?.error?.('[flow-monitoring] follow loop failed:', err?.message ?? err));

    return { close };
  }

  return { subscribe, close: async () => {} };
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export { isTerminalStatus, TERMINAL_STATUS_KEYS };
