// llm.complete activity (change: add-llm-agent-flow-task / #640).
//
// Runs a BYOK LLM chat completion via the injected LLM executor (`deps.executeLlmComplete`), which
// resolves the per-workspace provider config + key from the secret store, ENFORCES the model
// allow-list, calls the configured provider, and METERS token usage per tenant/workspace. The
// activity carries the workspace-scoped execution context so the completion + metering are
// tenant-isolated. Mirrors functions-invoke.mjs: a thin activity over an injected executor.
//
// Workspace binding (security, #663): the workspace is the execution-token-bound
// `tenant.workspaceId` (validated by catalog.mjs::dispatchTask). A `workspaceId` smuggled in via
// the task `input` may NOT override it — a value differing from the token workspace fails closed
// (non-retryable FORBIDDEN) so a flow author cannot redirect the BYOK provider/key/metering to a
// sibling workspace (cross-workspace resource theft). See workspace-binding.mjs.
//
// Error mapping (via classifyExecutorError): a disallowed model surfaces from the executor as a
// 422 `MODEL_NOT_ALLOWED` → non-retryable; a missing provider (422 `LLM_PROVIDER_MISSING`) and an
// unresolved secret (500 `LLM_PROVIDER_SECRET_UNRESOLVED`) are likewise non-retryable; transient
// provider 5xx/429 are retryable.
import { assertPayloadSize, MAX_OUTPUT_BYTES } from './limits.mjs';
import { toNonRetryable, classifyExecutorError } from './errors.mjs';
import { resolveActivityWorkspaceId } from './workspace-binding.mjs';

/**
 * @param {{ params: object, tenant: object, credential?: object }} input
 *   params: { model, messages?, prompt?, system?, maxTokens?, temperature? }
 * @param {{ executeLlmComplete?: Function }} deps
 */
export async function llmComplete(input, deps = {}) {
  assertPayloadSize(input, 'input');

  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  if (!tenant.tenantId) throw toNonRetryable('UNAUTHENTICATED', 'llm.complete requires a tenant context');
  const workspaceId = resolveActivityWorkspaceId(params, tenant);
  if (!workspaceId) throw toNonRetryable('UNAUTHENTICATED', 'llm.complete requires a workspaceId');
  if (!params.model) throw toNonRetryable('VALIDATION_ERROR', 'llm.complete requires a model');

  if (typeof deps.executeLlmComplete !== 'function') {
    throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'LLM executor not wired into llm.complete activity');
  }

  let result;
  try {
    result = await deps.executeLlmComplete({
      workspaceId,
      tenantId: tenant.tenantId,
      model: params.model,
      messages: params.messages,
      prompt: params.prompt,
      system: params.system,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
  } catch (err) {
    if (err?.name === 'ApplicationFailure') throw err;
    throw classifyExecutorError(err);
  }

  const output = {
    status: 'success',
    content: result?.content ?? '',
    usage: result?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: result?.model ?? params.model,
  };
  assertPayloadSize(output, 'output', MAX_OUTPUT_BYTES);
  return output;
}

export const llmCompleteInputSchema = Object.freeze({
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
});

export const llmCompleteOutputSchema = Object.freeze({
  $id: 'flows/activity/llm.complete/output',
  type: 'object',
  required: ['status', 'content'],
  properties: {
    status: { type: 'string', const: 'success' },
    content: { type: 'string' },
    usage: {
      type: 'object',
      properties: {
        promptTokens: { type: 'integer' },
        completionTokens: { type: 'integer' },
        totalTokens: { type: 'integer' },
      },
    },
    model: { type: 'string' },
  },
  additionalProperties: false,
});
