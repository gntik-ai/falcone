// Governance schema bootstrap for the kind control-plane (#555 BUG-GOV-SCHEMA).
//
// The wireable governance routes (capability-catalog, plan-assign, scope-enforcement
// audit, quota dimensions / effective-limits) dispatch to the REAL product actions
// dynamically imported under `/repo/services/provisioning-orchestrator/...`. Those
// actions query tables that live in the provisioning-orchestrator MIGRATIONS — but
// the kind boot only ran `ensureSchema` (the hand-written domain-B tables: tenants /
// workspaces / workspace_databases / saga). The governance migrations were never
// applied to `in_falcone` (the planning note `required-migrations.txt` listed them but
// nothing consumed it), so every governance read/write hit a missing relation and
// 500'd with PostgreSQL 42P01. This module applies that governance migration set at
// boot so the actions resolve.
//
// Ordering is dependency-safe (and numeric): 080 (pg_capture_configs + pg_capture_quotas +
// pg_capture_audit_log — read by realtime/pg-capture-list; standalone, intra-file FKs only)
// → 093 (scope_enforcement_denials, standalone)
// → 097 (defines set_updated_at_timestamp() + plans, the prerequisites for the rest)
// → 098 (creates AND seeds quota_dimension_catalog, before 103/105 FK it)
// → 100 (tenant_plan_change_history) → 103 (quota_overrides) → 104 (boolean_capability_catalog)
// → 105 (workspace_sub_quotas) → 114 (deployment_profile_registry + backup_scope_entries;
// uses set_updated_at_timestamp() from 097 and seeds boolean_capability_catalog from 104, so
// it must come after both) → 121 (seeds the flow quota dimensions). Every file is
// `CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING`, so re-running boot is a
// no-op (idempotent). The whole `services/provisioning-orchestrator` tree (including these
// .sql files) is COPYed into the image under /repo by deploy/kind/control-plane/Dockerfile.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const GOVERNANCE_MIGRATIONS = [
  'services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql',
  'services/provisioning-orchestrator/src/migrations/093-scope-enforcement.sql',
  'services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql',
  'services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql',
  'services/provisioning-orchestrator/src/migrations/100-plan-change-impact-history.sql',
  'services/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql',
  'services/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql',
  'services/provisioning-orchestrator/src/migrations/105-effective-limit-resolution.sql',
  'services/provisioning-orchestrator/src/migrations/114-backup-scope-deployment-profiles.sql',
  'services/provisioning-orchestrator/src/migrations/121-flow-quota-dimensions.sql',
];

// The control-plane action modules resolve under /repo in the image; allow override
// (REPO_ROOT) so the same code path is exercisable from a checkout.
const DEFAULT_REPO_ROOT = process.env.REPO_ROOT || '/repo';

/**
 * Return only the forward (`-- up`) portion of a migration file. Some migrations carry a
 * `-- down` rollback section after the forward DDL (e.g. 080-pg-capture-config: CREATE … then
 * DROP TABLE …). This applier runs the file as a single multi-statement query, so without
 * stripping the rollback it would create the tables and then immediately drop them — leaving the
 * relations absent and the boot still "succeeding" (DROP IF EXISTS does not error). Split on a
 * line that is exactly `-- down` (case-insensitive); files without one are returned unchanged.
 * @param {string} sql
 * @returns {string}
 */
export function forwardMigration(sql) {
  return String(sql).split(/^[ \t]*--[ \t]*down[ \t]*$/im)[0];
}

/**
 * Apply the governance migration set (in order) to the in_falcone database.
 * Idempotent. Injectable I/O for tests.
 *
 * @param {{query:(sql:string)=>Promise<any>}} pool  control-plane Postgres pool
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]                    where the /repo tree lives
 * @param {(p:string,enc:string)=>Promise<string>} [opts.read]  file reader
 * @param {{log:Function}} [opts.log]                 logger
 * @returns {Promise<string[]>}  the migration paths applied, in order
 */
export async function applyGovernanceSchema(pool, opts = {}) {
  const { repoRoot = DEFAULT_REPO_ROOT, read = readFile, log = console } = opts;
  const applied = [];
  for (const rel of GOVERNANCE_MIGRATIONS) {
    const sql = await read(resolve(repoRoot, rel), 'utf8');
    await pool.query(forwardMigration(sql));
    applied.push(rel);
  }
  log.log?.(`[control-plane] governance schema ready (${applied.length} migrations)`);
  return applied;
}
