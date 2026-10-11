import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../../apps/control-plane/tenant-store.mjs';

// Scan SQL and embedded ensureSchema DDL. Balance parentheses so types and FK
// clauses cannot truncate a CREATE TABLE before a later tenant_id column.
function tenantTables(source) {
  const sql = source.replace(/\/\*[\s\S]*?\*\/|--[^\n]*|\/\/[^\n]*/g, '');
  const tables = [];
  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi;
  for (const match of sql.matchAll(create)) {
    let end = match.index + match[0].length;
    const start = end;
    let depth = 1;
    for (; end < sql.length && depth; end++) {
      if (sql[end] === '(') depth++;
      if (sql[end] === ')') depth--;
    }
    if (/(?:^|,)\s*"?tenant_id"?\s+\w+/i.test(sql.slice(start, end - 1))) {
      tables.push(match[1].replaceAll('"', ''));
    }
  }
  return tables;
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'tests', '__tests__', 'dist'].includes(entry.name) ? [] : files(path);
    return /\.(?:sql|mjs|js|ts)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : [];
  });
}

function assertCovered(tables) {
  const covered = new Set([
    ...(store.TENANT_PURGE_TABLES ?? []),
    ...Object.keys(store.TENANT_PURGE_RETAINED_TABLES ?? {}),
  ]);
  assert.deepEqual([...new Set(tables)].filter((table) => !covered.has(table)).sort(), [],
    'tenant-derived tables must be purged or explicitly retained as audit trail');
}

const sources = [
  ...files(new URL('../../packages/', import.meta.url).pathname).filter((path) => path.includes('/migrations/')),
  ...files(new URL('../../apps/', import.meta.url).pathname),
];

test('every tenant_id-keyed source schema table is covered by the purge or audit-retention policy', () => {
  const discovered = sources.flatMap((path) => tenantTables(readFileSync(path, 'utf8')));
  assert.ok(discovered.includes('workspace_sub_quotas'));
  assert.ok(discovered.includes('flow_versions'));
  assert.ok(discovered.includes('scheduled_executions'));
  assert.ok(discovered.includes('backup_operations'));
  assertCovered(discovered);
});

test('a newly seeded tenant-derived schema table fails the completeness guard', () => {
  const negative = 'CREATE TABLE purge_guard_negative_fixture (id VARCHAR(255), tenant_id TEXT NOT NULL);';
  assert.throws(() => assertCovered(tenantTables(negative)), /purge_guard_negative_fixture/);
});

test('audit tables have explicit retention reasons and plan-change history is purged', () => {
  assert.ok(store.TENANT_PURGE_RETAINED_TABLES);
  assert.ok(Object.keys(store.TENANT_PURGE_RETAINED_TABLES).length > 0);
  for (const [table, reason] of Object.entries(store.TENANT_PURGE_RETAINED_TABLES)) {
    assert.match(reason, /audit/i, `${table} must retain only audit trail`);
    assert.ok(!store.TENANT_PURGE_TABLES.includes(table));
  }
  assert.ok(store.TENANT_PURGE_TABLES.includes('tenant_plan_change_history'));
  assert.equal(store.TENANT_PURGE_RETAINED_TABLES.tenant_plan_change_history, undefined);
});


// Mirrors the tenant-keyed tables defined only in the deployment repository.
// Sources: 20260328-002-quota-threshold-alert-posture-store.sql and
// 20260327-001-function-audit-records.sql under charts/in-falcone/bootstrap/migrations.
// This inventory lets the source-only guard enforce their explicit policy too.
test('deployment-only tenant tables have an explicit mirrored purge/retention policy', () => {
  const mirrored = `
    CREATE TABLE quota_last_known_posture (tenant_id TEXT NOT NULL);
    CREATE TABLE function_audit_records (tenant_id TEXT NOT NULL);
  `;
  assertCovered(tenantTables(mirrored));
  assert.ok(store.TENANT_PURGE_TABLES.includes('quota_last_known_posture'));
  assert.match(store.TENANT_PURGE_RETAINED_TABLES.function_audit_records, /audit/i);
});
