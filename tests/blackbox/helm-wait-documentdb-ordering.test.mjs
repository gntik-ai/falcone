/**
 * Black-box regression suite for spec change fix-helm-wait-documentdb-hook-ordering
 * (live E2E campaign 2026-06-17, finding C.4 / D4).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`, inspects the rendered ferretdb
 * Deployment's `wait-for-documentdb` init container and the documentdb-init hook Job. No internal
 * knowledge of the Go templates is used.
 *
 * Defect: `helm install --wait` deadlocked. The ferretdb gateway (a MAIN resource) had an init
 * container that only WAITED for the documentdb_api schema, but that schema is created by the
 * documentdb-init Job — a post-install/post-upgrade HOOK that Helm runs only AFTER all main
 * resources are Ready. Circular dependency → ferretdb never Ready → "Progress deadline exceeded".
 *
 * Fix: the init container now CREATEs the extension itself (idempotent, fail-closed if the engine
 * image lacks it), so the gateway is self-sufficient and the install converges. The post-install
 * Job stays the canonical owner for upgrades + logical-replication provisioning.
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-c4-01  the ferretdb init container CREATEs the documentdb extension (not just waits)
 *   bbx-c4-02  the init container still verifies the documentdb_api schema and fails closed
 *   bbx-c4-03  the documentdb-init Job remains a post-install hook (canonical owner; not pre-install)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(releaseName = 'falcone') {
  const r = spawnSync('helm', ['template', releaseName, CHART_PATH], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}

function splitDocs(stream) {
  return String(stream || '')
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && /(^|\n)kind:\s*\S/.test(d));
}
function docName(doc) {
  const m = doc.match(/(?:^|\n)metadata:\s*\n(?:\s+\S.*\n)*?\s+name:\s*(\S+)/);
  return m ? m[1] : '';
}
function findDoc(stream, kindRe, name) {
  return splitDocs(stream).find((d) => kindRe.test(d) && docName(d) === name);
}

// -------------------------------------------------------------------------
// bbx-c4-01: the gateway init container is self-sufficient — it creates the extension
// -------------------------------------------------------------------------
test('bbx-c4-01: ferretdb init container CREATEs the documentdb extension (breaks the --wait deadlock)', SKIP, () => {
  const dep = findDoc(helmTemplate(), /(^|\n)kind:\s*Deployment/, 'falcone-ferretdb');
  assert.ok(dep, 'expected a Deployment named falcone-ferretdb');
  assert.match(dep, /wait-for-documentdb/, 'expected the wait-for-documentdb init container');
  assert.match(
    dep,
    /CREATE EXTENSION IF NOT EXISTS documentdb CASCADE/,
    'the init container MUST create the extension itself (not depend on the post-install hook), else helm install --wait deadlocks',
  );
});

// -------------------------------------------------------------------------
// bbx-c4-02: it still verifies the schema and fails closed on a wrong image
// -------------------------------------------------------------------------
test('bbx-c4-02: init container verifies documentdb_api and fails closed when the extension is unavailable', SKIP, () => {
  const dep = findDoc(helmTemplate(), /(^|\n)kind:\s*Deployment/, 'falcone-ferretdb');
  assert.match(dep, /pg_available_extensions WHERE name = 'documentdb'/, 'must check the extension is available');
  assert.match(dep, /Failing closed/, 'must fail closed when the engine image lacks the extension');
  assert.match(dep, /schema_name = 'documentdb_api'/, 'must still verify the documentdb_api schema is present before starting');
});

// -------------------------------------------------------------------------
// bbx-c4-03: the post-install Job stays a hook (canonical owner; not the critical path)
// -------------------------------------------------------------------------
test('bbx-c4-03: documentdb-init Job remains a post-install/post-upgrade hook', SKIP, () => {
  const job = findDoc(helmTemplate(), /(^|\n)kind:\s*Job/, 'falcone-documentdb-init');
  assert.ok(job, 'expected the falcone-documentdb-init Job');
  assert.match(job, /helm\.sh\/hook:\s*post-install,post-upgrade/, 'the init Job remains a post hook (engine StatefulSet is a main resource, so it cannot be pre-install)');
  // it must NOT be on the main-resource critical path (no plain non-hook ferretdb dependency)
  assert.doesNotMatch(job, /helm\.sh\/hook:\s*pre-install/, 'must not be a pre-install hook (engine would not exist yet)');
});
