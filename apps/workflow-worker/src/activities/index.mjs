// Public ESM entry point for the first-party activity catalog (change:
// add-flows-activity-catalog / #360).
//
// CONSUMERS (the cross-change contract):
//   - #358 DSL validation: import { taskTypeNames } and pass it as the validator's
//     `taskTypeCatalog` so FLW-E006 rejects unknown task types. For a Temporal-FREE
//     import (control-plane process) use ./catalog-names.mjs (TASK_TYPE_NAMES) instead —
//     importing THIS module loads the activity bindings (and @temporalio/activity).
//   - #363 console palette: import { listTaskTypes } for the name + input/output schemas.
//   - the Temporal interpreter worker: import { dispatchTask } / { resolveActivity }.
//
// REGISTRY ENTRY SHAPE (stable): { activity, inputSchema, outputSchema }. See registry.mjs.
import './catalog.mjs'; // side effect: populate the registry

export {
  dispatchTask,
  registerActivity,
  resolveActivity,
  taskTypeNames,
  listTaskTypes,
  hasTaskType,
} from './catalog.mjs';

export { TASK_TYPE_NAMES } from './catalog-names.mjs';

// Per-activity exports (unit tests + advanced consumers).
export { dbQuery, dbQueryInputSchema, dbQueryOutputSchema } from './db-query.mjs';
export { storagePut, storagePutInputSchema, storagePutOutputSchema } from './storage-put.mjs';
export { storageGet, storageGetInputSchema, storageGetOutputSchema } from './storage-get.mjs';
export { functionsInvoke, functionsInvokeInputSchema, functionsInvokeOutputSchema } from './functions-invoke.mjs';
export { eventsPublish, eventsPublishInputSchema, eventsPublishOutputSchema } from './events-publish.mjs';
export { httpRequest, httpRequestInputSchema, httpRequestOutputSchema } from './http-request.mjs';
export { emailSend, emailSendInputSchema, emailSendOutputSchema } from './email-send.mjs';
export { llmComplete, llmCompleteInputSchema, llmCompleteOutputSchema } from './llm-complete.mjs';

export { resolveActivityWorkspaceId } from './workspace-binding.mjs';
export { assertPayloadSize, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, serializedByteLength } from './limits.mjs';
export { toNonRetryable, toRetryable, classifyExecutorError, isTransientNetworkError } from './errors.mjs';
export { resolveSsrfSafe } from './ssrf.mjs';
export {
  assertExecutionToken,
  EXECUTION_TOKEN_EXPIRED,
  EXECUTION_TOKEN_TENANT_MISMATCH,
  EXECUTION_TOKEN_INVALID,
} from './execution-token.mjs';
