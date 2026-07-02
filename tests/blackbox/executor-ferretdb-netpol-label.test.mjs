/**
 * Black-box manifest-contract suite for spec change
 * fix-executor-ferretdb-netpol-labels (live E2E campaign 2026-06-18, #559 / BUG-MONGO-NP).
 *
 * Defect: the kind executor Deployment (deploy/kind/executor-demo.yaml) labelled the pod
 * ONLY `app: falcone-cp-executor`, but the FerretDB (and SeaweedFS / Kafka) NetworkPolicies'
 * ingress allowlists match on `app.kubernetes.io/name: <component>` where component is in
 * `<datastore>.networkPolicy.allowedAppComponents` (control-plane / control-plane-executor /
 * workflow-worker). With no matching label, kindnet dropped the executor->FerretDB TCP and
 * every executor mongo CRUD timed out (500). Confirmed live: insert 500 (timeout) until the
 * `app.kubernetes.io/name: control-plane-executor` pod label was added -> 201.
 *
 * Fix: the executor pod template carries `app.kubernetes.io/name: control-plane-executor`,
 * which MUST be an allowed component on every datastore NetworkPolicy the executor depends on.
 * These two sides of the contract are asserted against the public deploy artifacts (the plain
 * kind manifest + the chart values), so a regression on either side fails deterministically
 * without needing a live cluster or helm.
 *
 * Scenario coverage (capability: control-plane-runtime):
 *   bbx-559-01  executor pod template carries app.kubernetes.io/name: control-plane-executor
 *   bbx-559-02  that component is allowed by the FerretDB NetworkPolicy ingress (values)
 *   bbx-559-03  ... and by the SeaweedFS NetworkPolicy ingress (executor also reaches S3)
 *   bbx-559-04  the Service selector (`app`) is preserved so the executor stays addressable
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const NETPOL_COMPONENT = 'control-plane-executor';

function manifestDocs() {
  const txt = readFileSync(resolve(REPO_ROOT, 'deploy/kind/executor-demo.yaml'), 'utf8');
  return YAML.parseAllDocuments(txt).map((d) => d.toJS());
}
function chartValues() {
  return YAML.parse(readFileSync(resolve(REPO_ROOT, 'charts/in-falcone/values.yaml'), 'utf8'));
}
function executorDeployment() {
  const dep = manifestDocs().find(
    (d) => d && d.kind === 'Deployment' && d.metadata?.name === 'falcone-cp-executor',
  );
  assert.ok(dep, 'deploy/kind/executor-demo.yaml must define the falcone-cp-executor Deployment');
  return dep;
}

test('bbx-559-01: executor pod template carries the NetworkPolicy component label', () => {
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

test('bbx-559-04: executor Service selector label is preserved (still addressable)', () => {
  const labels = executorDeployment().spec.template.metadata.labels ?? {};
  const svc = manifestDocs().find(
    (d) => d && d.kind === 'Service' && d.metadata?.name === 'falcone-cp-executor',
  );
  assert.ok(svc, 'executor Service must exist');
  for (const [k, v] of Object.entries(svc.spec.selector)) {
    assert.equal(labels[k], v, `pod must still carry the Service selector label ${k}=${v}`);
  }
});
