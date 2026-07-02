/**
 * Black-box regression guard for spec change fix-stale-migration-components-in-running-release
 * (live E2E campaign 2026-06-17, finding D8).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`. This is the CI guard the change adds:
 * it fails if any legacy migration-era component (MongoDB / MinIO / OpenWhisk) renders from current
 * chart source, or if a legacy values stanza reintroduces one.
 *
 * Defect: the live (pre-campaign) release ran a `falcone-mongodb` StatefulSet, a minio NodePort and
 * an openwhisk svc-stub, with control-plane/executor env pointed at MongoDB — an incomplete
 * migration. FerretDB/SeaweedFS/Knative supersede them. A fresh deploy drops the workloads; this
 * guard keeps them from coming back.
 *
 * NOTE: the observability ConfigMap intentionally carries `mongodb`/`openwhisk` as metric
 * scrape-target *keys* mapped to the documentdb/controlPlane components — those are aliases, not
 * workloads. The guard therefore scopes to rendered resource names, container images and env
 * values, never raw ConfigMap data.
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-c7-01  no workload/Service/Job resource is named like a legacy component
 *   bbx-c7-02  no container image references a legacy component
 *   bbx-c7-03  no env value pins a legacy host; control-plane/executor point at FerretDB + SeaweedFS
 *   bbx-c7-04  the chart-level validate guard fails the render if a legacy values stanza is set
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const LEGACY = /mongodb|minio|openwhisk/i;
const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'Job', 'CronJob'];

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function render(extraArgs = []) {
  return spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
}
function renderOk(extraArgs = []) {
  const r = render(extraArgs);
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}
function splitDocs(stream) {
  return String(stream || '')
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && /(^|\n)kind:\s*\S/.test(d));
}
function docKind(doc) {
  const m = doc.match(/(?:^|\n)kind:\s*(\S+)/);
  return m ? m[1] : '';
}
function docName(doc) {
  const m = doc.match(/(?:^|\n)metadata:\s*\n(?:\s+\S.*\n)*?\s+name:\s*(\S+)/);
  return m ? m[1] : '';
}

// -------------------------------------------------------------------------
// bbx-c7-01: no legacy-named workload / Service / Job renders
// -------------------------------------------------------------------------
test('bbx-c7-01: no workload/Service/Job resource is named like a legacy component', SKIP, () => {
  for (const doc of splitDocs(renderOk())) {
    if (!WORKLOAD_KINDS.includes(docKind(doc))) continue;
    const name = docName(doc);
    assert.doesNotMatch(name, LEGACY, `legacy ${docKind(doc)} "${name}" must not render (FerretDB/SeaweedFS/Knative supersede it)`);
  }
});

// -------------------------------------------------------------------------
// bbx-c7-02: no container image references a legacy component
// -------------------------------------------------------------------------
test('bbx-c7-02: no container image references a legacy component', SKIP, () => {
  const offending = renderOk()
    .split('\n')
    .filter((l) => /^\s*image:\s*\S/.test(l) && LEGACY.test(l));
  assert.equal(offending.length, 0, `no image may reference a legacy component:\n${offending.join('\n')}`);
});

// -------------------------------------------------------------------------
// bbx-c7-03: env values point at FerretDB/SeaweedFS, never a legacy host
// -------------------------------------------------------------------------
test('bbx-c7-03: no env value pins a legacy host; data plane points at FerretDB + SeaweedFS', SKIP, () => {
  const out = renderOk();
  const offending = out.split('\n').filter((l) => /^\s*value:\s*\S/.test(l) && LEGACY.test(l));
  assert.equal(offending.length, 0, `no env value may pin a legacy host (mongodb/minio/openwhisk):\n${offending.join('\n')}`);
  // positive proof the migration target is actually wired
  assert.match(out, /value:\s*'?"?falcone-documentdb'?"?/, 'control-plane must point at the documentdb (FerretDB) engine');
  assert.match(out, /falcone-seaweedfs/, 'storage must point at SeaweedFS');
});

// -------------------------------------------------------------------------
// bbx-c7-04: the chart-level validate guard rejects a reintroduced legacy stanza
// -------------------------------------------------------------------------
test('bbx-c7-04: validate guard fails the render when a legacy values stanza is set', SKIP, () => {
  for (const legacy of ['mongodb', 'minio', 'openwhisk']) {
    const r = render(['--set', `${legacy}.enabled=true`]);
    assert.notEqual(r.status, 0, `setting a ${legacy} stanza must fail the render (guard)`);
    assert.match(r.stderr, new RegExp(`legacy component "${legacy}" must not be present`), `the guard must name the offending legacy component (${legacy})`);
  }
});
