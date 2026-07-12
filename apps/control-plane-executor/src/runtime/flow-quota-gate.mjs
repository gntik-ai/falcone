// Per-tenant / per-workspace flow quota gate (change: add-flows-tenancy-isolation-limits).
//
// The flows API enforces five quota dimensions (design.md D6) at the API boundary BEFORE doing
// any work:
//   max_flows                     stored flow definitions per tenant
//   max_flow_versions             published versions per flow
//   max_concurrent_executions     running executions per workspace
//   flow_starts_per_minute        execution-start rate per workspace
//   flow_signal_rate_per_minute   signal calls per workspace per minute
//
// Enforcement reuses the platform quota decision model (packages/provisioning-orchestrator/
// src/models/quota-enforcement.mjs::evaluateQuotaDecision): a `hard_blocked` / `soft_grace_exhausted`
// decision becomes HTTP 429 with `{ code: 'QUOTA_EXCEEDED', dimension }`. The seam is an injected
// `evaluate({ dimensionKey, tenantId, workspaceId, currentUsage })` returning a decision object;
// production wires it to the provisioning-orchestrator quota-enforce action over its metadata DB,
// while black-box tests inject a deterministic fake. When NO gate is injected the flows API is
// unmetered (the no-database black-box default), exactly like the in-memory store fallback.

export const FLOW_QUOTA_DIMENSIONS = Object.freeze({
  MAX_FLOWS: 'max_flows',
  MAX_FLOW_VERSIONS: 'max_flow_versions',
  MAX_CONCURRENT_EXECUTIONS: 'max_concurrent_executions',
  FLOW_STARTS_PER_MINUTE: 'flow_starts_per_minute',
  FLOW_SIGNAL_RATE_PER_MINUTE: 'flow_signal_rate_per_minute',
});

const FLOW_QUOTA_DIMENSION_SET = new Set(Object.values(FLOW_QUOTA_DIMENSIONS));

// Quota decisions that DENY the action (a hard limit hit, or a soft grace fully exhausted).
const DENY_DECISIONS = new Set(['hard_blocked', 'hard_limit_exceeded', 'soft_grace_exhausted']);

/**
 * A 429 error carrying the breached dimension, surfaced by the server's error envelope as
 * `{ code: 'QUOTA_EXCEEDED', message, dimension }`.
 */
export function quotaExceededError(dimensionKey, detail = {}) {
  return Object.assign(new Error(`Quota exceeded for ${dimensionKey}`), {
    statusCode: 429,
    code: 'QUOTA_EXCEEDED',
    dimension: dimensionKey,
    quota: detail,
  });
}

/**
 * Build a flow quota gate from an injected evaluator.
 *
 * @param {object} [opts]
 * @param {(input:{dimensionKey:string,tenantId:string,workspaceId:string,currentUsage?:number})=>Promise<object>} [opts.evaluate]
 *        returns a decision object (shape of evaluateQuotaDecision) or `{ decision }`. Throwing /
 *        returning a `metering_unavailable` decision fails CLOSED (429) — a quota that cannot be
 *        evaluated must not silently allow unbounded consumption.
 */
export function createFlowQuotaGate({ evaluate } = {}) {
  // No evaluator → unmetered (black-box / no-DB default).
  async function enforce(dimensionKey, { tenantId, workspaceId, currentUsage } = {}) {
    if (!FLOW_QUOTA_DIMENSION_SET.has(dimensionKey)) {
      throw new Error(`createFlowQuotaGate: unknown flow quota dimension "${dimensionKey}"`);
    }
    if (typeof evaluate !== 'function') return { allowed: true, decision: 'unmetered', dimension: dimensionKey };

    let decision;
    try {
      decision = await evaluate({ dimensionKey, tenantId, workspaceId, currentUsage });
    } catch (err) {
      // Fail closed: an evaluator error denies the action rather than allowing unbounded use.
      throw quotaExceededError(dimensionKey, { reason: 'metering_unavailable', message: err?.message });
    }
    const d = decision?.decision ?? (decision?.allowed === false ? 'hard_blocked' : 'allowed');
    if (d === 'metering_unavailable' || DENY_DECISIONS.has(d)) {
      throw quotaExceededError(dimensionKey, {
        decision: d,
        effectiveLimit: decision?.effectiveLimit,
        currentUsage: decision?.currentUsage ?? currentUsage,
      });
    }
    return { allowed: true, decision: d, dimension: dimensionKey, ...decision };
  }

  return { enforce };
}
