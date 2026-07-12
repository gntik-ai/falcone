/**
 * Black-box regression suite for executor realtime URL wiring.
 *
 * The kind install now deploys the control-plane executor through Helm, not
 * deploy/kind/executor-demo.yaml. Render the chart with the kind overlay and assert the
 * Helm-owned executor carries the realtime CDC URL, document API, and Kafka env.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const KIND_VALUES = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind.yaml');

const REPLICATION_SECRET = 'in-falcone-documentdb-replication';
const REALTIME_KEY = 'realtime-url';

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function renderDocs() {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, '-f', KIND_VALUES], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return parseAllDocuments(r.stdout).map((d) => d.toJS()).filter(Boolean);
}

function executorEnv() {
  const dep = renderDocs().find(
    (d) => d?.kind === 'Deployment' && d?.metadata?.name === 'falcone-control-plane-executor',
  );
  assert.ok(dep, 'Helm must render the falcone-control-plane-executor Deployment');
  const env = dep.spec.template.spec.containers[0].env;
  assert.ok(Array.isArray(env), 'executor container must declare an env array');
  return env;
}

const byName = (env, name) => env.find((e) => e.name === name);

test('bbx-621-01 Helm executor sets REALTIME_DOCUMENTDB_URL from the replication secret', SKIP, () => {
  const rt = byName(executorEnv(), 'REALTIME_DOCUMENTDB_URL');
  assert.ok(rt, 'Helm executor must set REALTIME_DOCUMENTDB_URL, else realtime stays disabled');
  assert.equal(rt.valueFrom?.secretKeyRef?.name, REPLICATION_SECRET);
  assert.equal(rt.valueFrom?.secretKeyRef?.key, REALTIME_KEY);
});

test('bbx-621-02 the REALTIME_DOCUMENTDB_URL secretKeyRef is optional', SKIP, () => {
  const rt = byName(executorEnv(), 'REALTIME_DOCUMENTDB_URL');
  assert.equal(
    rt.valueFrom.secretKeyRef.optional,
    true,
    'optional:true lets the executor start while realtime remains disabled if the key is absent',
  );
});

test('bbx-621-03 no regression: document API + Kafka env are preserved on the Helm executor', SKIP, () => {
  const env = executorEnv();
  for (const name of ['MONGO_HOST', 'MONGO_USER', 'MONGO_PASSWORD', 'KAFKA_BROKERS']) {
    assert.ok(byName(env, name), `executor must still set ${name}`);
  }
});
