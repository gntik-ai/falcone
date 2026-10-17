import { Context } from '@temporalio/activity';
import { setTimeout as delay } from 'node:timers/promises';
import { hashExecutionTokenRef, matchesCredentialAttempt, originalCredentialRun } from '../../../../packages/internal-contracts/src/flow-execution-credentials.mjs';
import { toNonRetryable, toRetryable } from './errors.mjs';

const invalid = () => toNonRetryable('EXECUTION_TOKEN_INVALID', 'execution credential does not belong to this run');
async function storeCall(fn) {
  try { return await fn(); } catch { throw toRetryable('EXECUTION_TOKEN_STORE_UNAVAILABLE', 'execution credential store unavailable'); }
}
async function serverCall(fn) {
  try { return await fn(); } catch { throw toRetryable('EXECUTION_TOKEN_ANCESTRY_UNAVAILABLE', 'execution ancestry unavailable'); }
}

/** Resolve only after server-recorded ancestry authorizes the root execution. */
export async function resolveExecutionTokenRef(tenant, { executionCredentials: store, describeWorkflow, listWorkflowExecutions, sleep = delay } = {}) {
  const ref = tenant.executionTokenRef;
  if (typeof ref !== 'string' || !/^fxr_[A-Za-z0-9_-]{43}$/.test(ref)) throw invalid();
  const row = await storeCall(() => store.get(hashExecutionTokenRef(ref)));
  if (!row) throw invalid();
  if (row.tenant_id !== tenant.tenantId || row.workspace_id !== tenant.workspaceId) {
    throw toNonRetryable('EXECUTION_TOKEN_TENANT_MISMATCH', 'execution credential tenant/workspace mismatch');
  }
  if (Date.now() >= +new Date(row.expires_at)) throw toNonRetryable('EXECUTION_TOKEN_EXPIRED', 'execution credential expired');
  let root = Context.current().info.workflowExecution;
  let description;
  const seen = new Set();
  for (let hops = 0; ; hops++) {
    if (!root?.workflowId || !root.runId || hops > 8 || seen.has(`${root.workflowId}\n${root.runId}`)) throw invalid();
    seen.add(`${root.workflowId}\n${root.runId}`);
    description = await serverCall(() => describeWorkflow(root.workflowId, root.runId));
    if (!description) throw toRetryable('EXECUTION_TOKEN_ANCESTRY_UNAVAILABLE', 'execution ancestry unavailable');
    if (!description.parentExecution) break;
    root = description.parentExecution;
  }
  if (root.workflowId !== row.workflow_id) throw invalid();
  if (row.run_id !== null) {
    if (row.run_id !== root.runId) throw invalid();
    return row.token;
  }
  const unresolvedTooLong = () => Date.now() >= +new Date(row.created_at) + 300_000;
  if (unresolvedTooLong() || !matchesCredentialAttempt(row, description)) throw invalid();
  const executions = await serverCall(async () => {
    const result = [];
    for await (const execution of await listWorkflowExecutions(row.workflow_id)) result.push(execution);
    return result;
  });
  if (unresolvedTooLong()) throw invalid();
  if (executions.some((execution) => execution.workflowId === row.workflow_id &&
    matchesCredentialAttempt(row, execution) && +new Date(execution.startTime) < +new Date(description.startTime))) throw invalid();
  if (originalCredentialRun(row, executions) === root.runId) {
    const claimed = await storeCall(() => store.claim(row.ref_hash, root.runId));
    if (claimed?.run_id !== root.runId) throw invalid();
    return claimed.token;
  }
  for (const ms of [1_000, 2_000, 4_000]) {
    await sleep(ms);
    const current = await storeCall(() => store.get(row.ref_hash));
    if (!current) throw invalid();
    if (current.run_id !== null) {
      if (current.run_id !== root.runId) throw invalid();
      return current.token;
    }
    if (unresolvedTooLong()) throw invalid();
  }
  throw toRetryable('EXECUTION_TOKEN_BINDING_PENDING', 'execution credential binding pending');
}
