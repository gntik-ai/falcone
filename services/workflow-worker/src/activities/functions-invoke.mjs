// functions.invoke activity (change: add-flows-activity-catalog / #360).
//
// Invokes a named tenant function via the functions executor (operation `invoke`), which
// backs `invokeFunctionAction` (POST /v1/functions/actions/{resourceId}/invocations). The
// activity carries the workspace-scoped credential; the executor scopes the function lookup
// to the credential's workspace, so cross-workspace invocation is impossible.
//
// The functions executor returns a structured result instead of throwing for execution
// outcomes:
//   - unknown function  → throws clientError 404 FUNCTION_NOT_FOUND   → non-retryable
//   - timeout           → returns { status: 'timeout' }               → retryable FUNCTION_TIMEOUT
//   - runtime error     → returns { status: 'error' }                 → non-retryable FUNCTION_ERROR
//   - success           → returns { status: 'success', result }       → success envelope
import { assertPayloadSize, MAX_OUTPUT_BYTES } from './limits.mjs';
import { toNonRetryable, toRetryable, classifyExecutorError } from './errors.mjs';

const FN_CODE_OVERRIDES = {
  FUNCTION_NOT_FOUND: 'FUNCTION_NOT_FOUND',
};

/**
 * @param {{ params: object, tenant: object, credential?: object }} input
 *   params: { actionId | name, params? | payload? }
 * @param {{ executeFunctions?: Function }} deps
 */
export async function functionsInvoke(input, deps = {}) {
  assertPayloadSize(input, 'input');

  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  const credential = input.credential ?? {};
  if (!tenant.tenantId) throw toNonRetryable('UNAUTHENTICATED', 'functions.invoke requires a tenant context');
  const workspaceId = params.workspaceId ?? tenant.workspaceId;
  if (!workspaceId) throw toNonRetryable('UNAUTHENTICATED', 'functions.invoke requires a workspaceId');

  const name = params.actionId ?? params.name;
  if (!name) throw toNonRetryable('VALIDATION_ERROR', 'functions.invoke requires actionId');

  if (typeof deps.executeFunctions !== 'function') {
    throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'functions executor not wired into functions.invoke activity');
  }

  const identity = {
    tenantId: tenant.tenantId,
    workspaceId,
    roleName: credential.roleName ?? credential.dbRole ?? 'falcone_service',
    actorId: credential.actorId,
  };

  let result;
  try {
    result = await deps.executeFunctions({
      operation: 'invoke',
      workspaceId,
      name,
      payload: params.params ?? params.payload ?? {},
      identity,
    });
  } catch (err) {
    if (err?.name === 'ApplicationFailure') throw err;
    throw classifyExecutorError(err, FN_CODE_OVERRIDES);
  }

  if (result?.status === 'timeout') {
    throw toRetryable('FUNCTION_TIMEOUT', 'functions.invoke exceeded its execution time limit');
  }
  if (result?.status === 'error') {
    throw toNonRetryable('FUNCTION_ERROR', result.error ?? 'functions.invoke failed');
  }

  const output = {
    status: 'success',
    activationId: result?.activationId ?? null,
    result: result?.result ?? null,
  };
  assertPayloadSize(output, 'output', MAX_OUTPUT_BYTES);
  return output;
}

export const functionsInvokeInputSchema = Object.freeze({
  $id: 'flows/activity/functions.invoke/input',
  type: 'object',
  required: ['actionId'],
  properties: {
    actionId: { type: 'string' },
    params: { type: 'object' },
  },
  additionalProperties: false,
});

export const functionsInvokeOutputSchema = Object.freeze({
  $id: 'flows/activity/functions.invoke/output',
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', const: 'success' },
    activationId: { type: ['string', 'null'] },
    result: {},
  },
  additionalProperties: false,
});
