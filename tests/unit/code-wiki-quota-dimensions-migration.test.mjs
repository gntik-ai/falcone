import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GOVERNANCE_MIGRATIONS } from '../../apps/control-plane/governance-schema.mjs';

const path = 'packages/provisioning-orchestrator/src/migrations/125-code-wiki-quota-dimensions.sql';
test('migration 125 only seeds the six product dimensions idempotently, immediately after 124', async () => {
  const sql = (await readFile(new URL(`../../${path}`, import.meta.url), 'utf8')).replace(/--[^\n]*/g, '').trim();
  assert.match(sql, /^INSERT INTO quota_dimension_catalog\s*\(dimension_key, display_label, unit, default_value, description\)\s*VALUES/);
  assert.match(sql, /ON CONFLICT \(dimension_key\) DO NOTHING;$/);
  assert.equal(sql.split(';').filter(s => s.trim()).length, 1, 'seed-only statement cannot alter existing rows or constraints');
  const rows = [...sql.matchAll(/\('([^']+)',\s*'[^']+',\s*'(count|bytes)',\s*(\d+),\s*'[^']+'\)/g)]
    .map(([, key, unit, value]) => [key, unit, Number(value)]);
  assert.deepEqual(rows, [
    ['codewiki_max_projects', 'count', 3],
    ['codewiki_max_concurrent_runs', 'count', 1],
    ['codewiki_max_queued_runs', 'count', 5],
    ['codewiki_max_indexed_repositories', 'count', 3],
    ['codewiki_max_wiki_pages', 'count', 500],
    ['codewiki_max_repository_bytes', 'bytes', 524288000],
  ]);
  assert.equal(GOVERNANCE_MIGRATIONS[GOVERNANCE_MIGRATIONS.indexOf(path) - 1], 'packages/provisioning-orchestrator/src/migrations/124-http-idempotency.sql');
  assert.equal(GOVERNANCE_MIGRATIONS.filter(item => item === path).length, 1);
});

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node 20 CI lacks SQLite. */ }
test('running the seed twice preserves existing catalog values and inserts missing rows once', {
  skip: !DatabaseSync && 'SQLite unavailable; real PostgreSQL migration verification runs in CI',
}, async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE quota_dimension_catalog (dimension_key TEXT PRIMARY KEY, display_label TEXT, unit TEXT, default_value INTEGER, description TEXT);
      INSERT INTO quota_dimension_catalog VALUES ('max_workspaces', 'Existing', 'count', 17, 'unchanged'),
        ('codewiki_max_projects', 'Custom', 'count', 19, 'preserve');`);
    const sql = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    db.exec(sql);
    const read = () => db.prepare('SELECT * FROM quota_dimension_catalog ORDER BY dimension_key').all().map(row => ({ ...row }));
    const first = read();
    assert.equal(first.length, 7);
    assert.equal(first.find(row => row.dimension_key === 'max_workspaces').default_value, 17);
    assert.equal(first.find(row => row.dimension_key === 'codewiki_max_projects').default_value, 19);
    db.exec(sql);
    assert.deepEqual(read(), first);
  } finally { db.close(); }
});
