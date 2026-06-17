/**
 * Black-box regression suite for OpenSpec change fix-ferretdb-gateway-authentication
 * (live E2E campaign 2026-06-17, finding F2).
 *
 * Drives the PUBLIC chart surface via `helm template` over the deploy overlays and asserts the
 * MongoDB client identity wiring. No internal template knowledge is used.
 *
 * Defect: FerretDB v2 delegates authentication to its DocumentDB Postgres backend, so the Mongo
 * client identity MUST be a real Postgres login role — the DocumentDB admin (POSTGRES_USER, the
 * same role the FerretDB postgresql-url uses). The control-plane/executor overlays hardcoded
 * `MONGO_USER: falcone`, which did NOT match the admin role (e.g. `falcone_doc_admin`), so the
 * handshake failed ("Authentication failed" / HandshakeError) and all /v1/mongo/* 500'd.
 * Confirmed against real FerretDB 2.7.0 + DocumentDB: auth as `falcone` fails, auth as the admin
 * role succeeds with a full insert+list round-trip.
 *
 * Fix: source MONGO_USER from the SAME secret as MONGO_PASSWORD (in-falcone-documentdb POSTGRES_USER).
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: data-api / spec.md):
 *   bbx-f2-01  kind overlay      → MONGO_USER is a secretKeyRef to in-falcone-documentdb/POSTGRES_USER
 *   bbx-f2-02  openshift overlay → same
 *   bbx-f2-03  no overlay hardcodes MONGO_USER to a literal `falcone` value
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function render(overlayRelPath) {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, '-f', resolve(REPO_ROOT, overlayRelPath)], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template (${overlayRelPath}) must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}

/** Assert MONGO_USER is a secretKeyRef to in-falcone-documentdb/POSTGRES_USER, not a literal value.
 *  (toYaml sorts keys, so within secretKeyRef `key` precedes `name`.) */
function assertMongoUserFromSecret(stream, label) {
  // the MONGO_USER env entry must carry a valueFrom/secretKeyRef block, not `value:`
  assert.match(
    stream,
    /name:\s*MONGO_USER\s+valueFrom:\s+secretKeyRef:\s+key:\s*POSTGRES_USER\s+name:\s*in-falcone-documentdb/,
    `${label}: MONGO_USER must source POSTGRES_USER from the in-falcone-documentdb secret`,
  );
  assert.doesNotMatch(
    stream,
    /name:\s*MONGO_USER\s+value:\s*falcone\b/,
    `${label}: MONGO_USER must not be the hardcoded literal "falcone"`,
  );
}

// -------------------------------------------------------------------------
test('bbx-f2-01: kind overlay wires MONGO_USER from the documentdb secret', SKIP, () => {
  assertMongoUserFromSecret(render('deploy/kind/values-kind.yaml'), 'kind');
});

test('bbx-f2-02: openshift overlay wires MONGO_USER from the documentdb secret', SKIP, () => {
  assertMongoUserFromSecret(render('deploy/openshift/values-openshift.yaml'), 'openshift');
});

// -------------------------------------------------------------------------
// bbx-f2-03: the plain (non-helm) manifests must not regress to a hardcoded MONGO_USER either
// -------------------------------------------------------------------------
test('bbx-f2-03: plain manifests source MONGO_USER from POSTGRES_USER (no hardcoded falcone)', () => {
  for (const rel of ['deploy/kind/executor-demo.yaml']) {
    const txt = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    assert.doesNotMatch(txt, /name:\s*MONGO_USER\s*,\s*value:\s*falcone\b/, `${rel}: MONGO_USER must not be hardcoded`);
    assert.match(txt, /MONGO_USER[\s\S]{0,80}?secretKeyRef[\s\S]{0,80}?POSTGRES_USER/, `${rel}: MONGO_USER must source POSTGRES_USER`);
  }
});
