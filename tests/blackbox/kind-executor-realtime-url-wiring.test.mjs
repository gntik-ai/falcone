/**
 * Black-box regression suite for spec change fix-kind-executor-realtime-url
 * (live E2E campaign, GitHub issue #621).
 *
 * Parses the deploy manifests as data (no execution, no cluster) and asserts that the executor
 * the kind install actually deploys (deploy/kind/executor-demo.yaml) wires the realtime CDC
 * connection — REALTIME_DOCUMENTDB_URL — the SAME way the campaign Helm values do. Without it the
 * realtime executor never activates (createRealtimeExecutor is gated on REALTIME_DOCUMENTDB_URL),
 * so /v1/realtime/* returns 501 REALTIME_DISABLED on the primary kind dev/eval path.
 *
 * Scenario coverage (capability: deployment / spec.md):
 *   bbx-621-01  the demo-manifest executor sets REALTIME_DOCUMENTDB_URL from the replication secret
 *   bbx-621-02  the secretKeyRef is `optional: true` (executor still starts when absent)
 *   bbx-621-03  the demo manifest agrees with the controlPlaneExecutor stanza in values-campaign.yaml
 *   bbx-621-04  no regression: the executor still wires the document API (MONGO_*) + Kafka
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const REPLICATION_SECRET = 'in-falcone-documentdb-replication';
const REALTIME_KEY = 'realtime-url';

/** Parse a multi-doc kube manifest into plain JS objects. */
function loadDocs(rel) {
  return parseAllDocuments(read(rel)).map((d) => d.toJS()).filter(Boolean);
}

/** The falcone-cp-executor Deployment's first container env, as an array of {name,value?,valueFrom?}. */
function executorEnvFromDemo() {
  const docs = loadDocs('deploy/kind/executor-demo.yaml');
  const dep = docs.find(
    (d) => d?.kind === 'Deployment' && d?.metadata?.name === 'falcone-cp-executor',
  );
  assert.ok(dep, 'falcone-cp-executor Deployment must exist in executor-demo.yaml');
  const env = dep.spec.template.spec.containers[0].env;
  assert.ok(Array.isArray(env), 'executor container must declare an env array');
  return env;
}

const byName = (env, name) => env.find((e) => e.name === name);

test('bbx-621-01 demo executor sets REALTIME_DOCUMENTDB_URL from the replication secret', () => {
  const env = executorEnvFromDemo();
  const rt = byName(env, 'REALTIME_DOCUMENTDB_URL');
  assert.ok(rt, 'executor-demo.yaml must set REALTIME_DOCUMENTDB_URL (else realtime is 501 DISABLED)');
  assert.equal(rt.valueFrom?.secretKeyRef?.name, REPLICATION_SECRET);
  assert.equal(rt.valueFrom?.secretKeyRef?.key, REALTIME_KEY);
});

test('bbx-621-02 the REALTIME_DOCUMENTDB_URL secretKeyRef is optional', () => {
  const rt = byName(executorEnvFromDemo(), 'REALTIME_DOCUMENTDB_URL');
  assert.equal(
    rt.valueFrom.secretKeyRef.optional,
    true,
    'optional:true lets the executor still start (realtime disabled) when the secret/key is absent',
  );
});

test('bbx-621-03 the demo manifest agrees with the campaign Helm values', () => {
  const demo = byName(executorEnvFromDemo(), 'REALTIME_DOCUMENTDB_URL');

  // The controlPlane.env stanza in the campaign values is a list of the same {name,valueFrom} shape.
  const valuesDocs = loadDocs('tests/live-campaign/values-campaign.yaml');
  const values = valuesDocs[0];
  const cpeEnv = values?.controlPlane?.env;
  assert.ok(Array.isArray(cpeEnv), 'values-campaign.yaml must define controlPlane.env');
  const fromValues = cpeEnv.find((e) => e.name === 'REALTIME_DOCUMENTDB_URL');
  assert.ok(fromValues, 'campaign values must also wire REALTIME_DOCUMENTDB_URL');

  // Both definitions must source the realtime URL identically — no drift between the two executors.
  assert.equal(demo.valueFrom.secretKeyRef.name, fromValues.valueFrom.secretKeyRef.name);
  assert.equal(demo.valueFrom.secretKeyRef.key, fromValues.valueFrom.secretKeyRef.key);
  assert.equal(
    Boolean(demo.valueFrom.secretKeyRef.optional),
    Boolean(fromValues.valueFrom.secretKeyRef.optional),
  );
});

test('bbx-621-04 no regression: document API + Kafka env preserved on the executor', () => {
  const env = executorEnvFromDemo();
  for (const name of ['MONGO_HOST', 'MONGO_USER', 'MONGO_PASSWORD', 'KAFKA_BROKERS']) {
    assert.ok(byName(env, name), `executor must still set ${name}`);
  }
});
