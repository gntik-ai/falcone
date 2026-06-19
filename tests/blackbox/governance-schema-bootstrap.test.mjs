/**
 * Black-box tests for the kind control-plane governance schema bootstrap
 * (fix-governance-schema-bootstrap, #555 BUG-GOV-SCHEMA, P1).
 *
 * The bug: the governance routes (capability-catalog, plan-assign, scope-enforcement
 * audit, quota dimensions / effective-limits) dispatch to the REAL product actions,
 * but the tables those actions query were never created in `in_falcone` — the kind
 * boot only ran `ensureSchema` (domain-B tables) and nothing applied the
 * provisioning-orchestrator governance migrations. So:
 *   GET /v1/capability-catalog            → 500 (boolean_capability_catalog missing)
 *   POST /v1/tenants/{id}/plan            → 500 (tenant_plan_change_history missing)
 *   GET …/scope-enforcement/audit         → 500 (scope_enforcement_denials missing)
 *   quota_dimension_catalog               → empty (limits can't be defined)
 *
 * The fix: `applyGovernanceSchema(pool)` applies the governance migration set at boot.
 * This drives that function with a recording pool over the REAL migration .sql files,
 * asserting (a) all four governance objects are created/seeded and (b) the application
 * order is dependency-safe. The live 200-vs-500 proof is in the consolidated kind run.
 *
 * bbx-555-01: applies every governance migration, in declared order
 * bbx-555-02: creates the three missing tables + the quota dimension catalog
 * bbx-555-03: seeds the dimension + capability catalogs idempotently (ON CONFLICT)
 * bbx-555-04: ordering is dependency-safe (function definer + FK targets precede users)
 *
 * fix-backup-scope-schema (#595, P1): the same bootstrap omitted migration 114, so
 * GET /v1/admin/backup/scope and /v1/tenants/{id}/backup/scope 500'd with 42P01
 * (deployment_profile_registry / backup_scope_entries undefined). The fix adds 114 to
 * the governance migration set, after 104 (whose boolean_capability_catalog 114 seeds)
 * and 097 (whose set_updated_at_timestamp() its triggers use).
 *
 * bbx-595-01: bootstrap creates the backup-scope tables (deployment_profile_registry + backup_scope_entries)
 * bbx-595-02: 114 is ordered after 097 (function) and 104 (capability catalog it seeds)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOVERNANCE_MIGRATIONS, applyGovernanceSchema } from '../../deploy/kind/control-plane/governance-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// A pool that records the SQL it would execute; reads the real migration files.
async function runBootstrap() {
  const executed = [];
  const pool = { query: async (sql) => { executed.push(sql); return { rows: [] }; } };
  const applied = await applyGovernanceSchema(pool, { repoRoot: REPO_ROOT, log: { log() {} } });
  return { applied, executed, all: executed.join('\n;\n') };
}

test('bbx-555-01: applies every governance migration in declared order', async () => {
  const { applied, executed } = await runBootstrap();
  assert.deepEqual(applied, GOVERNANCE_MIGRATIONS, 'all governance migrations applied, in order');
  assert.equal(executed.length, GOVERNANCE_MIGRATIONS.length, 'one query per migration file');
});

test('bbx-555-02: creates the three missing tables + the quota dimension catalog', async () => {
  const { all } = await runBootstrap();
  for (const table of [
    'boolean_capability_catalog',   // capability-catalog 500
    'tenant_plan_change_history',   // plan-assign 500
    'scope_enforcement_denials',    // scope-enforcement audit 500
    'quota_dimension_catalog',      // limits can't be defined when empty
  ]) {
    assert.match(all, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`), `must create ${table}`);
  }
});

test('bbx-555-03: seeds the dimension + capability catalogs idempotently', async () => {
  const { all } = await runBootstrap();
  assert.match(all, /INSERT INTO quota_dimension_catalog[\s\S]*?ON CONFLICT[\s\S]*?DO NOTHING/i, 'seed quota dimensions, idempotent');
  assert.match(all, /INSERT INTO boolean_capability_catalog[\s\S]*?ON CONFLICT[\s\S]*?DO NOTHING/i, 'seed boolean capabilities, idempotent');
});

test('bbx-555-04: application order is dependency-safe', async () => {
  const idx = (frag) => GOVERNANCE_MIGRATIONS.findIndex((m) => m.includes(frag));
  // 097 defines set_updated_at_timestamp() + plans, used by 098/104/105.
  assert.ok(idx('097-') < idx('098-'), '097 (function/plans) before 098');
  assert.ok(idx('097-') < idx('104-'), '097 before 104');
  assert.ok(idx('097-') < idx('105-'), '097 before 105');
  // 098 creates quota_dimension_catalog, FK'd by 103 and 105.
  assert.ok(idx('098-') < idx('103-'), '098 (dimension catalog) before 103');
  assert.ok(idx('098-') < idx('105-'), '098 before 105');
});

test('bbx-595-01: bootstrap creates the backup-scope tables', async () => {
  const { applied, all } = await runBootstrap();
  assert.ok(
    applied.some((m) => m.includes('114-backup-scope-deployment-profiles')),
    'migration 114 (backup-scope) is applied at boot',
  );
  for (const table of ['deployment_profile_registry', 'backup_scope_entries']) {
    assert.match(all, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`), `must create ${table}`);
  }
});

test('bbx-595-02: 114 is ordered after its prerequisites (097 function, 104 capability catalog)', async () => {
  const idx = (frag) => GOVERNANCE_MIGRATIONS.findIndex((m) => m.includes(frag));
  // 114's triggers call set_updated_at_timestamp() (defined in 097) and it seeds
  // boolean_capability_catalog (created in 104) → both must precede 114.
  assert.ok(idx('114-') > -1, '114 is in the governance set');
  assert.ok(idx('097-') < idx('114-'), '097 (set_updated_at_timestamp) before 114');
  assert.ok(idx('104-') < idx('114-'), '104 (boolean_capability_catalog) before 114');
});
