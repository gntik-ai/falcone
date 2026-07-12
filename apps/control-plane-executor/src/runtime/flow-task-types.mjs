// Temporal-free task-type descriptor catalog (change: add-console-flow-designer).
//
// Why this lives in the control-plane and NOT in the workflow-worker activity modules:
// the worker's per-activity `*InputSchema` exports are co-located with the activity code,
// which transitively imports `@temporalio/activity` (via ./limits.mjs and ./errors.mjs).
// The control-plane process must stay Temporal-free, so it cannot import those modules.
// It already imports the Temporal-free canonical name list (catalog-names.mjs ::
// TASK_TYPE_NAMES) to feed FLW-E006; this module pairs each canonical name with the
// presentation metadata the console flow designer's palette + property panels need:
//   { id, label, category, inputSchema }
//
// The `inputSchema` objects mirror the worker's `*InputSchema` exports verbatim (the
// shared DSL/activity contract). A drift between the two is a load-time error: the
// descriptor `id`s MUST exactly equal TASK_TYPE_NAMES (verified by buildTaskTypeCatalog).
//
// `x-falcone-expression: true` marks string fields the designer renders as CEL/expression
// inputs (design.md D5). Expression syntax is validated by FLW-E005 (the shared validator).

import { TASK_TYPE_NAMES } from '../../../../apps/workflow-worker/src/activities/catalog-names.mjs';

// One descriptor per first-party task type. Keep `id` aligned with TASK_TYPE_NAMES.
const DESCRIPTORS = [
  {
    id: 'db.query',
    label: 'Database Query',
    category: 'data',
    inputSchema: {
      $id: 'flows/activity/db.query/input',
      type: 'object',
      required: ['engine', 'operation'],
      properties: {
        engine: { type: 'string', enum: ['postgres', 'mongo'] },
        operation: { type: 'string' },
        databaseName: { type: 'string' },
        schemaName: { type: 'string' },
        tableName: { type: 'string' },
        collectionName: { type: 'string' },
        documentId: { type: 'string' },
        rowId: { type: 'string' },
        filter: { type: 'object' },
        values: { type: 'object' },
        payload: { type: 'object' },
      },
      additionalProperties: true,
    },
  },
  {
    id: 'storage.put',
    label: 'Storage Put',
    category: 'storage',
    inputSchema: {
      $id: 'flows/activity/storage.put/input',
      type: 'object',
      required: ['bucketId', 'objectKey', 'body'],
      properties: {
        bucketId: { type: 'string' },
        objectKey: { type: 'string', 'x-falcone-expression': true },
        body: { type: 'string', description: 'base64-encoded object bytes', 'x-falcone-expression': true },
        contentType: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'storage.get',
    label: 'Storage Get',
    category: 'storage',
    inputSchema: {
      $id: 'flows/activity/storage.get/input',
      type: 'object',
      required: ['bucketId', 'objectKey'],
      properties: {
        bucketId: { type: 'string' },
        objectKey: { type: 'string', 'x-falcone-expression': true },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'functions.invoke',
    label: 'Invoke Function',
    category: 'compute',
    inputSchema: {
      $id: 'flows/activity/functions.invoke/input',
      type: 'object',
      required: ['actionId'],
      properties: {
        actionId: { type: 'string' },
        params: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'events.publish',
    label: 'Publish Event',
    category: 'messaging',
    inputSchema: {
      $id: 'flows/activity/events.publish/input',
      type: 'object',
      required: ['topic', 'messages'],
      properties: {
        topic: { type: 'string' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: {} },
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'http.request',
    label: 'HTTP Request',
    category: 'integration',
    inputSchema: {
      $id: 'flows/activity/http.request/input',
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri', 'x-falcone-expression': true },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
        headers: { type: 'object' },
        body: { type: 'string', 'x-falcone-expression': true },
        timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 },
        maxResponseBytes: { type: 'integer', minimum: 1, maximum: 10485760 },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'email.send',
    label: 'Send Email',
    category: 'messaging',
    inputSchema: {
      $id: 'flows/activity/email.send/input',
      type: 'object',
      required: ['to', 'subject'],
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string', 'x-falcone-expression': true },
        body: { type: 'string', 'x-falcone-expression': true },
        from: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'llm.complete',
    label: 'LLM Complete',
    category: 'ai',
    inputSchema: {
      $id: 'flows/activity/llm.complete/input',
      type: 'object',
      required: ['model'],
      properties: {
        model: { type: 'string' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: { role: { type: 'string' }, content: { type: 'string', 'x-falcone-expression': true } },
          },
        },
        prompt: { type: 'string', 'x-falcone-expression': true },
        system: { type: 'string', 'x-falcone-expression': true },
        maxTokens: { type: 'integer', minimum: 1 },
        temperature: { type: 'number', minimum: 0, maximum: 2 },
      },
      additionalProperties: false,
    },
  },
];

/**
 * Build the task-type descriptor catalog. Fails closed (throws) when the descriptor id set
 * drifts from the canonical Temporal-free name list — the same contract the worker's
 * catalog.mjs self-checks against registry names. This guarantees the palette can never
 * surface a task type the validator's FLW-E006 catalog would reject (or omit one it accepts).
 *
 * @returns {Array<{ id: string, label: string, category: string, inputSchema: object }>}
 */
export function buildTaskTypeCatalog() {
  const descriptorIds = new Set(DESCRIPTORS.map((d) => d.id));
  const canonical = new Set(TASK_TYPE_NAMES);
  for (const name of canonical) {
    if (!descriptorIds.has(name)) {
      throw new Error(`flow-task-types: canonical task type "${name}" has no descriptor`);
    }
  }
  for (const id of descriptorIds) {
    if (!canonical.has(id)) {
      throw new Error(`flow-task-types: descriptor "${id}" is not a canonical task type`);
    }
  }
  // Return defensive copies so callers cannot mutate the module-level descriptors.
  return DESCRIPTORS.map((d) => ({ ...d, inputSchema: JSON.parse(JSON.stringify(d.inputSchema)) }));
}

export { DESCRIPTORS as TASK_TYPE_DESCRIPTORS };
