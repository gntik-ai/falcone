/**
 * Black-box tests for add-pgvector-image-for-vector-search (#602).
 *
 * Vector/KNN search is a DEDICATED-DB capability by design: the shared bitnami `postgresql` instance
 * lacks pgvector and the provisioning pre-flight rejects `CREATE EXTENSION vector` on it with an
 * actionable message. This change makes the operator contract (`postgresql.dedicatedTenantImage:
 * pgvector/pgvector`) an actually-DEPLOYABLE opt-in dedicated Postgres on the pgvector image, so a
 * dedicated-DB tenant can enable the extension and run KNN. (The KNN SQL path itself is proven
 * real-stack in tests/env/executor/vector-search-knn-rls.test.mjs, which runs on pgvector/pgvector.)
 *
 * Driven through the PUBLIC chart surface only (`helm template`), inspecting the rendered workloads.
 * Self-skips when `helm` is absent (repo precedent: the vault/pgvector helm suites).
 *
 * bbx-602-01  default kind render includes the core pgvector workload
 * bbx-602-02  the pgvector workload uses the pgvector/pgvector image (uid 999)
 * bbx-602-03  the vector overlay does NOT change the shared `postgresql` (bitnami) image
 * bbx-602-04  the `postgresql.dedicatedTenantImage` operator contract is preserved
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone');
const KIND_VALUES = resolve(REPO_ROOT, '..', 'falcone-charts', 'deploy', 'kind', 'values-kind.yaml');
const VECTOR_OVERLAY = resolve(REPO_ROOT, '..', 'falcone-charts', 'deploy', 'kind', 'values-kind-vector.yaml');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(extraArgs = []) {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}
function splitDocs(stream) {
  return String(stream || '').split(/^---\s*$/m).map((d) => d.trim()).filter((d) => /(^|\n)kind:\s*\S/.test(d));
}
function docsOfKind(stream, kind) {
  return splitDocs(stream).filter((d) => new RegExp(`(^|\\n)kind:\\s*${kind}\\b`).test(d));
}
const DEFAULT = ['-f', KIND_VALUES];
const WITH_VECTOR = ['-f', KIND_VALUES, '-f', VECTOR_OVERLAY];

test('bbx-602-01: the default kind render includes the core pgvector workload', SKIP, () => {
  const out = helmTemplate(DEFAULT);
  const vectorWorkloads = [...docsOfKind(out, 'StatefulSet'), ...docsOfKind(out, 'Deployment')]
    .filter((d) => /name:\s*\S*postgresql-vector\b/.test(d));
  assert.equal(vectorWorkloads.length, 1, `expected one core postgresql-vector workload, found ${vectorWorkloads.length}`);
  assert.match(out, /image:\s*"pgvector\/pgvector@sha256:[a-f0-9]{64}"/, 'pgvector image must render with a verified digest');
});

test('bbx-602-02: the core vector instance renders a dedicated Postgres on the pgvector image', SKIP, () => {
  const out = helmTemplate(WITH_VECTOR);
  const sts = docsOfKind(out, 'StatefulSet').find((d) => /name:\s*\S*postgresql-vector\b/.test(d));
  assert.ok(sts, 'the vector overlay must render the postgresql-vector StatefulSet');
  assert.match(sts, /image:\s*"pgvector\/pgvector@sha256:[a-f0-9]{64}"/, 'must use the pgvector/pgvector image by digest');
  assert.match(sts, /runAsUser:\s*999/, 'official-postgres image runs as uid 999');
  assert.match(sts, /name:\s*PGDATA/, 'PGDATA must be set (official entrypoint, sub-dir of the PVC)');
  // Admin creds from the operator-supplied Secret (mirrors in-falcone-postgresql).
  assert.match(sts, /in-falcone-postgresql-vector/, 'must source admin creds from in-falcone-postgresql-vector');
});

test('bbx-602-03: enabling the vector instance does not change the shared bitnami postgresql', SKIP, () => {
  const base = helmTemplate(DEFAULT);
  const withVec = helmTemplate(WITH_VECTOR);
  const sharedImage = (s) => {
    const sts = docsOfKind(s, 'StatefulSet').find((d) => /name:\s*falcone-postgresql\b/.test(d) && !/postgresql-vector/.test(d));
    return (sts.match(/image:\s*("?[^"\n]+"?)/) || [])[1];
  };
  assert.equal(sharedImage(withVec), sharedImage(base), 'the shared postgresql image must be unchanged');
  assert.match(sharedImage(base), /postgresql/, 'sanity: shared image is a postgresql image');
});

test('bbx-602-04: the postgresql.dedicatedTenantImage operator contract is preserved', SKIP, () => {
  // The named operator contract that points dedicated-DB tenants at a vector-capable image.
  const values = readFileSync(resolve(CHART_PATH, 'values.yaml'), 'utf8');
  assert.match(values, /dedicatedTenantImage:[\s\S]*repository:\s*pgvector\/pgvector[\s\S]*tag:\s*pg17[\s\S]*digest:\s*sha256:[a-f0-9]{64}/, 'the dedicatedTenantImage contract keeps repository, tag, and digest');
});
