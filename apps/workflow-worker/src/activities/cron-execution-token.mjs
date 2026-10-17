import { Context } from '@temporalio/activity';
import { toNonRetryable, toRetryable } from './errors.mjs';
import { newExecutionCredential } from '../../../../packages/internal-contracts/src/flow-execution-credentials.mjs';
import { mintExecutionToken, DEFAULT_MAX_RUN_DURATION_MS, EXECUTION_TOKEN_INVALID, EXECUTION_TOKEN_TENANT_MISMATCH } from './execution-token.mjs';

// Must match the executor's scheduleIdFor without importing control-plane code.
function scheduleIdFor(tenantId, workspaceId, flowId) {
  return `${tenantId}:${workspaceId}:${flowId}`;
}

/** Mint for THIS firing only. Ownership comes from Temporal, not activity arguments. */
export async function mintCronExecutionToken({ tenant }, { describeWorkflow } = {}) {
  if (!tenant?.tenantId || !tenant.workspaceId || !tenant.flowId || typeof describeWorkflow !== 'function') {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'cron execution context is incomplete');
  }
  const { workflowId, runId } = Context.current().info.workflowExecution;
  const description = await describeWorkflow(workflowId, runId);
  const scheduleIds = description?.searchAttributes?.TemporalScheduledById;
  if (!Array.isArray(scheduleIds) || scheduleIds.length !== 1 || typeof scheduleIds[0] !== 'string') {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution was not started by a schedule');
  }
  if (scheduleIds[0] !== scheduleIdFor(tenant.tenantId, tenant.workspaceId, tenant.flowId)) {
    throw toNonRetryable(EXECUTION_TOKEN_TENANT_MISMATCH, 'cron schedule does not own the tenant/workspace/flow');
  }
  const firedAt = description.startTime?.getTime?.();
  // Temporal's firing time is authoritative when the worker clock lags behind it.
  const now = Math.max(Date.now(), firedAt);
  if (!Number.isFinite(firedAt) || now >= firedAt + DEFAULT_MAX_RUN_DURATION_MS) {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'cron firing time is invalid or expired');
  }
  return mintExecutionToken(tenant.tenantId, tenant.workspaceId, firedAt + DEFAULT_MAX_RUN_DURATION_MS - now, { now });
}

/** Only the opaque reference is returned across the activity/history boundary. */
export async function mintCronExecutionTokenRef(input, deps = {}) {
  const token = await mintCronExecutionToken(input, deps);
  const { workflowId, runId } = Context.current().info.workflowExecution;
  const { ref, row } = newExecutionCredential({ ...input.tenant, workflowId, runId, token });
  try {
    await deps.executionCredentials.sweep();
    await deps.executionCredentials.insert(row);
  } catch {
    throw toRetryable('EXECUTION_TOKEN_STORE_UNAVAILABLE', 'execution credential store unavailable');
  }
  return ref;
}
