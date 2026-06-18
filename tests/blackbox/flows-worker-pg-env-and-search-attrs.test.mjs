/**
 * Black-box tests for fix-flows-worker-pg-env-and-search-attrs (P1, live E2E re-run
 * 2026-06-18 BUG-WORKER-PG-ENV + BUG-TEMPORAL-SEARCH-ATTRS).
 *
 * Defects:
 *   - the workflow-worker deployment carried only TEMPORAL_* env, so the db.query
 *     activity's DSN fell back to localhost/falcone_app → UPSTREAM_UNAVAILABLE;
 *   - `temporal server start-dev` never registered the 5 custom search attributes, so
 *     the flow concurrency pre-flight (workflow.list filtered by them) 500'd.
 *
 * Fix: the worker deployment carries PG env (PGDATABASE=in_falcone so the
 * workspace_databases registry resolves), and the advanced-caps bring-up registers the
 * 5 search attributes against the dev Temporal.
 *
 * Drives the public buildDataDsn + static assertions on the campaign bring-up manifest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDataDsn } from '../../services/workflow-worker/src/worker-deps.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const advancedCaps = readFileSync(resolve(REPO_ROOT, 'tests/live-campaign/advanced-caps.sh'), 'utf8');
const SEARCH_ATTRS = ['tenantId', 'workspaceId', 'flowId', 'flowVersion', 'triggerType'];

test('bbx-worker-pg-01: buildDataDsn uses the supplied PG env (not the localhost fallback)', () => {
  const dsn = buildDataDsn({ PGHOST: 'falcone-postgresql', PGPORT: '5432', PGUSER: 'falcone', PGPASSWORD: 'secret', PGDATABASE: 'in_falcone' });
  assert.match(dsn, /falcone-postgresql:5432\/in_falcone/, `unexpected DSN: ${dsn}`);
  assert.ok(!dsn.includes('localhost'), 'must not fall back to localhost when env is provided');
});

test('bbx-worker-pg-02: with NO PG env, buildDataDsn falls back (the broken default)', () => {
  const dsn = buildDataDsn({});
  // Documents the failure mode the worker hit when its deployment carried no PG env.
  assert.match(dsn, /localhost/, 'no-env default is localhost (why the worker needs explicit PG env)');
});

test('bbx-worker-pg-03: the campaign worker deployment carries PG env incl. PGDATABASE=in_falcone', () => {
  for (const v of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
    assert.ok(advancedCaps.includes(v), `advanced-caps.sh worker must set ${v}`);
  }
  assert.match(advancedCaps, /PGDATABASE, value: "in_falcone"/, 'worker PGDATABASE must be in_falcone (registry DB)');
  assert.match(advancedCaps, /secretKeyRef: \{ name: in-falcone-postgresql/, 'PGPASSWORD must come from the postgres Secret');
});

test('bbx-worker-pg-04: advanced-caps registers all 5 Temporal search attributes', () => {
  assert.match(advancedCaps, /search-attribute create/, 'must register search attributes');
  for (const sa of SEARCH_ATTRS) {
    assert.ok(advancedCaps.includes(sa), `search attribute ${sa} must be registered`);
  }
});
