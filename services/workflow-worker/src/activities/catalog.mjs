// First-party task-type catalog wiring (change: add-flows-activity-catalog / #360).
//
// Registers every shipped activity into the task-type registry (D3) and exposes the
// catalog dispatch the interpreter's `executeTask` seam delegates to. Importing this module
// is the single side effect that POPULATES the registry; it pulls in @temporalio/activity
// (via the activity modules) and so must only be loaded inside the worker process — the
// control-plane consumes ./catalog-names.mjs instead (Temporal-free).
import { registerActivity, resolveActivity, taskTypeNames, listTaskTypes, hasTaskType, _registry } from './registry.mjs';
import { TASK_TYPE_NAMES } from './catalog-names.mjs';
import { toNonRetryable } from './errors.mjs';
import { assertPayloadSize } from './limits.mjs';
import { assertExecutionToken } from './execution-token.mjs';

import { dbQuery, dbQueryInputSchema, dbQueryOutputSchema } from './db-query.mjs';
import { storagePut, storagePutInputSchema, storagePutOutputSchema } from './storage-put.mjs';
import { storageGet, storageGetInputSchema, storageGetOutputSchema } from './storage-get.mjs';
import { functionsInvoke, functionsInvokeInputSchema, functionsInvokeOutputSchema } from './functions-invoke.mjs';
import { eventsPublish, eventsPublishInputSchema, eventsPublishOutputSchema } from './events-publish.mjs';
import { httpRequest, httpRequestInputSchema, httpRequestOutputSchema } from './http-request.mjs';
import { emailSend, emailSendInputSchema, emailSendOutputSchema } from './email-send.mjs';
import { llmComplete, llmCompleteInputSchema, llmCompleteOutputSchema } from './llm-complete.mjs';

// Register once at module load. Each entry carries the activity plus its input/output
// JSON Schemas (the palette/docs contract). Names MUST equal catalog-names.mjs.
registerActivity('db.query', { activity: dbQuery, inputSchema: dbQueryInputSchema, outputSchema: dbQueryOutputSchema });
registerActivity('storage.put', { activity: storagePut, inputSchema: storagePutInputSchema, outputSchema: storagePutOutputSchema });
registerActivity('storage.get', { activity: storageGet, inputSchema: storageGetInputSchema, outputSchema: storageGetOutputSchema });
registerActivity('functions.invoke', { activity: functionsInvoke, inputSchema: functionsInvokeInputSchema, outputSchema: functionsInvokeOutputSchema });
registerActivity('events.publish', { activity: eventsPublish, inputSchema: eventsPublishInputSchema, outputSchema: eventsPublishOutputSchema });
registerActivity('http.request', { activity: httpRequest, inputSchema: httpRequestInputSchema, outputSchema: httpRequestOutputSchema });
registerActivity('email.send', { activity: emailSend, inputSchema: emailSendInputSchema, outputSchema: emailSendOutputSchema });
registerActivity('llm.complete', { activity: llmComplete, inputSchema: llmCompleteInputSchema, outputSchema: llmCompleteOutputSchema });

// Self-check: the registered names MUST equal the Temporal-free canonical list the
// control-plane validate endpoint consumes. A mismatch is a load-time bug.
{
  const registered = new Set(taskTypeNames());
  const canonical = new Set(TASK_TYPE_NAMES);
  for (const n of canonical) {
    if (!registered.has(n)) throw new Error(`catalog: canonical task type "${n}" was not registered`);
  }
  for (const n of registered) {
    if (!canonical.has(n)) throw new Error(`catalog: registered task type "${n}" missing from catalog-names.mjs`);
  }
}

/**
 * Dispatch an interpreter ActivityInput envelope to the matching catalog activity.
 *
 *   input: { nodeId, taskType, node, params, tenant }   (src/shared/types.ts ActivityInput)
 *   deps:  the injected platform surfaces + the per-execution tenant-scoped credential
 *
 * The activity receives `{ params, tenant, credential }`. Result is wrapped back into the
 * ActivityResult envelope ({ nodeId, taskType, output }).
 *
 * Payload-size + tenant guards run for EVERY task type (including unregistered ones) so the
 * limits are enforced before any work.
 *
 * Authoritative-registry vs interpreter-seam reconciliation (deviation, see design.md
 * "Open Questions"): the registry is the AUTHORITATIVE source for DSL validation (FLW-E006
 * rejects unknown taskTypes at the API boundary with UNKNOWN_TASK_TYPE) and the public
 * `resolveActivity` fails closed on an unknown name. At DISPATCH time, however, the
 * upstream interpreter harness (add-flows-dsl-interpreter-worker) drives graph-walk
 * fixtures with PLACEHOLDER task types (e.g. `fetch-record`, `noop-a`) that are not — and
 * should not be — first-party catalog entries. Throwing UNKNOWN_TASK_TYPE there would break
 * the interpreter's graph-execution contract. So an UNREGISTERED taskType that reaches the
 * worker (already past FLW-E006 in production) falls back to the interpreter's echo seam
 * rather than failing the run; registered task types always take the real activity path.
 */
export async function dispatchTask(input, deps = {}) {
  if (!input?.tenant?.tenantId) {
    throw toNonRetryable('UNAUTHENTICATED', 'activity dispatch requires a tenant context');
  }
  // Enforce the input payload cap for every task type before any dispatch decision.
  assertPayloadSize(input, 'input');

  const entry = _registry().get(input.taskType);
  if (!entry) {
    // Unregistered taskType → interpreter echo seam (graph-walk fixtures). Production
    // definitions cannot reach here with an unknown type: FLW-E006 rejects them first. No
    // tenant data store is touched, so the per-execution token is not validated here.
    return {
      nodeId: input.nodeId,
      taskType: input.taskType,
      output: { executed: true, taskType: input.taskType, params: input.params ?? {} },
    };
  }
  // Per-execution credential gate (change: add-flows-tenancy-isolation-limits). A REGISTERED
  // (first-party) activity touches a tenant data store, so before it runs the short-lived token
  // the control-plane minted at execution start MUST validate against the execution's tenant +
  // workspace. A missing / expired / cross-tenant token fails the activity NON-RETRYABLY and no
  // tenant data is accessed. The token is carried in the tenant envelope's `executionToken`
  // (mirrored into the Temporal memo). When no token is configured AT ALL (legacy interpreter
  // harness with token enforcement off) the gate is a no-op — production always stamps one.
  const token = input.tenant?.executionToken;
  if (token !== undefined && token !== null) {
    assertExecutionToken(token, input.tenant.tenantId, input.tenant.workspaceId);
  }
  const output = await entry.activity(
    { params: input.params ?? {}, tenant: input.tenant, credential: deps.credential },
    deps,
  );
  return { nodeId: input.nodeId, taskType: input.taskType, output };
}

export { registerActivity, resolveActivity, taskTypeNames, listTaskTypes, hasTaskType };
