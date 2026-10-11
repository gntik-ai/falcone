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
 * Source coverage: the public buildDataDsn seam, with explicit PG env and its fallback.
 *
 * Former subtests 03 and 04 are removed because tests/live-campaign/advanced-caps.sh
 * is untracked and gitignored. Deployment assertions belong in falcone-charts:
 *   - tests/workflow-worker-pg-env-chart.test.mjs owns the workflowWorker env in
 *     charts/in-falcone/values.yaml (the executor deployment is not the worker);
 *   - tests/blackbox/temporal-bootstrap/temporal-bootstrap-readiness-contract.test.mjs
 *     already owns registration of the five Temporal search attributes.
 * Source CI must not depend on the campaign script or a sibling deployment checkout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDataDsn } from '../../apps/workflow-worker/src/worker-deps.mjs';

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
