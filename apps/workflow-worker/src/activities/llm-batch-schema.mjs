// Temporal-free schemas shared by the Flow descriptor and worker activity.
export const llmBatchInputSchema = Object.freeze({
  $id: 'flows/activity/llm.batch/input',
  type: 'object', required: ['model', 'items'],
  properties: {
    model: { type: 'string' },
    connectionId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$' },
    items: { type: 'array', minItems: 1, maxItems: 1000, items: {
      type: 'object', required: ['customId'], additionalProperties: false,
      properties: {
        customId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
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
        promptCache: { type: 'string', enum: ['system'] },
        responseFormat: {
          type: 'object', required: ['type', 'name', 'schema'],
          properties: { type: { const: 'json_schema' }, name: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }, schema: { type: 'object' } },
          additionalProperties: false,
        },
      },
    } },
    pollSeconds: { type: 'integer', minimum: 30, maximum: 600, default: 60 },
    maxWaitSeconds: { type: 'integer', minimum: 60, maximum: 82800, default: 82800 },
  },
  additionalProperties: false,
});

export const llmBatchOutputSchema = Object.freeze({
  $id: 'flows/activity/llm.batch/output', type: 'object', additionalProperties: false,
  required: ['status', 'batchId', 'batchStatus', 'counts', 'items', 'itemsOmitted'],
  properties: {
    status: { const: 'success' }, batchId: { type: 'string' },
    batchStatus: { enum: ['completed', 'cancelled', 'expired', 'incomplete'] },
    counts: { type: 'object', additionalProperties: false,
      required: ['succeeded', 'errored', 'canceled', 'expired', 'missing'],
      properties: Object.fromEntries(['succeeded', 'errored', 'canceled', 'expired', 'missing'].map(k => [k, { type: 'integer', minimum: 0 }])),
    },
    itemsOmitted: { type: 'boolean' },
    items: { type: 'array', maxItems: 1000, items: {
      type: 'object', additionalProperties: false,
      required: ['customId', 'status', 'content', 'finishReason', 'errorCode', 'usage'],
      properties: {
        customId: { type: 'string' }, status: { enum: ['succeeded', 'errored', 'canceled', 'expired', 'missing'] },
        content: { type: ['string', 'null'] }, finishReason: { type: ['string', 'null'] }, errorCode: { type: ['string', 'null'] },
        usage: { type: 'object', additionalProperties: false,
          required: ['promptTokens', 'completionTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'],
          properties: Object.fromEntries(['promptTokens', 'completionTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(k => [k, { type: ['integer', 'null'] }])),
        },
      },
    } },
  },
});
