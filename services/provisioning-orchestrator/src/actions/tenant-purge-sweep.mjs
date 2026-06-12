/**
 * Tenant purge sweep action.
 *
 * Identifies tenants in `state='deleted'` whose retention window has elapsed,
 * re-gates each candidate through `evaluateTenantLifecycleMutation` (never
 * bypassing the dual-confirmation / export-checkpoint guards), and drives a
 * cascading teardown across all six provisioned domains. On full success it
 * hard-deletes the tenant's service-owned rows, transitions the tenant to
 * `state='purged'`, and emits a `tenant.purged` event carrying a verifiable
 * destruction manifest. On any partial failure it emits `purge.failed`, does NOT
 * emit `tenant.purged`, and does NOT transition the tenant (retryable, idempotent).
 *
 * All I/O is dependency-injected (see {@link resolveDependencies}) so the unit is
 * fully testable with fakes and defaults to safe no-ops.
 *
 * @module actions/tenant-purge-sweep
 */
import { randomUUID } from 'node:crypto';
import { evaluateTenantLifecycleMutation } from '../../../internal-contracts/src/index.mjs';
import { teardown as iamTeardown } from '../appliers/iam-applier.mjs';
import { teardown as postgresTeardown } from '../appliers/postgres-applier.mjs';
import { teardown as mongoTeardown } from '../appliers/mongo-applier.mjs';
import { teardown as kafkaTeardown } from '../appliers/kafka-applier.mjs';
import { teardown as storageTeardown } from '../appliers/storage-applier.mjs';
import { teardown as functionsTeardown } from '../appliers/functions-applier.mjs';
import { teardown as workflowsTeardown } from '../appliers/workflows-applier.mjs';

/**
 * Ordered teardown plan. Each entry maps the saga domain to its applier and the
 * key under `tenant.domains` that holds that domain's data.
 */
const TEARDOWN_PLAN = [
  { domain: 'iam', dataKey: 'iam', teardownKey: 'iamTeardown' },
  { domain: 'postgres_metadata', dataKey: 'postgres_metadata', teardownKey: 'postgresTeardown' },
  { domain: 'mongo_metadata', dataKey: 'mongo_metadata', teardownKey: 'mongoTeardown' },
  { domain: 'kafka', dataKey: 'kafka', teardownKey: 'kafkaTeardown' },
  { domain: 'storage', dataKey: 'storage', teardownKey: 'storageTeardown' },
  { domain: 'functions', dataKey: 'functions', teardownKey: 'functionsTeardown' },
  // Workflows (flows / Temporal) — change: add-flows-tenancy-isolation-limits (design D7).
  { domain: 'workflows', dataKey: 'workflows', teardownKey: 'workflowsTeardown' },
];

export function resolveDependencies(params = {}) {
  return {
    now: params.now ?? new Date().toISOString(),
    dryRun: params.dryRun === true,
    log: params.log ?? console,
    // Candidate query — must return ALREADY tenant-scoped deleted tenants.
    listEligibleTenants: params.listEligibleTenants ?? (async () => []),
    // Per-domain credentials passed to each teardown (e.g. { iam: {...}, ... }).
    credentialsByDomain: params.credentialsByDomain ?? {},
    // Applier teardowns (injectable for tests).
    iamTeardown: params.iamTeardown ?? iamTeardown,
    postgresTeardown: params.postgresTeardown ?? postgresTeardown,
    mongoTeardown: params.mongoTeardown ?? mongoTeardown,
    kafkaTeardown: params.kafkaTeardown ?? kafkaTeardown,
    storageTeardown: params.storageTeardown ?? storageTeardown,
    functionsTeardown: params.functionsTeardown ?? functionsTeardown,
    workflowsTeardown: params.workflowsTeardown ?? workflowsTeardown,
    // Side effects after a full-success purge.
    hardDeleteServiceRows: params.hardDeleteServiceRows ?? (async () => {}),
    transitionTenantState: params.transitionTenantState ?? (async () => {}),
    publishEvent: params.publishEvent ?? (async () => {}),
  };
}

/**
 * @param {Object} [params]
 * @returns {Promise<{processed:number, purged:number, skipped:number, errors:Array, manifests:Array}>}
 */
export async function main(params = {}) {
  const deps = resolveDependencies(params);
  const summary = { processed: 0, purged: 0, skipped: 0, errors: [], manifests: [] };

  const candidates = await deps.listEligibleTenants();

  for (const tenant of candidates ?? []) {
    summary.processed += 1;
    const tenantId = tenant?.tenantId;

    // Re-gate every candidate through the shared contract. Never bypass.
    let gate;
    try {
      gate = evaluateTenantLifecycleMutation({
        tenant,
        action: 'purge',
        workspaces: tenant?.workspaces ?? [],
        managedResources: tenant?.managedResources ?? [],
        now: deps.now,
        hasElevatedAccess: tenant?.purgeAuthorization?.hasElevatedAccess === true,
        hasSecondConfirmation: tenant?.purgeAuthorization?.hasSecondConfirmation === true,
      });
    } catch (error) {
      summary.errors.push({ tenantId, code: error.code ?? 'GATE_ERROR', message: error.message });
      continue;
    }

    if (!gate.allowed) {
      summary.skipped += 1;
      deps.log?.warn?.(`tenant-purge-sweep: skipping ${tenantId}: ${gate.blocker}`);
      summary.manifests.push({ tenantId, skipped: true, blocker: gate.blocker });
      continue;
    }

    // Drive the cascading teardown across all six domains, recording each step.
    const domains = tenant?.domains ?? {};
    const destroyedResources = [];
    const stepLog = [];
    let domainError = null;

    for (const step of TEARDOWN_PLAN) {
      const teardownFn = deps[step.teardownKey];
      const domainData = domains[step.dataKey] ?? {};
      const credentials = deps.credentialsByDomain[step.domain] ?? {};
      try {
        const result = await teardownFn(tenantId, domainData, { dryRun: deps.dryRun, credentials, log: deps.log });
        stepLog.push({ domain: step.domain, status: result?.status, results: result?.resource_results ?? [] });
        for (const rr of result?.resource_results ?? []) {
          if (rr.action === 'removed' || rr.action === 'would_remove') {
            destroyedResources.push({
              domain: step.domain,
              resourceType: rr.resource_type,
              resourceId: rr.resource_id ?? rr.resource_name,
              status: rr.action,
            });
          }
        }
        if (result?.status === 'error' || (result?.counts?.errors ?? 0) > 0) {
          domainError = { domain: step.domain, message: result?.message ?? 'domain teardown reported errors' };
          break;
        }
      } catch (error) {
        domainError = { domain: step.domain, message: error.message };
        stepLog.push({ domain: step.domain, status: 'error', error: error.message });
        break;
      }
    }

    if (domainError) {
      // Partial failure: do NOT hard-delete, do NOT transition, do NOT emit tenant.purged.
      summary.errors.push({ tenantId, code: 'PURGE_PARTIAL_FAILURE', domain: domainError.domain, message: domainError.message });
      summary.manifests.push({ tenantId, purged: false, failedDomain: domainError.domain, partialInventory: destroyedResources });
      await deps.publishEvent('purge.failed', {
        eventType: 'purge.failed',
        tenantId,
        failedDomain: domainError.domain,
        message: domainError.message,
        partialInventory: destroyedResources,
        actorUserId: tenant?.purgeAuthorization?.actorUserId ?? null,
        approvalTicket: tenant?.purgeAuthorization?.approvalTicket ?? null,
        occurredAt: deps.now,
      });
      continue;
    }

    // dryRun: report what would be purged but perform no destructive side effects.
    if (deps.dryRun) {
      summary.manifests.push({ tenantId, purged: false, dryRun: true, destroyedResources });
      continue;
    }

    // Full success: hard-delete service rows, transition, emit tenant.purged.
    try {
      await deps.hardDeleteServiceRows(tenantId);
      await deps.transitionTenantState(tenantId, 'purged');
    } catch (error) {
      summary.errors.push({ tenantId, code: 'PURGE_FINALIZE_FAILURE', message: error.message });
      summary.manifests.push({ tenantId, purged: false, failedDomain: 'finalize', partialInventory: destroyedResources });
      await deps.publishEvent('purge.failed', {
        eventType: 'purge.failed',
        tenantId,
        failedDomain: 'finalize',
        message: error.message,
        partialInventory: destroyedResources,
        actorUserId: tenant?.purgeAuthorization?.actorUserId ?? null,
        approvalTicket: tenant?.purgeAuthorization?.approvalTicket ?? null,
        occurredAt: deps.now,
      });
      continue;
    }

    const manifest = {
      eventType: 'tenant.purged',
      tenantId,
      destroyedResources,
      actorUserId: tenant?.purgeAuthorization?.actorUserId ?? null,
      approvalTicket: tenant?.purgeAuthorization?.approvalTicket ?? null,
      occurredAt: deps.now,
    };
    await deps.publishEvent('tenant.purged', manifest);

    summary.purged += 1;
    summary.manifests.push({ tenantId, purged: true, operationId: `aop_${randomUUID().replace(/-/g, '').slice(0, 24)}`, destroyedResources });
  }

  return summary;
}
