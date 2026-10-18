import { resolveEffectiveLimit } from '../../../../packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs';
import { evaluateQuotaDecision } from '../../../../packages/provisioning-orchestrator/src/models/quota-enforcement.mjs';
import { recordQuotaEnforcement } from '../../../control-plane/audit-writer.mjs';

// The executor uses the live metadata pool directly: resolver failures propagate to the gate,
// which fails closed. Audit writes are best-effort and cannot change an admission decision.
export function createFlowQuotaEvaluator({ pool, load = resolveEffectiveLimit, recordDenial = recordQuotaEnforcement } = {}) {
  return {
    async evaluate({ dimensionKey, tenantId, workspaceId, currentUsage, attemptedAction }) {
      const limit = await load(pool, tenantId, dimensionKey);
      const decision = {
        ...evaluateQuotaDecision({
          effectiveLimit: limit.effectiveLimit,
          quotaType: limit.quotaType,
          graceMargin: limit.graceMargin,
          currentUsage,
        }),
        effectiveLimit: limit.effectiveLimit,
        source: limit.source,
      };
      if (decision.decision === 'hard_blocked' || decision.decision === 'soft_grace_exhausted') {
        try {
          await recordDenial(pool, { ...decision, tenantId, workspaceId, dimensionKey, attemptedAction });
        } catch { /* A failed log insert never changes the decision. */ }
      }
      return decision;
    },
  };
}
