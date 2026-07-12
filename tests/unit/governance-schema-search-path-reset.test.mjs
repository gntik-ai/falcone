/**
 * Regression tests for issue #872.
 *
 * The kind control-plane boot applies GOVERNANCE_MIGRATIONS in order on a shared pooled
 * connection (governance-schema.mjs::applyGovernanceSchema). 087-workspace-doc-notes.sql does
 * `SET search_path TO workspace_docs_service` and never restores it, so the NEXT migration
 * (114-backup-scope-deployment-profiles.sql) resolved its unqualified `set_updated_at_timestamp()`
 * against workspace_docs_service instead of public and boot died with
 * "function set_updated_at_timestamp() does not exist" -> schema/recovery permanently fails ->
 * process.exit(1) -> CrashLoopBackOff.
 *
 * The fix resets search_path before every migration, on the SAME connection as the migration
 * (one query call), so no migration can leak its search_path to the next. These live in
 * tests/unit so CI's `pnpm test:unit` runs the acceptance guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GOVERNANCE_MIGRATIONS,
  applyGovernanceSchema,
} from '../../apps/control-plane/governance-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

/** Run the real applier with a fake pool that records the exact SQL string of each query. */
async function runBootstrap() {
  const executed = [];
  const pool = {
    async query(sql) {
      executed.push(String(sql));
      return { rows: [] };
    },
  };
  const applied = await applyGovernanceSchema(pool, { repoRoot: REPO_ROOT, log: { log() {} } });
  return { applied, executed };
}

test('gov-search-path-01: every migration query is prefixed with a search_path reset on its own connection', async () => {
  const { applied, executed } = await runBootstrap();
  assert.equal(applied.length, GOVERNANCE_MIGRATIONS.length, 'all migrations applied');
  assert.equal(executed.length, GOVERNANCE_MIGRATIONS.length, 'one query per migration (reset is same-connection, not a separate call)');
  for (let i = 0; i < executed.length; i += 1) {
    assert.match(
      executed[i],
      /^\s*RESET\s+search_path\s*;/i,
      `migration ${GOVERNANCE_MIGRATIONS[i]} must start by resetting search_path (leak guard)`,
    );
  }
});

test('gov-search-path-02: 087 sets a workspace_docs_service search_path but it is reset before the next migration (114)', async () => {
  const { executed } = await runBootstrap();
  const i087 = GOVERNANCE_MIGRATIONS.findIndex((m) => m.includes('087-workspace-doc-notes'));
  const i114 = GOVERNANCE_MIGRATIONS.findIndex((m) => m.includes('114-backup-scope-deployment-profiles'));
  assert.ok(i087 >= 0, '087-workspace-doc-notes is in the migration set (packaging regression)');
  assert.ok(i114 > i087, '114 runs after 087 (the leak victim)');
  // 087 legitimately narrows search_path for its own DDL...
  assert.match(executed[i087], /SET\s+search_path\s+TO\s+workspace_docs_service/i, '087 still sets its own schema');
  // ...but 114 must START from a reset, so 087 cannot leak into it.
  assert.match(executed[i114], /^\s*RESET\s+search_path\s*;/i, '114 starts from a clean search_path');
  assert.match(executed[i114], /set_updated_at_timestamp/i, '114 references the shared trigger fn (the one that used to fail)');
});
