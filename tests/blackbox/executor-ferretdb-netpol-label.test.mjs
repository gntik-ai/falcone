/**
 * Black-box manifest-contract suite for the Helm-owned executor NetworkPolicy label contract.
 *
 * The executor pod must carry `app.kubernetes.io/name: control-plane-executor`, and datastore
 * NetworkPolicies must allow that component. The test renders the actual kind install path rather
 * than the legacy executor-demo manifest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML, { parseAllDocuments } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const KIND_VALUES = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind.yaml');
const NETPOL_COMPONENT = 'control-plane-executor';

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

function chartValues() {
  return YAML.parse(readFileSync(resolve(REPO_ROOT, 'charts/in-falcone/values.yaml'), 'utf8'));
}

function executorDeployment() {
  const dep = renderDocs().find(
    (d) => d && d.kind === 'Deployment' && d.metadata?.name === 'falcone-control-plane-executor',
  );
  assert.ok(dep, 'Helm must render the falcone-control-plane-executor Deployment');
  return dep;
}

test('bbx-559-01: executor pod template carries the NetworkPolicy component label', SKIP, () => {
  const labels = executorDeployment().spec.template.metadata.labels ?? {};
  assert.equal(
    labels['app.kubernetes.io/name'],
    NETPOL_COMPONENT,
    'executor pod must be labelled app.kubernetes.io/name: control-plane-executor so datastore NetworkPolicies admit it',
  );
});

test('bbx-559-02: FerretDB NetworkPolicy admits the executor component', () => {
  const allowed = chartValues().ferretdb?.networkPolicy?.allowedAppComponents ?? [];
  assert.ok(
    allowed.includes(NETPOL_COMPONENT),
    `ferretdb.networkPolicy.allowedAppComponents must include "${NETPOL_COMPONENT}" (got ${JSON.stringify(allowed)})`,
  );
});

test('bbx-559-03: SeaweedFS NetworkPolicy admits the executor component', () => {
  const allowed = chartValues().seaweedfs?.networkPolicy?.allowedAppComponents ?? [];
  assert.ok(
    allowed.includes(NETPOL_COMPONENT),
    `seaweedfs.networkPolicy.allowedAppComponents must include "${NETPOL_COMPONENT}" (got ${JSON.stringify(allowed)})`,
  );
});

test('bbx-559-04: executor Service selector label is preserved', SKIP, () => {
  const docs = renderDocs();
  const labels = executorDeployment().spec.template.metadata.labels ?? {};
  const svc = docs.find((d) => d && d.kind === 'Service' && d.metadata?.name === 'falcone-control-plane-executor');
  assert.ok(svc, 'executor Service must exist');
  for (const [k, v] of Object.entries(svc.spec.selector)) {
    assert.equal(labels[k], v, `pod must still carry the Service selector label ${k}=${v}`);
  }
});
