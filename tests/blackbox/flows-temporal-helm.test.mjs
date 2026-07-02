/**
 * Black-box test suite for spec change add-flows-temporal-helm.
 *
 * Drives the PUBLIC chart surface ONLY via `helm template` / `helm lint` as a child
 * process. No internal knowledge of the Go templates is used — assertions inspect exit
 * codes and the rendered YAML stream (parsed defensively, document by document).
 *
 * The suite runs in CI where `helm` may be absent; every test self-skips (t.skip) when
 * the `helm` binary is not on PATH (repo precedent: pgvector real-stack tests self-skip).
 *
 * Scenario coverage (capability: workflows / spec.md):
 *   bbx-flows-helm-001  Temporal disabled by default → zero Temporal resources
 *   bbx-flows-helm-002  Temporal enabled → four role Deployments (frontend/history/matching/worker)
 *   bbx-flows-helm-003  ClusterIP-only Services (no LoadBalancer / NodePort)
 *   bbx-flows-helm-004  SQL visibility, no Elasticsearch pod/Service
 *   bbx-flows-helm-005  schema-tool Job (pre-install/pre-upgrade) renders
 *   bbx-flows-helm-006  bootstrap Job registers default namespace + five Keyword search attributes
 *   bbx-flows-helm-007  NetworkPolicy with flows-api / flows-worker label contract on port 7233
 *   bbx-flows-helm-008  runAsNonRoot + RuntimeDefault on every Temporal pod spec
 *   bbx-flows-helm-009  no numeric fsGroup under the OpenShift overlay
 *   bbx-flows-helm-010  no Ingress / Route / APISIX route for Temporal; Web UI present
 *   bbx-flows-helm-011  resource requests/limits present on every Temporal role Deployment
 *   bbx-flows-helm-012  helm lint exits 0 with temporal block present
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const OPENSHIFT_VALUES = resolve(REPO_ROOT, 'deploy', 'openshift', 'values-openshift.yaml');

function helmAvailable() {
  const r = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' });
  return r.status === 0;
}
const HELM = helmAvailable();
const SKIP = HELM ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(extraArgs = []) {
  return spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function helmLint(extraArgs = []) {
  return spawnSync('helm', ['lint', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Split a multi-doc YAML stream into individual non-empty documents.
 * Defensive: ignores comment-only / whitespace-only docs and the trailing separator.
 */
function splitDocs(stream) {
  return String(stream || '')
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && /(^|\n)kind:\s*\S/.test(d));
}

/** Crude per-document kind/name extractors (regex only; no YAML lib dependency). */
function docKind(doc) {
  const m = doc.match(/(?:^|\n)kind:\s*(\S+)/);
  return m ? m[1] : '';
}
function docName(doc) {
  // first metadata.name occurrence
  const m = doc.match(/(?:^|\n)metadata:\s*\n(?:\s+\S.*\n)*?\s+name:\s*(\S+)/);
  if (m) return m[1];
  const m2 = doc.match(/(?:^|\n)\s+name:\s*(\S+)/);
  return m2 ? m2[1] : '';
}

/** All Temporal docs are tagged with this component family label. */
function isTemporalDoc(doc) {
  return /app\.kubernetes\.io\/part-of:\s*temporal/.test(doc) ||
    /in-falcone\.io\/component:\s*temporal/.test(doc) ||
    /\btemporal\b/.test(docName(doc));
}

function renderEnabled(extra = []) {
  const r = helmTemplate(['--set', 'temporal.enabled=true', ...extra]);
  return r;
}

// -------------------------------------------------------------------------
// bbx-flows-helm-001: Temporal disabled by default → zero Temporal resources
// -------------------------------------------------------------------------
test('bbx-flows-helm-001: default values render zero Temporal resources', SKIP, () => {
  const r = helmTemplate();
  assert.equal(r.status, 0, `helm template (defaults) must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const temporalDocs = docs.filter((d) =>
    /app\.kubernetes\.io\/part-of:\s*temporal/.test(d) ||
    /in-falcone\.io\/component:\s*temporal/.test(d) ||
    /-temporal-/.test(docName(d)) ||
    /-temporal\b/.test(docName(d)));
  assert.equal(
    temporalDocs.length,
    0,
    `expected no Temporal resources with default values, found:\n${temporalDocs.map(docName).join('\n')}`
  );
});

// -------------------------------------------------------------------------
// bbx-flows-helm-002: enabled → four role Deployments
// -------------------------------------------------------------------------
test('bbx-flows-helm-002: temporal.enabled=true renders four role Deployments', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template (enabled) must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const deployments = docs.filter((d) => docKind(d) === 'Deployment' && isTemporalDoc(d));
  const names = deployments.map(docName).join(' ');
  for (const role of ['frontend', 'history', 'matching', 'worker']) {
    assert.match(
      names,
      new RegExp(`temporal-${role}\\b`),
      `expected a Temporal ${role} Deployment, got: ${names}`
    );
  }
  // exactly four ROLE deployments (web UI is separate and may or may not be a Deployment)
  const roleDeployments = deployments.filter((d) =>
    /temporal-(frontend|history|matching|worker)\b/.test(docName(d)));
  assert.equal(
    roleDeployments.length,
    4,
    `expected exactly 4 Temporal role Deployments, found ${roleDeployments.length}: ${roleDeployments.map(docName).join(', ')}`
  );
});

// -------------------------------------------------------------------------
// bbx-flows-helm-003: ClusterIP-only Services
// -------------------------------------------------------------------------
test('bbx-flows-helm-003: all Temporal Services are ClusterIP (no LB / NodePort)', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const services = docs.filter((d) => docKind(d) === 'Service' && isTemporalDoc(d));
  assert.ok(services.length >= 4, `expected >=4 Temporal Services, found ${services.length}`);
  for (const svc of services) {
    const typeMatch = svc.match(/(?:^|\n)\s+type:\s*(\S+)/);
    const type = typeMatch ? typeMatch[1] : 'ClusterIP';
    assert.equal(
      type,
      'ClusterIP',
      `Temporal Service ${docName(svc)} must be ClusterIP, got ${type}`
    );
    assert.doesNotMatch(svc, /type:\s*LoadBalancer/, `${docName(svc)} must not be LoadBalancer`);
    assert.doesNotMatch(svc, /type:\s*NodePort/, `${docName(svc)} must not be NodePort`);
    assert.doesNotMatch(svc, /nodePort:/, `${docName(svc)} must not pin a nodePort`);
  }
});

// -------------------------------------------------------------------------
// bbx-flows-helm-004: SQL visibility, no Elasticsearch
// -------------------------------------------------------------------------
test('bbx-flows-helm-004: no Elasticsearch resource is rendered for Temporal', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const esDocs = docs.filter((d) => /elasticsearch/i.test(docName(d)) || /image:\s*\S*elasticsearch/i.test(d));
  assert.equal(esDocs.length, 0, `no Elasticsearch resource expected, found: ${esDocs.map(docName).join(', ')}`);
  // The visibility store must be configured as SQL/postgres (env or config), never ES.
  const temporalDocs = docs.filter(isTemporalDoc).join('\n');
  assert.doesNotMatch(temporalDocs, /ENABLE_ES:\s*["']?true/i, 'Elasticsearch must not be enabled');
});

// -------------------------------------------------------------------------
// bbx-flows-helm-005: schema-tool Job
// -------------------------------------------------------------------------
test('bbx-flows-helm-005: schema Job uses temporal-sql-tool as a helm hook', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const jobs = docs.filter((d) => docKind(d) === 'Job' && isTemporalDoc(d));
  const schemaJob = jobs.find((d) => /schema/.test(docName(d)) || /temporal-sql-tool/.test(d));
  assert.ok(schemaJob, `expected a Temporal schema Job, jobs found: ${jobs.map(docName).join(', ')}`);
  assert.match(schemaJob, /temporal-sql-tool/, 'schema Job must use the temporal-sql-tool image');
  assert.match(
    schemaJob,
    /helm\.sh\/hook:\s*["']?[^"'\n]*pre-install[^"'\n]*pre-upgrade|helm\.sh\/hook:\s*["']?[^"'\n]*pre-upgrade[^"'\n]*pre-install/,
    'schema Job must be a pre-install,pre-upgrade hook'
  );
  assert.match(schemaJob, /backoffLimit:\s*3/, 'schema Job must set backoffLimit: 3');
});

// -------------------------------------------------------------------------
// bbx-flows-helm-006: bootstrap Job + five search attributes
// -------------------------------------------------------------------------
test('bbx-flows-helm-006: bootstrap Job registers namespace + five Keyword search attributes', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const jobs = docs.filter((d) => docKind(d) === 'Job' && isTemporalDoc(d));
  const bootstrapJob = jobs.find((d) => /bootstrap/.test(docName(d)));
  assert.ok(bootstrapJob, `expected a Temporal bootstrap Job, jobs: ${jobs.map(docName).join(', ')}`);
  assert.match(
    bootstrapJob,
    /helm\.sh\/hook:\s*["']?[^"'\n]*post-install[^"'\n]*post-upgrade|helm\.sh\/hook:\s*["']?[^"'\n]*post-upgrade[^"'\n]*post-install/,
    'bootstrap Job must be a post-install,post-upgrade hook'
  );
  // five custom search attributes, all Keyword
  for (const attr of ['tenantId', 'workspaceId', 'flowId', 'flowVersion', 'triggerType']) {
    assert.match(bootstrapJob, new RegExp(attr), `bootstrap Job must register search attribute ${attr}`);
  }
  assert.match(bootstrapJob, /Keyword/, 'search attributes must be of type Keyword');
});

// -------------------------------------------------------------------------
// bbx-flows-helm-007: NetworkPolicy label contract
// -------------------------------------------------------------------------
test('bbx-flows-helm-007: NetworkPolicy allows only flows-api / flows-worker on 7233', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const nps = docs.filter((d) => docKind(d) === 'NetworkPolicy' && isTemporalDoc(d));
  assert.ok(nps.length >= 1, `expected a Temporal NetworkPolicy, found ${nps.length}`);
  const np = nps.join('\n');
  assert.match(np, /flows-api/, 'NetworkPolicy must allow flows-api pods');
  assert.match(np, /flows-worker/, 'NetworkPolicy must allow flows-worker pods');
  assert.match(np, /(?:^|\n)\s+port:\s*7233/, 'NetworkPolicy must scope ingress to port 7233');
  assert.match(np, /policyTypes:[\s\S]*Ingress/, 'NetworkPolicy must declare an Ingress policyType');
});

// -------------------------------------------------------------------------
// bbx-flows-helm-008: non-root + RuntimeDefault on every Temporal pod spec
// -------------------------------------------------------------------------
test('bbx-flows-helm-008: runAsNonRoot + RuntimeDefault on all Temporal pod specs', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const podSpecKinds = ['Deployment', 'Job'];
  const podOwners = docs.filter((d) => podSpecKinds.includes(docKind(d)) && isTemporalDoc(d));
  assert.ok(podOwners.length >= 5, `expected >=5 Temporal pod-owning resources, found ${podOwners.length}`);
  for (const doc of podOwners) {
    assert.match(
      doc,
      /runAsNonRoot:\s*true/,
      `Temporal pod spec ${docName(doc)} must set runAsNonRoot: true`
    );
    assert.match(
      doc,
      /seccompProfile:\s*\n\s+type:\s*RuntimeDefault/,
      `Temporal pod spec ${docName(doc)} must set seccompProfile.type: RuntimeDefault`
    );
  }
});

// -------------------------------------------------------------------------
// bbx-flows-helm-009: no numeric fsGroup under the OpenShift overlay
// -------------------------------------------------------------------------
test('bbx-flows-helm-009: OpenShift overlay renders no numeric fsGroup for Temporal', SKIP, () => {
  const r = renderEnabled(['-f', OPENSHIFT_VALUES]);
  assert.equal(r.status, 0, `helm template (openshift) must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const temporalDocs = docs.filter(isTemporalDoc);
  assert.ok(temporalDocs.length >= 1, 'expected Temporal resources under the OpenShift overlay');
  for (const doc of temporalDocs) {
    const numericFsGroup = doc.match(/fsGroup:\s*(\d+)/);
    assert.equal(
      numericFsGroup,
      null,
      `Temporal resource ${docName(doc)} must not pin a numeric fsGroup under OpenShift, found: ${numericFsGroup ? numericFsGroup[0] : ''}`
    );
  }
});

// -------------------------------------------------------------------------
// bbx-flows-helm-010: no Ingress/Route/APISIX route for Temporal; Web UI present
// -------------------------------------------------------------------------
test('bbx-flows-helm-010: no external exposure for Temporal; Web UI deployed', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const exposureKinds = ['Ingress', 'Route', 'ApisixRoute'];
  const exposed = docs.filter((d) => exposureKinds.includes(docKind(d)) && isTemporalDoc(d));
  assert.equal(exposed.length, 0, `no external exposure expected for Temporal, found: ${exposed.map(docName).join(', ')}`);
  // Web UI must still be deployed (operator port-forward access)
  const web = docs.filter((d) => /temporal-(web|ui)\b/.test(docName(d)));
  assert.ok(web.length >= 1, 'expected a Temporal Web UI resource (Deployment/Service)');
});

// -------------------------------------------------------------------------
// bbx-flows-helm-011: resource requests/limits on every role Deployment
// -------------------------------------------------------------------------
test('bbx-flows-helm-011: each Temporal role Deployment has cpu/memory requests + limits', SKIP, () => {
  const r = renderEnabled();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const roleDeployments = docs.filter(
    (d) => docKind(d) === 'Deployment' && /temporal-(frontend|history|matching|worker)\b/.test(docName(d))
  );
  assert.equal(roleDeployments.length, 4, `expected 4 role Deployments, found ${roleDeployments.length}`);
  for (const d of roleDeployments) {
    assert.match(d, /resources:/, `${docName(d)} must declare resources`);
    assert.match(d, /requests:[\s\S]*cpu:/, `${docName(d)} must declare resources.requests.cpu`);
    assert.match(d, /requests:[\s\S]*memory:/, `${docName(d)} must declare resources.requests.memory`);
    assert.match(d, /limits:[\s\S]*cpu:/, `${docName(d)} must declare resources.limits.cpu`);
    assert.match(d, /limits:[\s\S]*memory:/, `${docName(d)} must declare resources.limits.memory`);
  }
});

// -------------------------------------------------------------------------
// bbx-flows-helm-012: helm lint exits 0 with the temporal block present
// -------------------------------------------------------------------------
test('bbx-flows-helm-012: helm lint exits 0 (temporal block present)', SKIP, () => {
  const r = helmLint();
  assert.equal(r.status, 0, `helm lint must exit 0.\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
});
