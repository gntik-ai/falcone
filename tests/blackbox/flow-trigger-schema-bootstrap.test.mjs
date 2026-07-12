/**
 * Black-box tests for fix-flow-trigger-schema (P1, live E2E re-run 2026-06-18
 * BUG-FLOW-TRIGGER-SCHEMA).
 *
 * Defect: publishing a flow with a platform-event or webhook trigger 502'd with
 * `relation "flow_trigger_registrations" does not exist` (also flow_trigger_secrets).
 * The trigger store's ensureSchema() (which creates those tables) was never invoked at
 * boot — the executor's ensureSchema chain omitted it.
 *
 * Fix: the trigger store is created once and its ensureSchema() runs in the boot chain
 * (when flows are enabled), so the tables exist before any publish.
 *
 * Drives the public createTriggerStore + a static assertion on the boot wiring in main.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTriggerStore } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('bbx-flow-trig-01: trigger-store ensureSchema creates BOTH trigger tables', async () => {
  const sqls = [];
  const pool = { async query(sql) { sqls.push(sql.replace(/\s+/g, ' ')); return { rows: [] }; } };
  const store = createTriggerStore({ pool });
  await store.ensureSchema();
  assert.ok(sqls.some((s) => /create table if not exists flow_trigger_registrations/i.test(s)), 'must create flow_trigger_registrations');
  assert.ok(sqls.some((s) => /create table if not exists flow_trigger_secrets/i.test(s)), 'must create flow_trigger_secrets');
});

test('bbx-flow-trig-02: the executor boot chain invokes the trigger-store ensureSchema', () => {
  // The bug was a missing call: the tables were defined but ensureSchema was never run at
  // boot, so the first publish-with-trigger 502'd. Assert the boot wiring runs it.
  const main = readFileSync(resolve(REPO_ROOT, 'apps/control-plane-executor/src/runtime/main.mjs'), 'utf8');
  assert.match(main, /triggerStore\s*=\s*createTriggerStore\(/, 'a shared trigger store must be created at boot');
  assert.match(main, /triggerStore\.ensureSchema\(\)/, 'the boot ensureSchema chain must invoke triggerStore.ensureSchema()');
});
