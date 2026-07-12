// Workspace-count quota gate for the kind control-plane (#556 BUG-QUOTA-ENFORCE).
//
// Workspace creation had NO quota gate — 4 workspaces could be created under a
// max_workspaces=3 entitlement. Enforcement elsewhere (flows/mcp/observability)
// already uses the product's governance model; this reuses the SAME single source
// of truth so workspace creation honours plan/override precedence and the seeded
// dimension default:
//   resolveEffectiveLimit(db, tenant, 'max_workspaces')  -> override → plan → default(3)
//   evaluateQuotaDecision({ effectiveLimit, quotaType, graceMargin, currentUsage })
//      -> hard: deny when usage >= limit; soft: allow within grace ceiling; unlimited: allow
//
// The product modules resolve under /repo at runtime (same as b-handlers' action
// imports); `opts.load` makes the dependency injectable for tests. Fails OPEN (never
// blocks a create) if the governance model is unavailable — quota is a governance
// control, not a tenant-isolation boundary, so availability wins on resolver error.
const QUOTA_REPO = '/repo/packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs';
const QUOTA_MODEL = '/repo/packages/provisioning-orchestrator/src/models/quota-enforcement.mjs';

const WORKSPACE_DIMENSION = 'max_workspaces';

async function defaultLoad() {
  const [repo, model] = await Promise.all([import(QUOTA_REPO), import(QUOTA_MODEL)]);
  return { resolveEffectiveLimit: repo.resolveEffectiveLimit, evaluateQuotaDecision: model.evaluateQuotaDecision };
}

/**
 * Decide whether the tenant may create another workspace.
 * @param {{query:Function}} pool       control-plane Postgres pool (the governance `db`)
 * @param {string} tenantId
 * @param {number} currentUsage         existing workspace count (BEFORE this create)
 * @param {object} [opts]
 * @param {()=>Promise<{resolveEffectiveLimit:Function,evaluateQuotaDecision:Function}>} [opts.load]
 * @returns {Promise<{allowed:boolean, decision:string, effectiveLimit?:number, currentUsage?:number}>}
 */
export async function checkWorkspaceQuota(pool, tenantId, currentUsage, opts = {}) {
  const load = opts.load ?? defaultLoad;
  let mods;
  try {
    mods = await load();
  } catch {
    return { allowed: true, decision: 'quota_unavailable' }; // governance model absent → fail open
  }
  try {
    const eff = await mods.resolveEffectiveLimit(pool, tenantId, WORKSPACE_DIMENSION);
    const decision = mods.evaluateQuotaDecision({
      effectiveLimit: eff.effectiveLimit,
      quotaType: eff.quotaType,
      graceMargin: eff.graceMargin,
      currentUsage,
    });
    // Carry the resolved source + dimension so a denial can be written to quota_enforcement_log
    // (fix-audit-enforcement-logging #594) without re-resolving the governance model.
    return { ...decision, source: eff.source ?? 'default', dimensionKey: WORKSPACE_DIMENSION };
  } catch {
    return { allowed: true, decision: 'quota_unavailable' }; // resolver error → fail open
  }
}
