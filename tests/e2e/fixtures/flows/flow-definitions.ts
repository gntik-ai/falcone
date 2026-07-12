/**
 * Flow DSL fixtures for the E2E flows suite (GitHub issue #367 / epic #355).
 *
 * These are Playwright-importable TypeScript constants that mirror the JSON fixtures
 * in packages/internal-contracts/src/fixtures/flows/ without importing Node.js fs.
 *
 * All taskType values MUST be from the first-party catalog:
 *   db.query, storage.put, storage.get, functions.invoke,
 *   events.publish, http.request, email.send
 * (source: apps/workflow-worker/src/activities/catalog-names.mjs)
 */

export interface FlowNode {
  id: string
  type: string
  taskType?: string
  next?: string
  approvers?: string[]
  timeout?: string
  arms?: Array<{ condition?: string; next: string }>
  branches?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: Record<string, unknown>
  retryPolicy?: { maxAttempts?: number; initialInterval?: string; nonRetryableErrors?: string[] }
  flowId?: string
  flowVersion?: string
}

export interface FlowDefinition {
  apiVersion: string
  name: string
  description?: string
  triggers?: Array<{
    kind: 'webhook' | 'cron' | 'platform-event' | 'manual'
    triggerId?: string
    schedule?: string
    eventType?: string
  }>
  nodes: FlowNode[]
}

/**
 * Minimal 3-step linear flow (no branches, no triggers).
 * Used for: design&publish (scenario 1), manual-run&observe (scenario 2).
 *
 * Steps call httpbin.org which is publicly reachable from the cluster.
 * All three nodes use http.request so they will complete successfully.
 */
export const MINIMAL_3_NODE: FlowDefinition = {
  apiVersion: 'v1.0',
  name: 'e2e-minimal-three-step',
  description: 'Three sequential http.request nodes used by the E2E design & run scenarios.',
  nodes: [
    {
      id: 'step-1',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
      next: 'step-2',
    },
    {
      id: 'step-2',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
      next: 'step-3',
    },
    {
      id: 'step-3',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
    },
  ],
}

/**
 * Flow with a webhook trigger bound to a known triggerId.
 * Used for: webhook trigger scenario (scenario 3).
 */
export const WEBHOOK_TRIGGERED: FlowDefinition = {
  apiVersion: 'v1.0',
  name: 'e2e-webhook-triggered',
  description: 'Single-task flow started by a signed webhook delivery.',
  triggers: [
    { kind: 'webhook', triggerId: 'e2e-webhook-01' },
  ],
  nodes: [
    {
      id: 'handle',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
    },
  ],
}

/**
 * Flow with a cron trigger that fires every minute.
 * Used for: cron trigger scenario (scenario 3).
 */
export const CRON_TRIGGERED: FlowDefinition = {
  apiVersion: 'v1.0',
  name: 'e2e-cron-triggered',
  description: 'Flow that fires every minute via a Temporal Schedule.',
  triggers: [
    { kind: 'cron', schedule: '* * * * *' },
  ],
  nodes: [
    {
      id: 'tick',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
    },
  ],
}

/**
 * Flow with a platform-event trigger bound to a Kafka event type.
 * Used for: platform-event trigger scenario (scenario 3).
 */
export const EVENT_TRIGGERED: FlowDefinition = {
  apiVersion: 'v1.0',
  name: 'e2e-event-triggered',
  description: 'Flow started by a platform event on document.created.',
  triggers: [
    { kind: 'platform-event', eventType: 'document.created' },
  ],
  nodes: [
    {
      id: 'process',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
    },
  ],
}

/**
 * Flow whose first node always fails because db.query is used without the postgres
 * executor wired into the worker (the workflow-worker does not inject activityDeps in
 * the E2E environment, so db.query throws CAPABILITY_UNAVAILABLE — non-retryable).
 * Used for: failure & retry scenario (scenario 4).
 *
 * retryPolicy.maxAttempts=1 ensures the failure is immediate (no retry delay).
 */
export const FAILING_FLOW: FlowDefinition = {
  apiVersion: 'v1.0',
  name: 'e2e-failing-flow',
  description: 'A flow whose first task always fails (db.query without executor deps), for testing the failure & retry scenario.',
  nodes: [
    {
      id: 'will-fail',
      type: 'task',
      taskType: 'db.query',
      input: {
        params: { engine: 'postgres', operation: 'read', tableName: 'nonexistent_e2e_table' },
        tenant: { tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      },
      retryPolicy: { maxAttempts: 1 },
    },
  ],
}

/**
 * Human approval flow: task → approval node → task.
 * Used for: human approval scenario (scenario 5).
 */
export const HUMAN_APPROVAL: FlowDefinition = {
  apiVersion: 'v1.0',
  name: 'e2e-human-approval',
  description: 'A flow that pauses at an approval node before continuing.',
  nodes: [
    {
      id: 'prepare',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
      next: 'review',
    },
    {
      id: 'review',
      type: 'approval',
      approvers: ['role:workspace_admin'],
      timeout: 'PT10M',
      next: 'publish',
    },
    {
      id: 'publish',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/post', method: 'POST' },
    },
  ],
}

/**
 * Long-running flow using db.query so each activity call takes time to fail
 * (CAPABILITY_UNAVAILABLE is thrown synchronously but Temporal still schedules it).
 * The actual "long running" part is that we start two activities sequentially so
 * there is enough scheduling gap to kill the worker mid-run.
 *
 * NOTE: The worker-kill scenario verifies Temporal's exactly-once guarantee: after
 * the worker pod is deleted and rescheduled, the workflow resumes from the checkpoint
 * and does NOT re-execute completed nodes.
 *
 * Since db.query fails without executor deps, we use http.request for a flow that
 * actually runs. We call a slow endpoint: httpbin.org /delay/10 sleeps 10s which
 * gives the test enough window to kill the worker pod.
 */
export const LONG_RUNNING: FlowDefinition = {
  apiVersion: 'v1.0',
  name: 'e2e-long-running',
  description: 'A flow with a slow first task (10s HTTP delay), used for the worker-kill resilience scenario.',
  nodes: [
    {
      id: 'slow-step',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/delay/10', method: 'GET', timeoutMs: 25000 },
      next: 'final-step',
    },
    {
      id: 'final-step',
      type: 'task',
      taskType: 'http.request',
      input: { url: 'https://httpbin.org/get', method: 'GET' },
    },
  ],
}
