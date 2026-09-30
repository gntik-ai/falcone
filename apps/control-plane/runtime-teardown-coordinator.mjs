// Owner-safe aggregate runtime teardown boundary. Runtime adapters are injected by the
// deployment; absence or disagreement is deliberately treated as pending, never success.
import { deleteKnativeService } from './function-executor.mjs';

export function createProductionRuntimeAdapter({ knativeRuntime = null, deleteService = deleteKnativeService } = {}) {
  return {
    async cleanup({ functions = [], mcp = [] }) {
      const status = typeof knativeRuntime?.status === 'function' ? knativeRuntime.status() : null;
      if (!status || status.state !== 'ready' || typeof knativeRuntime?.canServeWorkloads !== 'function' || !knativeRuntime.canServeWorkloads(status)) return { ready: false, pending: [...functions, ...mcp], reason: 'runtime_unavailable' };
      const pending = [];
      for (const fn of functions) {
        try { await deleteService(fn.ksvcName, { tenantId: fn.tenantId, functionResourceId: fn.resourceId, verifyAbsence: true }); }
        catch (error) { pending.push({ ...fn, reason: error?.statusCode === 409 ? 'precondition_conflict' : 'runtime_delete_failed' }); }
      }
      // MCP cleanup is intentionally delegated to the executor recovery worker. Retain its
      // snapshot and obligation until that owner-safe boundary confirms deletion.
      pending.push(...mcp);
      return { ready: pending.length === 0, pending };
    },
  };
}

export function createRuntimeTeardownCoordinator({ store, runtime }) {
  if (!store) throw new TypeError('runtime teardown requires store');
  const adapter = runtime ?? { async cleanup({ functions = [], mcp = [] }) { return { ready: false, pending: [...functions, ...mcp], reason: 'runtime_adapter_unavailable' }; } };
  const run = async (pool, scope, id, correlationId) => {
    const ownership = await store.listRuntimeOwnership(pool, { ...scope, [scope.tenantId ? 'tenantId' : 'workspaceId']: id });
    const result = await adapter.cleanup({ ...ownership, ...scope, tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? id, correlationId });
    const pending = result?.pending ?? (!result?.ready ? [...(ownership.functions ?? []), ...(ownership.mcp ?? [])] : []);
    if (!result?.ready || pending.length) {
      await store.deferAggregateCleanup(pool, { tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? (scope.tenantId ? null : id), resources: pending.length ? pending : [...(ownership.functions ?? []), ...(ownership.mcp ?? [])], correlationId });
    }
    // A worker may still own a durable retry after the current logical snapshot becomes empty.
    // Never finalize the parent while that obligation is pending or processing.
    const obligations = await store.listPendingRuntimeObligations(pool, {
      tenantId: ownership.tenantId ?? scope.tenantId,
      workspaceId: scope.tenantId ? null : id,
    });
    if (!result?.ready || pending.length || obligations.length) {
      const byResource = new Map();
      for (const item of [...pending, ...obligations]) {
        const key = `${item.resourceType ?? item.type ?? 'function'}:${item.resourceId ?? item.id}`;
        if (!byResource.has(key)) byResource.set(key, item);
      }
      return { pending: true, statusCode: 202, tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? (scope.tenantId ? null : id), obligations: [...byResource.values()] };
    }
    return { pending: false, finalize: true, tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? (scope.tenantId ? null : id) };
  };
  return {
    purgeTenant: (pool, tenantId, correlationId) => run(pool, { tenantId }, tenantId, correlationId),
    purgeWorkspace: (pool, workspaceId, correlationId) => run(pool, { workspaceId }, workspaceId, correlationId),
  };
}
