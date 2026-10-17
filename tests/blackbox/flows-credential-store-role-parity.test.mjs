import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseAllDocuments } from 'yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chart = process.env.FALCONE_CHART_PATH ?? resolve(root, '../falcone-charts/charts/in-falcone');
function identity(container, executor) {
  const env = new Map((container.env ?? []).map((entry) => [entry.name, entry]));
  const names = executor ? ['CONTROL_DB_URL', 'DATA_DB_URL', 'DB_URL'] : ['WORKER_DATA_DSN', 'DATA_DB_URL', 'DB_URL'];
  for (const name of [...names, 'PGUSER']) {
    const entry = env.get(name);
    if (!entry || (!entry.valueFrom && !entry.value && name !== 'CONTROL_DB_URL')) continue;
    if (entry.valueFrom?.secretKeyRef) return { secretKeyRef: entry.valueFrom.secretKeyRef };
    assert.equal(entry.valueFrom, undefined, `${name} must resolve to a Secret key or a literal`);
    if (name === 'PGUSER') return { literal: entry.value };
    // Compare the database role, never expose DSN passwords in assertion output.
    let user;
    try { user = decodeURIComponent(new URL(entry.value).username); } catch { assert.fail(`${name} has an invalid literal DSN`); }
    assert.ok(user, `${name} must identify its database role`);
    return { literal: user };
  }
  assert.equal((container.envFrom ?? []).length, 0, 'cannot prove role parity from unresolved envFrom');
  return { literal: 'falcone_app' };
}

test('default sibling chart gives the executor and worker the same credential-store database identity', (t) => {
  if (!existsSync(chart)) return t.skip('sibling charts unavailable; set FALCONE_CHART_PATH');
  const rendered = spawnSync('helm', ['template', 'credential-parity', chart], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (rendered.error?.code === 'ENOENT' || rendered.error?.code === 'EPERM') return t.skip(`helm unavailable: ${rendered.error.code}`);
  assert.equal(rendered.status, 0, 'default chart must render');
  const containers = parseAllDocuments(rendered.stdout).flatMap((document) => {
    const resource = document.toJSON();
    if (!['Deployment', 'StatefulSet'].includes(resource?.kind)) return [];
    return resource.spec?.template?.spec?.containers ?? [];
  });
  const executor = containers.filter((c) => c.name === 'control-plane-executor');
  const worker = containers.filter((c) => ['workflow-worker', 'flows-worker'].includes(c.name));
  assert.equal(executor.length, 1, 'exactly one executor must render');
  assert.equal(worker.length, 1, 'exactly one worker must render');
  assert.deepEqual(identity(executor[0], true), identity(worker[0], false));
});
