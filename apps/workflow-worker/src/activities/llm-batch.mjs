import { ApplicationFailure, Context } from '@temporalio/activity';
import { toNonRetryable, classifyExecutorError } from './errors.mjs';
import { assertPayloadSize, serializedByteLength, MAX_OUTPUT_BYTES } from './limits.mjs';
import { resolveActivityWorkspaceId } from './workspace-binding.mjs';
export { llmBatchInputSchema, llmBatchOutputSchema } from './llm-batch-schema.mjs';

export async function llmBatch(input, deps = {}) {
  assertPayloadSize(input, 'input');
  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  if (!tenant.tenantId) throw toNonRetryable('UNAUTHENTICATED', 'llm.batch requires a tenant context');
  const workspaceId = resolveActivityWorkspaceId(params, tenant);
  if (!workspaceId) throw toNonRetryable('UNAUTHENTICATED', 'llm.batch requires a workspaceId');
  if (input.batchPhase?.phase === 'start') {
    const now = Date.now();
    const maxWaitSeconds = params.maxWaitSeconds ?? 82800;
    const pollSeconds = params.pollSeconds ?? 60;
    if (!Number.isInteger(maxWaitSeconds) || maxWaitSeconds < 60 || maxWaitSeconds > 82800
      || !Number.isInteger(pollSeconds) || pollSeconds < 30 || pollSeconds > 600) {
      throw toNonRetryable('VALIDATION_ERROR', 'Invalid batch wait options');
    }
    const credentialExpiresAt = input.credentialExpiresAt;
    if (!Number.isFinite(credentialExpiresAt) || credentialExpiresAt - now <= 900000) {
      throw toNonRetryable('LLM_BATCH_RUN_TOO_LATE', 'Execution credential has insufficient lifetime for a batch');
    }
    return { credentialExpiresAt, deadline: Math.min(now + maxWaitSeconds * 1000, credentialExpiresAt - 900000) };
  }
  const executor = deps.executeLlmBatch;
  if (!executor) throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'LLM batch executor unavailable');
  const { workflowExecution, activityId } = Context.current().info;
  const identity = { tenantId: tenant.tenantId,
    principal: `flow-run:${workflowExecution.workflowId}:${workflowExecution.runId}`,
    idempotencyKey: activityId.split('#')[0] };
  try {
    const phase = input.batchPhase?.phase;
    if (phase === 'status' || phase === 'collect') {
      const batchId = input.batchPhase.batchId;
      if (!batchId) throw toNonRetryable('VALIDATION_ERROR', 'Batch phase requires batchId');
      const batch = await executor.get(workspaceId, batchId, { tenantId: tenant.tenantId });
      const counts = Object.fromEntries(['succeeded', 'errored', 'canceled', 'expired', 'missing']
        .map(k => [k, k === 'missing' ? batch.missingCount ?? 0 : batch.providerCounts?.[k] ?? 0]));
      if (phase === 'status') return { status: batch.status, counts };
      if (batch.status === 'failed') {
        throw ApplicationFailure.nonRetryable('LLM batch failed', 'LLM_BATCH_FAILED',
          { batchId, last_error_code: batch.lastErrorCode ?? null });
      }
      if (!['completed', 'cancelled', 'expired', 'incomplete'].includes(batch.status)) {
        throw toNonRetryable('LLM_BATCH_NOT_TERMINAL', 'Batch is not terminal');
      }
      const output = { status: 'success', batchId, batchStatus: batch.status, counts, items: [], itemsOmitted: false };
      let cursor;
      do {
        const page = await executor.listItems(workspaceId, batchId, { tenantId: tenant.tenantId, limit: 100, cursor });
        for (const item of page.items) {
          output.items.push({ customId: item.customId, status: item.status, content: item.content ?? null,
            finishReason: item.finishReason ?? null, errorCode: item.errorCode ?? null,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0,
              cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, ...item.usage } });
        }
        if (serializedByteLength(output) > MAX_OUTPUT_BYTES) return { ...output, items: [], itemsOmitted: true };
        cursor = page.nextCursor;
      } while (cursor && output.items.length < 1000);
      return output;
    }
    if (phase === 'cancel') {
      return input.batchPhase.batchId
        ? await executor.cancel(workspaceId, input.batchPhase.batchId, { tenantId: tenant.tenantId })
        : await executor.cancelByIdentity(workspaceId, identity);
    }
    if (phase === 'submit') {
      const result = await executor.submit(workspaceId,
        { model: params.model, ...(params.connectionId !== undefined ? { connectionId: params.connectionId } : {}), items: params.items }, identity);
      return { batchId: result.body.batchId };
    }
    throw toNonRetryable('VALIDATION_ERROR', 'Unknown batch phase');
  } catch (error) {
    if (error?.name === 'ApplicationFailure') throw error;
    throw classifyExecutorError(error);
  }
}
