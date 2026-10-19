import { ApplicationFailure, Context } from '@temporalio/activity';
import { assertPayloadSize } from './limits.mjs';
import { largeTaskAuditRecord } from '../../../../apps/control-plane-executor/src/large-task-worker.mjs';
import { LARGE_TASK_WORKER_PROFILE_VERSION } from '../../../../packages/internal-contracts/src/large-task-worker-profile.mjs';

export async function largeTaskRun(input, deps = {}) {
  assertPayloadSize(input, 'input');
  const ctx = Context.current();
  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  let runtime;
  let spec;
  let retired = false;
  let checkpoint = { generation: 0, jobName: null, jobUid: null, observedPod: null };
  const heartbeat = details => {
    if (details) checkpoint = { ...checkpoint, ...details };
    ctx.heartbeat(checkpoint);
  };
  try {
    if (!tenant.tenantId || !tenant.workspaceId) throw ApplicationFailure.nonRetryable('Tenant and workspace required', 'UNAUTHENTICATED');
    if (typeof deps.createLargeTaskRuntime !== 'function') throw ApplicationFailure.nonRetryable('LARGE_TASK_RUNTIME_UNAVAILABLE', 'LARGE_TASK_RUNTIME_UNAVAILABLE');
    runtime = deps.createLargeTaskRuntime({ config: deps.largeTaskConfig, request: deps.largeTaskRequest, heartbeat, signal: ctx.cancellationSignal });
    const config = runtime.config;
    if (typeof params.profile !== 'string' || !Object.hasOwn(config.profiles, params.profile)) {
      throw ApplicationFailure.nonRetryable('LARGE_TASK_PROFILE_UNKNOWN', 'LARGE_TASK_PROFILE_UNKNOWN');
    }
    const profile = config.profiles[params.profile];
    const info = ctx.info;
    if (!Number.isFinite(info.heartbeatTimeoutMs) || info.heartbeatTimeoutMs < 30000 || info.heartbeatTimeoutMs > 120000
        || !Number.isFinite(info.startToCloseTimeoutMs) || info.startToCloseTimeoutMs < (profile.maxDurationSeconds + 600) * 1000
        || !Number.isFinite(info.scheduleToCloseTimeoutMs) || info.scheduleToCloseTimeoutMs <= 0
        || info.scheduleToCloseTimeoutMs > (config.claimRetentionSeconds - 86400) * 1000) {
      throw ApplicationFailure.nonRetryable('LARGE_TASK_TIMEOUTS_INVALID', 'LARGE_TASK_TIMEOUTS_INVALID');
    }
    spec = { workflowId: info.workflowExecution?.workflowId, runId: info.workflowExecution?.runId,
      activityId: info.activityId, scheduledTimestampMs: info.scheduledTimestampMs,
      tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, profile: params.profile, parameters: params.parameters };
    await runtime.sweep();
    heartbeat(await runtime.ensure(spec));
    for (;;) {
      const state = await runtime.status(spec);
      heartbeat(state);
      if (['PENDING', 'RUNNING'].includes(state.code)) {
        await ctx.sleep(5000);
        heartbeat();
        continue;
      }
      if (state.code === 'LARGE_TASK_SUCCEEDED') {
        const result = await runtime.collect(spec);
        ctx.cancellationSignal.throwIfAborted();
        assertPayloadSize(result, 'output');
        return result;
      }
      if (['LARGE_TASK_NODE_PRESSURE', 'LARGE_TASK_CAPACITY', 'LARGE_TASK_LOST'].includes(state.code)) {
        await runtime.retire(spec, state.code);
        retired = true;
      }
      throw Object.assign(new Error(state.code), { code: state.code,
        retryable: ['LARGE_TASK_NODE_PRESSURE', 'LARGE_TASK_CAPACITY', 'LARGE_TASK_LOST'].includes(state.code) });
    }
  } catch (error) {
    if (error?.code === 'LARGE_TASK_CAPACITY' && runtime && spec && !retired && !ctx.cancellationSignal.aborted) {
      try { await runtime.retire(spec, error.code); } catch (retirementError) { error = retirementError; }
    }
    if (ctx.cancellationSignal.aborted) {
      const cancellation = ctx.cancellationSignal.reason;
      if (cancellation?.message === 'CANCELLED' && runtime && spec) {
        try { await runtime.cancel(spec); }
        catch { ctx.log.warn('large_task.cleanup_pending', { code: 'LARGE_TASK_CANCELLED' }); }
        const record = audit('LARGE_TASK_CANCELLED');
        ctx.log.info('large_task.terminated', { largeTaskAuditRecord: record });
      }
      throw cancellation;
    }
    const typedCode = error?.name === 'ApplicationFailure' ? error.type : error?.code;
    if (error?.name === 'ApplicationFailure' && !typedCode?.startsWith('LARGE_TASK_')) throw error;
    const code = typedCode?.startsWith('LARGE_TASK_') ? typedCode : 'LARGE_TASK_RUNTIME_UNAVAILABLE';
    const retryable = error?.name === 'ApplicationFailure' ? !error.nonRetryable
      : error.retryable ?? (code === 'LARGE_TASK_RUNTIME_UNAVAILABLE');
    const record = audit(code);
    ctx.log.info('large_task.terminated', { largeTaskAuditRecord: record });
    throw ApplicationFailure.create({ message: code, type: code, nonRetryable: !retryable,
      details: [{ largeTaskAuditRecord: record }] });
  }
  function audit(code) {
    return largeTaskAuditRecord({ tenantId: tenant.tenantId, workspaceId: tenant.workspaceId,
      taskId: checkpoint.jobName ?? ctx.info.activityId, code, profileVersion: LARGE_TASK_WORKER_PROFILE_VERSION });
  }
}

export const largeTaskRunInputSchema = Object.freeze({
  $id: 'flows/activity/largeTask.run/input', type: 'object', required: ['profile'],
  properties: { profile: { type: 'string', minLength: 1 }, parameters: { 'x-falcone-expression': true } }, additionalProperties: false,
});
export const largeTaskRunOutputSchema = Object.freeze({
  $id: 'flows/activity/largeTask.run/output', type: 'object', required: ['code', 'result', 'logTail'],
  properties: { code: { const: 'LARGE_TASK_SUCCEEDED' }, result: {}, logTail: { type: 'string' } }, additionalProperties: false,
});
