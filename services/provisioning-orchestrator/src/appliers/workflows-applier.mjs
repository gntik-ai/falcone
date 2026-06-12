/**
 * Workflows (flows / Temporal) domain applier for tenant teardown
 * (change: add-flows-tenancy-isolation-limits, design D7).
 *
 * Symmetric with iam-applier / functions-applier: exports `teardown(tenantId, domainData,
 * { dryRun, credentials, log })` returning a DomainResult `{ status, resource_results, counts }`.
 * The TEARDOWN_PLAN in tenant-purge-sweep.mjs appends `{ domain:'workflows', dataKey:'workflows',
 * teardownKey:'workflowsTeardown' }` so a tenant purge cascades to the workflows domain with the
 * SAME partial-failure semantics as the other six domains (any error → counts.errors>0 → the
 * sweep does NOT finalize and emits purge.failed).
 *
 * On the SHARED-NAMESPACE tenancy model (ADR-11), Temporal isolation is by `tenantId` search
 * attribute, so teardown:
 *   1. terminates every running workflow execution whose `tenantId` matches (ListWorkflows +
 *      TerminateWorkflow loop, paginated) — no orphaned Temporal state,
 *   2. deletes flow_definitions, flow_versions, and flow schedule artifacts for the tenant from
 *      Postgres.
 * The trigger-artifact removal is a SEAM for the sibling flows-triggers change (a no-op here when
 * no trigger remover is injected).
 *
 * Idempotent: a second run terminates nothing (no running executions) and deletes nothing (rows
 * already gone) and still returns a non-error result — re-purging a tenant never errors.
 *
 * All I/O is dependency-injected: `credentials.db` is a query-capable client
 * (`{ query(sql, params) }`), `credentials.terminateTenantExecutions(tenantId)` performs the
 * Temporal bulk-terminate. Both default to safe no-ops so the unit is fully testable with fakes.
 */

import { zeroCounts } from '../reprovision/types.mjs';

const POSTGRES_TARGETS = [
  // Order: versions + schedules + trigger artifacts before definitions (FK-safe), then the
  // definition head. The trigger-artifact tables (flow_trigger_secrets / flow_trigger_registrations,
  // change add-flows-triggers) are purged here so no per-trigger HMAC secret or event subscription
  // outlives the tenant; Temporal Schedules themselves are removed by removeTriggerArtifacts below.
  { resourceType: 'flow_versions', table: 'flow_versions' },
  { resourceType: 'flow_schedules', table: 'flow_schedules' },
  { resourceType: 'flow_trigger_secrets', table: 'flow_trigger_secrets' },
  { resourceType: 'flow_trigger_registrations', table: 'flow_trigger_registrations' },
  { resourceType: 'flow_definitions', table: 'flow_definitions' },
];

/**
 * @param {string} tenantId
 * @param {Object} domainData         the `workflows` section of tenant.domains (may be empty)
 * @param {Object} options
 * @param {boolean} [options.dryRun]
 * @param {Object} [options.credentials]
 *        - db: { query(sql, params) } — Postgres client for the metadata rows
 *        - terminateTenantExecutions(tenantId): Promise<{terminated:number}> — Temporal bulk-terminate
 *        - removeTriggerArtifacts(tenantId): Promise<{removed:number}> — seam for flows-triggers
 * @param {Console} [options.log]
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function teardown(tenantId, domainData = {}, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'workflows';
  const counts = zeroCounts();
  const resource_results = [];

  const db = credentials.db ?? null;
  const terminateTenantExecutions = credentials.terminateTenantExecutions ?? null;
  const removeTriggerArtifacts = credentials.removeTriggerArtifacts ?? null;

  // 1. Terminate running Temporal executions for the tenant (shared-namespace model). No orphans.
  try {
    let terminated = 0;
    if (!dryRun && typeof terminateTenantExecutions === 'function') {
      const r = await terminateTenantExecutions(tenantId);
      terminated = Number(r?.terminated ?? 0);
    }
    resource_results.push({
      resource_type: 'temporal_executions',
      resource_name: `tenantId=${tenantId}`,
      resource_id: tenantId,
      action: dryRun ? 'would_remove' : 'removed',
      message: dryRun ? null : `${terminated} execution(s) terminated`,
      warnings: [],
      diff: null,
    });
  } catch (err) {
    resource_results.push({
      resource_type: 'temporal_executions',
      resource_name: `tenantId=${tenantId}`,
      resource_id: tenantId,
      action: 'error',
      message: err.message,
      warnings: [],
      diff: null,
    });
    counts.errors++;
  }

  // 2. Delete the tenant's flow metadata rows (versions/schedules/definitions). RLS does not apply
  // here — the purge runs as a privileged sweep (BYPASSRLS), so the DELETE is tenant-scoped by the
  // explicit `tenant_id = $1` predicate. A missing table (42P01) is treated as "already gone"
  // (idempotent / not-yet-provisioned), not an error.
  if (typeof db?.query === 'function') {
    for (const target of POSTGRES_TARGETS) {
      try {
        let removed = 0;
        if (!dryRun) {
          const res = await db.query(`DELETE FROM ${target.table} WHERE tenant_id = $1`, [tenantId]);
          removed = res?.rowCount ?? 0;
        }
        resource_results.push({
          resource_type: target.resourceType,
          resource_name: `tenantId=${tenantId}`,
          resource_id: tenantId,
          action: dryRun ? 'would_remove' : 'removed',
          message: dryRun ? null : `${removed} row(s) removed`,
          warnings: [],
          diff: null,
        });
      } catch (err) {
        if (err?.code === '42P01') {
          // Table absent (workflows never provisioned for this tenant): not an error.
          resource_results.push({
            resource_type: target.resourceType,
            resource_name: `tenantId=${tenantId}`,
            resource_id: tenantId,
            action: dryRun ? 'would_skip' : 'skipped',
            message: 'table absent',
            warnings: [],
            diff: null,
          });
          continue;
        }
        resource_results.push({
          resource_type: target.resourceType,
          resource_name: `tenantId=${tenantId}`,
          resource_id: tenantId,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        });
        counts.errors++;
      }
    }
  }

  // 3. Trigger-artifact removal SEAM (sibling flows-triggers change). No-op when not injected.
  if (typeof removeTriggerArtifacts === 'function') {
    try {
      let removed = 0;
      if (!dryRun) {
        const r = await removeTriggerArtifacts(tenantId);
        removed = Number(r?.removed ?? 0);
      }
      resource_results.push({
        resource_type: 'flow_trigger_artifacts',
        resource_name: `tenantId=${tenantId}`,
        resource_id: tenantId,
        action: dryRun ? 'would_remove' : 'removed',
        message: dryRun ? null : `${removed} artifact(s) removed`,
        warnings: [],
        diff: null,
      });
    } catch (err) {
      resource_results.push({
        resource_type: 'flow_trigger_artifacts',
        resource_name: `tenantId=${tenantId}`,
        resource_id: tenantId,
        action: 'error',
        message: err.message,
        warnings: [],
        diff: null,
      });
      counts.errors++;
    }
  }

  const status = counts.errors > 0 ? 'error' : (dryRun ? 'would_apply' : 'applied');
  return { domain_key, status, resource_results, counts, message: null };
}
