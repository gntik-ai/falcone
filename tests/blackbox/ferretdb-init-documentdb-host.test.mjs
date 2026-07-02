/**
 * Black-box regression suite for spec change fix-ferretdb-init-documentdb-host
 * (live E2E campaign 2026-06-17, finding D1).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template` as a child process. No internal
 * knowledge of the Go templates is used — assertions render the chart under several release
 * names and inspect the rendered ferretdb Deployment's `wait-for-documentdb` init container.
 *
 * Defect: the ferretdb init container hardcoded the DocumentDB host as `in-falcone-documentdb`
 * (the chart-name prefix). For any release name other than `in-falcone` the DocumentDB Service
 * is `<release>-documentdb`, so the init container's `until pg_isready` loop never resolved and
 * the pod stuck at `Init:0/1` forever. Verified live: `pg_isready -h in-falcone-documentdb` →
 * "no response" (rc=2); `pg_isready -h falcone-documentdb` → "accepting connections" (rc=0).
 *
 * The suite self-skips when the `helm` binary is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-d1-01  release `falcone`   → init container PGHOST = `falcone-documentdb`
 *   bbx-d1-02  release `in-falcone`→ init container PGHOST = `in-falcone-documentdb` (unaffected)
 *   bbx-d1-03  release `my-baas`   → init container PGHOST = `my-baas-documentdb`
 *   bbx-d1-04  no rendered init container env ever pins the stale `in-falcone-documentdb` host
 *              under a non-default release name
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');

function helmAvailable() {
  const r = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' });
  return r.status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(releaseName) {
  return spawnSync('helm', ['template', releaseName, CHART_PATH], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Split a multi-doc YAML stream into individual docs that declare a kind. */
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

/** Pull the PGHOST env value out of the ferretdb Deployment's init container block. */
function ferretdbInitPgHost(stream, releaseName) {
  const docs = splitDocs(stream);
  const dep = docs.find(
    (d) => /(^|\n)kind:\s*Deployment/.test(d) && docName(d) === `${releaseName}-ferretdb`,
  );
  assert.ok(dep, `expected a Deployment named ${releaseName}-ferretdb in the render`);
  assert.match(dep, /wait-for-documentdb/, 'expected a wait-for-documentdb init container');
  // PGHOST is unique to the init container — the gateway container sources its DSN from a
  // secretRef (FERRETDB_POSTGRESQL_URL), so it carries no plaintext PGHOST. (toYaml sorts
  // map keys, so env renders before the container `name`; match the whole doc.)
  const m = dep.match(/name:\s*PGHOST\s+value:\s*'?"?([A-Za-z0-9._-]+)'?"?/);
  assert.ok(m, 'expected a PGHOST env entry in the init container');
  return m[1];
}

// -------------------------------------------------------------------------
// bbx-d1-01: non-default release name resolves to the release-prefixed host
// -------------------------------------------------------------------------
test('bbx-d1-01: release `falcone` → init container PGHOST is falcone-documentdb', SKIP, () => {
  const r = helmTemplate('falcone');
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  assert.equal(ferretdbInitPgHost(r.stdout, 'falcone'), 'falcone-documentdb');
});

// -------------------------------------------------------------------------
// bbx-d1-02: default release name is unaffected
// -------------------------------------------------------------------------
test('bbx-d1-02: release `in-falcone` → init container PGHOST is in-falcone-documentdb', SKIP, () => {
  const r = helmTemplate('in-falcone');
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  assert.equal(ferretdbInitPgHost(r.stdout, 'in-falcone'), 'in-falcone-documentdb');
});

// -------------------------------------------------------------------------
// bbx-d1-03: an arbitrary release name also resolves correctly
// -------------------------------------------------------------------------
test('bbx-d1-03: release `my-baas` → init container PGHOST is my-baas-documentdb', SKIP, () => {
  const r = helmTemplate('my-baas');
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  assert.equal(ferretdbInitPgHost(r.stdout, 'my-baas'), 'my-baas-documentdb');
});

// -------------------------------------------------------------------------
// bbx-d1-04: the stale hardcoded host never survives under a non-default release
// -------------------------------------------------------------------------
test('bbx-d1-04: non-default release never pins the stale in-falcone-documentdb host', SKIP, () => {
  const r = helmTemplate('falcone');
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const dep = docs.find(
    (d) => /(^|\n)kind:\s*Deployment/.test(d) && docName(d) === 'falcone-ferretdb',
  );
  assert.doesNotMatch(
    dep,
    /name:\s*PGHOST\s+value:\s*'?"?in-falcone-documentdb/,
    'init container PGHOST must not pin the chart-name-prefixed host for a non-default release',
  );
});
