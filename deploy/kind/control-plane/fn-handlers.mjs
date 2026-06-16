// Console Functions page (/console/functions) handlers — REAL execution.
//
// Wires the repo's /v1/functions/* surface to the real Kubernetes function
// executor (function-executor.mjs): deploy stores the nodejs source; invoke runs
// it in an ephemeral Job and records a real activation (result + logs). Shapes
// match what ConsoleFunctionsPage consumes (FunctionAction / FunctionActivation /
// FunctionInvocationAccepted / GatewayMutationAccepted).
import { randomUUID } from 'node:crypto';
import * as store from './tenant-store.mjs';
import { deployKnativeService, invokeKnative, waitKsvcReady, ksvcName, ksvcHost } from './function-executor.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

// Returns the caller's tenantId to use as a scope predicate on fn_actions queries,
// or null for superadmin/internal callers (they may operate cross-tenant).
function callerTenantId(identity) {
  if (!identity) return null;
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return null;
  return identity.tenantId ?? null;
}

function activationOut(r) {
  return {
    activationId: r.activation_id, resourceId: r.resource_id,
    status: r.status === 'success' ? 'succeeded' : 'failed',
    startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms ?? 0,
    triggerKind: 'manual', statusCode: r.status_code ?? undefined
  };
}
function actionOut(r, latest) {
  return {
    resourceId: r.resource_id, tenantId: r.tenant_id, workspaceId: r.workspace_id,
    actionName: r.action_name, namespaceName: r.workspace_id, status: 'active',
    activeVersionId: `v${r.version}`, rollbackAvailable: r.version > 1, versionCount: r.version,
    execution: {
      entrypoint: r.entrypoint, runtime: r.runtime, parameters: r.parameters ?? {},
      limits: { timeoutMs: r.timeout_ms, memoryMb: r.memory_mb }
    },
    source: { kind: 'nodejs', inlineCode: r.source_code, entryFile: 'index.js' },
    provisioning: { state: 'active' },
    timestamps: { createdAt: r.created_at, updatedAt: r.updated_at },
    latestActivation: latest ? activationOut(latest) : undefined
  };
}

// POST /v1/functions/actions  (create/deploy) | PUT /v1/functions/actions/{actionId} (update)
async function fnDeploy(ctx) {
  const b = ctx.body ?? {};
  const workspaceId = b.workspaceId ?? ctx.params.workspaceId;
  const actionName = b.actionName ?? b.name;
  if (!workspaceId || !actionName) return err(400, 'VALIDATION_ERROR', 'workspaceId and actionName are required');
  const ws = await store.getWorkspace(ctx.pool, workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
  const code = b.source?.inlineCode ?? b.source?.code;
  if (!code) return err(400, 'VALIDATION_ERROR', 'source.inlineCode is required');
  const existing = ctx.params.actionId ? await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity)) : null;
  const resourceId = existing?.resource_id ?? ctx.params.actionId ?? `fn_${randomUUID().slice(0, 12)}`;
  const limits = b.execution?.limits ?? {};
  const memoryMb = Number(limits.memoryMb) || 256;
  const timeoutMs = Number(limits.timeoutMs) || 60000;
  const name = ksvcName(ws.slug ?? ws.id.slice(0, 8), actionName);
  // Deploy/update the function's Knative Service (new revision on code change).
  try {
    await deployKnativeService(name, code, { memoryMb, timeoutMs });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'FN_DEPLOY_FAILED', String(e.message ?? e));
  }
  const rec = await store.upsertFnAction(ctx.pool, {
    resourceId, workspaceId: ws.id, tenantId: ws.tenant_id, actionName,
    runtime: b.execution?.runtime ?? 'nodejs:22', entrypoint: b.execution?.entrypoint ?? 'main',
    sourceCode: code, parameters: b.execution?.parameters ?? null, memoryMb, timeoutMs,
    ksvcName: name, createdBy: ctx.identity?.sub
  });
  return ok(existing ? 200 : 201, {
    requestId: randomUUID(), correlationId: ctx.callerContext?.correlationId ?? randomUUID(),
    resourceId: rec.resource_id, status: 'accepted', acceptedAt: new Date().toISOString()
  });
}

// GET /v1/functions/workspaces/{workspaceId}/inventory
async function fnInventory(ctx) {
  const rows = await store.listFnActions(ctx.pool, ctx.params.workspaceId);
  const actions = [];
  for (const r of rows) actions.push(actionOut(r, await store.latestFnActivation(ctx.pool, r.resource_id)));
  return ok(200, { workspaceId: ctx.params.workspaceId, actions, counts: { actions: actions.length, packages: 0, rules: 0, triggers: 0, httpExposures: 0 } });
}
// GET /v1/functions/workspaces/{workspaceId}/actions
async function fnListActions(ctx) {
  const rows = await store.listFnActions(ctx.pool, ctx.params.workspaceId);
  return ok(200, { items: rows.map((r) => actionOut(r)), page: { total: rows.length } });
}
// GET /v1/functions/actions/{actionId}
async function fnActionDetail(ctx) {
  const r = await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!r) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.actionId} not found`);
  return ok(200, actionOut(r, await store.latestFnActivation(ctx.pool, r.resource_id)));
}
// POST /v1/functions/actions/{actionId}/invocations  — REAL execution
async function fnInvoke(ctx) {
  const r = await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!r) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.actionId} not found`);
  const params = ctx.body?.parameters ?? {};
  const startedAt = new Date().toISOString();
  let run;
  if (!r.ksvc_name) {
    run = { status: 'failure', result: { error: 'function has no Knative service (redeploy it)' }, logs: [], durationMs: 0, statusCode: 502 };
  } else {
    // Cold start: the cluster-local DNS only resolves once the ksvc is Ready.
    const ready = await waitKsvcReady(r.ksvc_name, 90000);
    run = ready
      ? await invokeKnative(ksvcHost(r.ksvc_name), params, { timeoutMs: (r.timeout_ms || 60000) + 30000 })
      : { status: 'failure', result: { error: 'function (Knative service) is not ready' }, logs: [], durationMs: 0, statusCode: 503 };
  }
  const activationId = `act_${randomUUID().slice(0, 12)}`;
  await store.insertFnActivation(ctx.pool, {
    activationId, resourceId: r.resource_id, workspaceId: r.workspace_id,
    status: run.status, statusCode: run.statusCode, result: run.result, logs: run.logs,
    durationMs: run.durationMs, startedAt, finishedAt: new Date().toISOString()
  });
  return ok(202, {
    invocationId: activationId, resourceId: r.resource_id,
    status: run.status === 'success' ? 'completed' : 'failed', acceptedAt: startedAt
  });
}
// GET /v1/functions/actions/{actionId}/activations
async function fnActivations(ctx) {
  // Verify the action exists and belongs to the caller's tenant before listing its activations.
  const action = await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!action) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.actionId} not found`);
  const rows = await store.listFnActivations(ctx.pool, ctx.params.actionId);
  return ok(200, { items: rows.map(activationOut), page: { total: rows.length } });
}
// GET /v1/functions/actions/{actionId}/activations/{activationId}
async function fnActivation(ctx) {
  const r = await store.getFnActivation(ctx.pool, ctx.params.activationId);
  if (!r) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  // Verify the parent function belongs to the caller's tenant (fail-closed, no existence leak).
  const action = await store.getFnAction(ctx.pool, r.resource_id, callerTenantId(ctx.identity));
  if (!action) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  return ok(200, activationOut(r));
}
// GET .../activations/{activationId}/logs
async function fnActivationLogs(ctx) {
  const r = await store.getFnActivation(ctx.pool, ctx.params.activationId);
  if (!r) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  const action = await store.getFnAction(ctx.pool, r.resource_id, callerTenantId(ctx.identity));
  if (!action) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  return ok(200, { activationId: r.activation_id, lines: Array.isArray(r.logs) ? r.logs : [], truncated: false });
}
// GET .../activations/{activationId}/result
async function fnActivationResult(ctx) {
  const r = await store.getFnActivation(ctx.pool, ctx.params.activationId);
  if (!r) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  const action = await store.getFnAction(ctx.pool, r.resource_id, callerTenantId(ctx.identity));
  if (!action) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  return ok(200, { activationId: r.activation_id, status: r.status === 'success' ? 'succeeded' : 'failed', result: r.result ?? {}, contentType: 'application/json' });
}
// GET /v1/functions/actions/{actionId}/versions
async function fnVersions(ctx) {
  const r = await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!r) return err(404, 'ACTION_NOT_FOUND', 'action not found');
  return ok(200, { items: [{ versionId: `v${r.version}`, resourceId: r.resource_id, versionNumber: r.version, status: 'active', originType: 'deploy', rollbackEligible: false, timestamps: { createdAt: r.created_at, updatedAt: r.updated_at } }], page: { total: 1 } });
}
// POST /v1/functions/actions/{actionId}/rollback  (no historical versions kept — accept as no-op)
async function fnRollback(ctx) {
  const r = await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!r) return err(404, 'ACTION_NOT_FOUND', 'action not found');
  return ok(202, { requestId: randomUUID(), resourceId: r.resource_id, requestedVersionId: ctx.body?.versionId ?? `v${r.version}`, status: 'accepted', correlationId: randomUUID() });
}

export const FN_HANDLERS = {
  fnDeploy, fnInventory, fnListActions, fnActionDetail, fnInvoke,
  fnActivations, fnActivation, fnActivationLogs, fnActivationResult, fnVersions, fnRollback
};
